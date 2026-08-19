// Generic OpenAI-compatible chat backend for the "OpenAI Compatible Provider"
// provider option. Lets a user point the app at ANY server speaking the
// standard `/chat/completions` streaming wire format — a self-hosted Ollama
// / LM Studio / Open WebUI instance, a corporate LLM gateway, OpenRouter,
// etc. — by supplying a base URL, API key, and model name via the Configure
// modal in the renderer (see ChatPage/index.jsx), persisted through
// userDataManager's generic user-settings file.
//
// Structurally this mirrors llmGemma.js's tool-loop/streaming design (same
// wire format), but talks to an arbitrary remote endpoint instead of the
// bundled local llama-server subprocess, so the specifics differ:
//   - No local KV-cache/prompt-cache concerns (that was llama-server-
//     specific tuning), so history trimming here is a simple flat cap
//     rather than the hysteresis scheme llmGemma.js uses.
//   - No Gemma chat-template leakage to filter (`createTemplateTokenFilter`
//     in llmGemma.js was a Gemma-specific workaround).
//   - Tool-call dispatch and attachment/screenshot handling IS
//     provider-agnostic (same OpenAI tool_calls wire shape either way), so
//     `runToolCall` and `toOpenAITools` are imported from llmGemma.js
//     instead of being duplicated here.

const { toOpenAITools, runToolCall } = require('./llmGemma')

const log = (...args) => console.log('[llmOpenAICompatible]', ...args)
const warn = (...args) => console.warn('[llmOpenAICompatible]', ...args)

// Flat cap on conversation size. Unlike llmGemma.js's hysteresis (tuned to
// avoid invalidating llama-server's local prompt cache), a remote API has no
// such cache for us to preserve, so a simple "trim to target when over
// ceiling" is sufficient here.
const MAX_HISTORY_CHARS = 60_000
const HISTORY_TARGET_CHARS = 40_000
const MAX_HISTORY_MESSAGES = 24
// Same two-tier idle-reset design as llmGemma.js (see that file for the
// full rationale): a flat ceiling for the silent pre-first-chunk phase, then
// a much shorter idle window that rearms on every chunk once streaming
// starts, so a slow-but-actively-streaming remote model is never killed
// just for taking a while. Remote APIs are less likely than local
// hardware-constrained inference to have a multi-minute silent prefill, so
// both numbers are tighter than llmGemma.js's local-hardware-tuned values.
const FIRST_CHUNK_TIMEOUT_MS = 120_000
const IDLE_TIMEOUT_MS = 60_000
const MAX_TOOL_RESULT_CHARS = 40_000

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

function trimHistory(messages) {
  if (!Array.isArray(messages) || messages.length <= 2) return
  const system = messages[0]
  const tail = messages.slice(1)
  const systemChars = estimateMessageChars(system)
  const totalChars = tail.reduce((n, m) => n + estimateMessageChars(m), systemChars)
  if (tail.length <= MAX_HISTORY_MESSAGES && totalChars <= MAX_HISTORY_CHARS) return

  const kept = []
  let chars = systemChars
  for (let i = tail.length - 1; i >= 0; i--) {
    const msg = tail[i]
    const msgChars = estimateMessageChars(msg)
    if (kept.length >= MAX_HISTORY_MESSAGES) break
    if (kept.length > 0 && chars + msgChars > HISTORY_TARGET_CHARS) break
    kept.unshift(msg)
    chars += msgChars
  }
  while (kept.length > 0 && kept[0]?.role === 'tool') kept.shift()

  const next = [system, ...kept]
  const dropped = messages.length - next.length
  if (dropped > 0) {
    log(`trimmed history: dropped ${dropped} old message(s), kept ${next.length}`)
    messages.splice(0, messages.length, ...next)
  }
}

function truncateToolResult(text) {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return text.slice(0, MAX_TOOL_RESULT_CHARS) + '\n…[truncated]'
}

// Build the user message content array. Text-only when there are no image
// attachments; a content array with image_url parts otherwise. Not every
// OpenAI-compatible endpoint supports vision, but the shape is harmless to
// send either way — servers that don't support it will simply ignore or
// error on the image part per their own validation.
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

// SSE parser for /chat/completions?stream=true — identical wire format to
// llmGemma.js's readChatSSE (both are the same OpenAI streaming protocol),
// duplicated here to keep this module self-contained and independently
// testable against a different base URL/response reader.
async function* readChatSSE(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
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

async function streamOpenAICompatibleChat({
  session,
  mainWindow,
  sessionId,
  userMessage,
  attachments,
  runTool,
  toolSchemas,
}) {
  const send = (channel, payload) => mainWindow.webContents.send(channel, payload)
  const cfg = session.customConfig
  if (!cfg || !cfg.baseUrl || !cfg.model) {
    throw new Error(
      'OpenAI-compatible provider is not configured. Click "Configure" next to the model selector and fill in the API endpoint and model name.',
    )
  }
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '')

  if (!session.openai) {
    session.openai = { messages: [{ role: 'system', content: session.systemPrompt }] }
  }
  session.openai.messages.push({ role: 'user', content: buildUserContent(userMessage, attachments) })

  const abort = new AbortController()
  session.abort = abort

  const tools = toOpenAITools(toolSchemas)
  const toolByName = new Map(toolSchemas.map((t) => [t.name, t]))

  const MAX_TOOL_HOPS = 8
  const MAX_EMPTY_RESPONSE_RETRIES = 1
  let emptyResponseRetries = 0

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    trimHistory(session.openai.messages)
    const requestAbort = new AbortController()
    let timeoutId = setTimeout(() => {
      requestAbort.abort(new Error(`no response within ${FIRST_CHUNK_TIMEOUT_MS}ms (stuck before first token)`))
    }, FIRST_CHUNK_TIMEOUT_MS)
    const armIdleTimeout = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        requestAbort.abort(new Error(`no new tokens for ${IDLE_TIMEOUT_MS}ms (generation appears stalled)`))
      }, IDLE_TIMEOUT_MS)
    }
    const onUserAbort = () => requestAbort.abort(new Error('aborted by user'))
    abort.signal.addEventListener('abort', onUserAbort, { once: true })

    const approxChars = session.openai.messages.reduce((n, m) => n + estimateMessageChars(m), 0)
    log(`hop=${hop + 1}/${MAX_TOOL_HOPS} messages=${session.openai.messages.length} approxChars=${approxChars}`)
    send('llmChat:usage', {
      sessionId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: Math.round(approxChars / 4),
      isEstimate: true,
    })

    const hopRequestStart = Date.now()

    let res
    let content = ''
    const toolCalls = new Map()
    let finishReason = null
    let usage = null

    try {
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: requestAbort.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: session.openai.messages,
            tools,
            tool_choice: 'auto',
            stream: true,
            stream_options: { include_usage: true },
          }),
        })
      } catch (e) {
        if (abort.signal.aborted || requestAbort.signal.aborted) {
          log(`session ${sessionId} aborted before response stream opened`)
          return
        }
        throw e
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`OpenAI-compatible endpoint returned ${res.status}: ${text.slice(0, 500)}`)
      }

      try {
        for await (const chunk of readChatSSE(res)) {
          armIdleTimeout()
          if (chunk.usage) usage = chunk.usage
          const choice = chunk.choices?.[0]
          if (!choice) continue
          const delta = choice.delta || {}
          if (typeof delta.content === 'string' && delta.content.length) {
            content += delta.content
            send('llmChat:chunk', { sessionId, text: delta.content })
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
        if (abort.signal.aborted || requestAbort.signal.aborted) {
          log(
            `session ${sessionId} aborted mid-response${requestAbort.signal.aborted && !abort.signal.aborted ? ' (timeout: generation stalled or never started)' : ''}`,
          )
          return
        }
        throw e
      }
    } finally {
      clearTimeout(timeoutId)
      abort.signal.removeEventListener('abort', onUserAbort)
    }

    if (usage) {
      const hopElapsedSec = Math.max((Date.now() - hopRequestStart) / 1000, 0.001)
      const measuredTokPerSec = usage.completion_tokens
        ? (usage.completion_tokens / hopElapsedSec).toFixed(2)
        : 'n/a'
      log(
        `hop=${hop + 1} usage: prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} total_tokens=${usage.total_tokens} wallClockSec=${hopElapsedSec.toFixed(1)} measuredTokPerSec=${measuredTokPerSec}`,
      )
      send('llmChat:usage', {
        sessionId,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        isEstimate: false,
      })
    }

    if (toolCalls.size > 0) {
      const calls = Array.from(toolCalls.values()).map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.args || '{}' },
      }))
      session.openai.messages.push({ role: 'assistant', content: content || null, tool_calls: calls })

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
        session.openai.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: truncateToolResult(toolResult),
        })
      }
      continue
    }

    if (!content.trim()) {
      if (emptyResponseRetries < MAX_EMPTY_RESPONSE_RETRIES) {
        emptyResponseRetries++
        warn(`hop ${hop + 1} produced an empty response (finish_reason=${finishReason}) — nudging the model to continue`)
        session.openai.messages.push({
          role: 'user',
          content: 'You stopped without giving an answer. Please provide your response now based on what you already know from the tool results above.',
        })
        continue
      }
      throw new Error('Model returned an empty response after retrying. Please try again.')
    }

    session.openai.messages.push({ role: 'assistant', content })
    if (finishReason && finishReason !== 'stop' && finishReason !== 'length') {
      warn(`unexpected finish_reason: ${finishReason}`)
    }
    return
  }

  warn(`hit MAX_TOOL_HOPS=${MAX_TOOL_HOPS} — bailing to avoid an infinite tool loop`)
}

function disposeSession(session) {
  if (!session?.openai) return
  session.openai = null
}

module.exports = { streamOpenAICompatibleChat, disposeSession }
