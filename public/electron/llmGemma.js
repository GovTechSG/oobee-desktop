// Local-model chat backend. Talks OpenAI-compatible HTTP to a bundled
// `llama-server` subprocess (see llamaServer.js), which runs Google's Gemma 4
// QAT Q4_0 GGUFs with mmproj vision. Mirrors the streaming surface of the
// Anthropic path in llmAnalysis.js — the same IPC events (`llmChat:chunk`,
// `llmChat:toolCall`, `llmChat:attachment`) fire so the renderer stays
// provider-agnostic.
//
// History note: this module used to embed node-llama-cpp in-process. It was
// replaced by a `llama-server` subprocess so (a) Windows-on-ARM64 gets real
// GPU acceleration via the Adreno OpenCL backend that node-llama-cpp doesn't
// ship, and (b) all platforms get real screenshot vision via `--mmproj`,
// which node-llama-cpp v3 doesn't expose.

const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const { getModelPath, getMmprojPath } = require('./llmModelManager')
const llamaServer = require('./llamaServer')

const log = (...args) => console.log('[llmGemma]', ...args)
const warn = (...args) => console.warn('[llmGemma]', ...args)

// Token-budget guardrails for local inference stability. Large tool payloads
// and long chat history can force multi-thousand-token prompt reprocessing on
// each tool hop, which degrades throughput and increases CPU pressure.
const MAX_TOOL_RESULT_CHARS = 12_000
const MAX_HISTORY_MESSAGES = 18
const MAX_HISTORY_CHARS = 55_000
const REQUEST_TIMEOUT_MS = 180_000

// Context window sizing — same tiered heuristic we used with node-llama-cpp,
// because the RAM math is the same underneath. Gemma 4's hybrid attention
// (mostly sliding-window 512, a few global layers) keeps the effective KV
// cost well below the naive f16-across-all-layers estimate, so these tiers
// are conservative on the safe side. Baseline: ~5–7 GB weights + ~1 GB mmproj
// + ~2 GB llama-server/Electron working set = ~10 GB. On macOS `freemem()`
// under-reports because inactive memory shows as "used"; fall back to
// `totalmem() - reserved - 4 GB safety` and pick the larger.
function pickContextSize() {
  const totalGB = os.totalmem() / (1024 ** 3)
  const freeGB = os.freemem() / (1024 ** 3)
  const reservedGB = 8 // weights + mmproj + working set
  const headroomGB = Math.max(freeGB - reservedGB, totalGB - reservedGB - 4)

  let size
  if (headroomGB >= 20) size = 65536
  else if (headroomGB >= 5) size = 32768
  else if (headroomGB >= 1) size = 16384
  else size = 8192

  log(
    `contextSize=${size} (totalRAM=${totalGB.toFixed(1)}GB, freeRAM=${freeGB.toFixed(1)}GB, headroom≈${headroomGB.toFixed(1)}GB)`,
  )
  if (totalGB < 10) {
    warn(
      `total RAM is only ${totalGB.toFixed(1)}GB — Gemma weights plus Electron will likely swap. Consider using the Anthropic Claude provider instead.`,
    )
  }
  return size
}

// Resolve model + mmproj paths and (re)start the llama-server subprocess
// pointing at them. Idempotent: repeated calls for the same modelId don't
// respawn; a different modelId does (llamaServer.ensure handles that).
async function ensureModel(modelId) {
  if (!modelId) throw new Error('ensureModel requires a modelId')
  const modelPath = getModelPath(modelId)
  if (!(await fs.pathExists(modelPath))) {
    throw new Error(
      `Gemma model "${modelId}" not downloaded. Open the LLM Analysis page and download it first.`,
    )
  }
  const mmprojPath = getMmprojPath(modelId)
  const withMmproj = await fs.pathExists(mmprojPath)
  if (!withMmproj) {
    warn(
      `mmproj file missing for ${modelId} (${mmprojPath}) — running text-only. Re-download the model to enable image analysis.`,
    )
  }
  const { baseUrl } = await llamaServer.ensure({
    modelPath,
    mmprojPath: withMmproj ? mmprojPath : null,
    contextSize: pickContextSize(),
  })
  return { baseUrl, modelId }
}

// Historical defensive filter: Gemma's chat template uses channel delimiters
// (`<channel|>reasoning`, `<|tool_response>`, etc.) that llama-server should
// consume server-side with `--jinja`. If any leak through we strip them here.
// Kept across the node-llama-cpp → llama-server migration as belt-and-braces.
const GEMMA_TEMPLATE_TOKEN_RE = new RegExp(
  [
    '<channel\\|>[a-zA-Z_]*',
    '<\\|channel\\|>[a-zA-Z_]*',
    '<\\|message\\|>',
    '<\\|start\\|>',
    '<\\|end\\|>',
    '<\\|tool_response\\|?>',
    '</?tool_response\\|?>',
    '<start_of_turn>',
    '<end_of_turn>',
    '<\\|im_start\\|>[a-zA-Z_]*',
    '<\\|im_end\\|>',
    '</?s>',
    '<eos>',
  ].join('|'),
  'g',
)
const GEMMA_TEMPLATE_PARTIAL_RE = /<[^>]{0,31}$/
function createTemplateTokenFilter() {
  let carry = ''
  return {
    push(text) {
      let combined = carry + text
      combined = combined.replace(GEMMA_TEMPLATE_TOKEN_RE, '')
      const partial = combined.match(GEMMA_TEMPLATE_PARTIAL_RE)
      if (partial) {
        carry = partial[0]
        return combined.slice(0, combined.length - carry.length)
      }
      carry = ''
      return combined
    },
    flush() {
      const out = carry.replace(GEMMA_TEMPLATE_TOKEN_RE, '')
      carry = ''
      return out
    },
  }
}

// Convert the shared tool schemas (Anthropic shape) into OpenAI `tools[]`.
function toOpenAITools(toolSchemas) {
  return toolSchemas.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }))
}

// Build the user message content array. Text-only when there are no image
// attachments; a content array with image_url parts when there are. Data URIs
// are passed verbatim — llama-server accepts `data:image/*;base64,…` for
// mmproj-backed models.
function buildUserContent(userMessage, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return userMessage
  const parts = []
  for (const att of attachments) {
    const url = `data:${att.mediaType};base64,${att.base64}`
    parts.push({ type: 'image_url', image_url: { url } })
  }
  parts.push({ type: 'text', text: userMessage })
  return parts
}

function estimateContentChars(content) {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    let total = 0
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') total += part.text.length
      else if (part?.type === 'image_url') total += 64
      else total += 32
    }
    return total
  }
  if (content == null) return 0
  try {
    return JSON.stringify(content).length
  } catch (_) {
    return 0
  }
}

function estimateMessageChars(msg) {
  if (!msg) return 0
  return estimateContentChars(msg.content) + (Array.isArray(msg.tool_calls) ? 200 : 0)
}

function trimGemmaHistory(messages) {
  if (!Array.isArray(messages) || messages.length <= 2) return
  const system = messages[0]
  const tail = messages.slice(1)

  const kept = []
  let chars = estimateMessageChars(system)
  for (let i = tail.length - 1; i >= 0; i--) {
    const msg = tail[i]
    const msgChars = estimateMessageChars(msg)
    if (kept.length >= MAX_HISTORY_MESSAGES) break
    if (kept.length > 0 && chars + msgChars > MAX_HISTORY_CHARS) break
    kept.unshift(msg)
    chars += msgChars
  }

  while (kept.length > 0 && kept[0]?.role === 'tool') kept.shift()

  // Keep one stable system prompt plus a bounded recent tail; this preserves
  // recency while preventing unbounded prompt growth across tool loops.
  const next = [system, ...kept]
  if (next.length < messages.length) {
    const dropped = messages.length - next.length
    log(`trimmed gemma history: dropped ${dropped} old message(s), kept ${next.length}`)
    messages.splice(0, messages.length, ...next)
  }
}

function truncateToolResult(text) {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return text.slice(0, MAX_TOOL_RESULT_CHARS) + '\n…[truncated]'
}

function canonicalizeForSignature(value) {
  if (Array.isArray(value)) return value.map(canonicalizeForSignature)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalizeForSignature(value[k])
    }
    return out
  }
  return value
}

function toolCallSignature(name, args) {
  return `${name}:${JSON.stringify(canonicalizeForSignature(args || {}))}`
}

// SSE parser for /v1/chat/completions?stream=true. Yields parsed JSON delta
// objects (the payload after `data: `), stopping at `data: [DONE]`.
async function* readChatSSE(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // Events are separated by a blank line; each event has one or more `data:` lines.
    let sep
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return
        if (!payload) continue
        try {
          yield JSON.parse(payload)
        } catch (e) {
          warn(`SSE parse error: ${e.message} — payload=${payload.slice(0, 200)}`)
        }
      }
    }
  }
}

async function streamGemmaChat({
  session,
  mainWindow,
  sessionId,
  userMessage,
  attachments,
  runTool,
  toolSchemas,
}) {
  const send = (channel, payload) => mainWindow.webContents.send(channel, payload)

  // First send: spin up (or reuse) the server, seed conversation state.
  const { baseUrl } = await ensureModel(session.modelId || 'gemma-e4b')
  if (!session.gemma) {
    session.gemma = { messages: [{ role: 'system', content: session.systemPrompt }] }
  }

  session.gemma.messages.push({ role: 'user', content: buildUserContent(userMessage, attachments) })

  const abort = new AbortController()
  session.abort = abort

  const tools = toOpenAITools(toolSchemas)
  const toolByName = new Map(toolSchemas.map((t) => [t.name, t]))

  // Gemma 4's model-card defaults (temp=1.0, topP=0.95, topK=64) are tuned for
  // creative generation. This task is analytical — cite the exact WCAG SC,
  // quote actual class names — so we tighten to reduce fabrication:
  //   temperature 1.0 → 0.7  (still permits option enumeration; less drift)
  //   top_p       0.95 → 0.9 (trims low-probability token tail)
  //   top_k         64 → 40  (narrows candidate set)
  const samplingKnobs = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
  }

  // OpenAI-style tool loop. Each iteration streams tokens for the current
  // assistant turn; if the server signals `finish_reason: 'tool_calls'` we
  // run the tools, append their results, and loop. Terminate on `stop`
  // (natural end) or `length` (hit max_tokens).
  //
  // The loop cap is a belt: pathological prompt/tool combinations shouldn't
  // hang the UI indefinitely.
  const MAX_TOOL_HOPS = 8
  const filter = createTemplateTokenFilter()

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    trimGemmaHistory(session.gemma.messages)
    const requestAbort = new AbortController()
    const timeoutId = setTimeout(() => {
      requestAbort.abort(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`))
    }, REQUEST_TIMEOUT_MS)
    const onUserAbort = () => requestAbort.abort(new Error('aborted by user'))
    abort.signal.addEventListener('abort', onUserAbort, { once: true })

    log(
      `hop=${hop + 1}/${MAX_TOOL_HOPS} messages=${session.gemma.messages.length} approxChars=${session.gemma.messages.reduce((n, m) => n + estimateMessageChars(m), 0)}`,
    )

    let res
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: requestAbort.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: session.modelId || 'gemma-e4b',
        messages: session.gemma.messages,
        tools,
        tool_choice: 'auto',
        stream: true,
        ...samplingKnobs,
      }),
      })
    } finally {
      clearTimeout(timeoutId)
      abort.signal.removeEventListener('abort', onUserAbort)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`llama-server returned ${res.status}: ${text.slice(0, 500)}`)
    }

    let content = '' // accumulated assistant text this hop
    const toolCalls = new Map() // index → { id, name, args }
    let finishReason = null

    try {
      for await (const chunk of readChatSSE(res)) {
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta || {}
        if (typeof delta.content === 'string' && delta.content.length) {
          content += delta.content
          const cleaned = filter.push(delta.content)
          if (cleaned) send('llmChat:chunk', { sessionId, text: cleaned })
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            let acc = toolCalls.get(idx)
            if (!acc) {
              acc = { id: tc.id || `tc-${Date.now()}-${idx}`, name: '', args: '' }
              toolCalls.set(idx, acc)
            }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name = tc.function.name
            if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason
      }
    } catch (e) {
      if (abort.signal.aborted) {
        log(`session ${sessionId} aborted mid-response`)
        return
      }
      throw e
    }

    const tail = filter.flush()
    if (tail) send('llmChat:chunk', { sessionId, text: tail })

    // Record the assistant turn. If it made tool calls, we still need the
    // assistant message that requested them so the follow-up POST is
    // conversation-consistent.
    if (toolCalls.size > 0) {
      const calls = Array.from(toolCalls.values()).map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.args || '{}' },
      }))
      session.gemma.messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: calls,
      })

      // Dispatch each tool call. Same IPC events as before so the renderer
      // shows the same tool-call chip lifecycle.
      for (const call of calls) {
        let args = {}
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        } catch (e) {
          warn(`tool ${call.function.name} sent invalid JSON args: ${call.function.arguments}`)
        }
        const toolResult = await runToolCall({
          session,
          sessionId,
          toolByName,
          runTool,
          call,
          args,
          send,
        })
        session.gemma.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult,
        })
      }
      continue // let the model consume the tool results
    }

    if (!content.trim()) {
      throw new Error('Model returned an empty response. Please retry.')
    }

    // No tool call — this is the final assistant turn.
    session.gemma.messages.push({ role: 'assistant', content })
    if (finishReason && finishReason !== 'stop' && finishReason !== 'length') {
      warn(`unexpected finish_reason: ${finishReason}`)
    }
    return
  }

  warn(`hit MAX_TOOL_HOPS=${MAX_TOOL_HOPS} — bailing to avoid an infinite tool loop`)
}

// Execute a single tool call and return the string that goes back to the
// model. Emits `llmChat:toolCall` / `llmChat:attachment` events so the
// renderer sees the same lifecycle as the Anthropic path.
async function runToolCall({ session, sessionId, toolByName, runTool, call, args, send }) {
  const name = call.function.name
  const id = call.id
  const known = toolByName.get(name)
  if (!known) {
    send('llmChat:toolCall', { sessionId, id, name, status: 'error', summary: 'unknown tool' })
    return JSON.stringify({ error: `unknown tool: ${name}` })
  }

  send('llmChat:toolCall', { sessionId, id, name, status: 'start' })
  send('llmChat:toolCall', { sessionId, id, name, status: 'ready', input: args })

  // Prevent runaway local-tool loops where the model repeatedly calls the
  // exact same tool with the exact same args. Repeated large tool payloads can
  // dominate prompt tokens and stall inference.
  if (!session.gemmaToolState) {
    session.gemmaToolState = { calls: new Map() }
  }
  const signature = toolCallSignature(name, args)
  const seen = (session.gemmaToolState.calls.get(signature) || 0) + 1
  session.gemmaToolState.calls.set(signature, seen)
  if (seen > 1) {
    const msg = `Repeated tool call blocked for ${name}; same arguments were already processed. Use a narrower tool (for example get_finding_detail or get_element_context) instead of repeating the same page-level request.`
    send('llmChat:toolCall', { sessionId, id, name, status: 'error', summary: msg })
    return JSON.stringify({
      error: msg,
      repeatedToolCall: true,
      tool: name,
    })
  }

  let result
  try {
    result = runTool(session, name, args)
  } catch (e) {
    send('llmChat:toolCall', { sessionId, id, name, status: 'error', summary: e.message })
    return JSON.stringify({ error: e.message })
  }

  // Full-page screenshot marker. OpenAI tool responses are string-content only,
  // so we can't hand the image back to the model via the tool result — forward
  // it to the UI and give the model a text pointer instead. (User-attached
  // screenshots on the *outgoing* user message still get real vision via
  // image_url content parts — see buildUserContent above.)
  if (result && result.__imageContent) {
    send('llmChat:toolCall', {
      sessionId,
      id,
      name,
      status: 'done',
      summary: `screenshot: ${result.pageUrl} (${result.viewport})`,
    })
    return JSON.stringify({
      pageUrl: result.pageUrl,
      viewport: result.viewport,
      note: 'Screenshot delivered to the user; describe the page or ask a follow-up.',
    })
  }

  // Element-screenshot marker: attachments go to the UI, JSON payload to the
  // model. Keep payloads compact so follow-up turns don't balloon prompt size.
  // filling up on findings-index dumps.
  if (result && Array.isArray(result.__attachments)) {
    for (const att of result.__attachments) {
      send('llmChat:attachment', {
        sessionId,
        toolCallId: id,
        occurrenceIndex: att.occurrenceIndex,
        url: att.url,
        pageTitle: att.pageTitle,
        xpath: att.xpath,
        dataUri: `data:${att.mediaType};base64,${att.base64}`,
      })
    }
    send('llmChat:toolCall', {
      sessionId,
      id,
      name,
      status: 'done',
      summary: `${result.__attachments.length} screenshot(s) attached`,
    })
    const payload = JSON.stringify(result.payload)
    return truncateToolResult(payload)
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result)
  send('llmChat:toolCall', {
    sessionId,
    id,
    name,
    status: 'done',
    summary: `${name} returned ${text.length} bytes`,
  })
  return truncateToolResult(text)
}

function unloadModel() {
  return llamaServer.stop()
}

function disposeSession(session) {
  if (!session?.gemma) return
  session.gemma = null
}

module.exports = { streamGemmaChat, disposeSession, unloadModel, ensureModel }
