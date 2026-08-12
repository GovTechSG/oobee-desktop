// Local-model chat backend using node-llama-cpp with Google's Gemma 4 E4B.
// Mirrors the streaming surface of the Anthropic path in llmAnalysis.js — the
// same 7 tools are exposed via `defineChatSessionFunction`, and the same IPC
// events (`llmChat:chunk`, `llmChat:toolCall`, `llmChat:attachment`) fire so
// the renderer stays provider-agnostic.
//
// node-llama-cpp v3 is ESM-only with top-level await; we `await import()` it
// lazily to keep this a CommonJS module and to avoid loading the ~5 GB model
// (or paying its process startup cost) unless the user actually picks Gemma.

const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const { getModelPath } = require('./llmModelManager')

const log = (...args) => console.log('[llmGemma]', ...args)
const warn = (...args) => console.warn('[llmGemma]', ...args)

let llamaSingleton = null
let modelSingleton = null // { model, path }

async function getLlamaModule() {
  return await import('node-llama-cpp')
}

async function ensureModel() {
  const modelPath = getModelPath()
  if (!(await fs.pathExists(modelPath))) {
    throw new Error('Gemma model not downloaded. Open the LLM Analysis page and download it first.')
  }
  if (modelSingleton && modelSingleton.path === modelPath) return modelSingleton.model

  const { getLlama } = await getLlamaModule()
  if (!llamaSingleton) {
    log('initialising llama.cpp runtime')
    llamaSingleton = await getLlama()
  }
  log(`loading model from ${modelPath}`)
  const model = await llamaSingleton.loadModel({ modelPath })
  modelSingleton = { model, path: modelPath }
  return model
}

// Pick a context window that fits in the RAM headroom this machine actually
// has. Gemma 4 E4B advertises 128 K, but a naive 128 K KV cache at f16 across
// 34 layers is ~1 GB per 8 K tokens — plenty enough to OOM on a laptop still
// holding a 5 GB model in RAM. We reserve ~7 GB (5 GB weights + 2 GB working)
// then map the remainder to a small set of tiers.
//
// Gemma 4 uses hybrid attention: most layers have a 512-token sliding window,
// only a few are global. Effective per-token KV cost is well below the naive
// estimate, so these tiers are conservative on the safe side.
// Baseline: 5.1 GB weights + ~2 GB llama.cpp/Electron working set = 7 GB. On
// macOS `freemem()` is unreliably low because inactive memory shows as "used" —
// so we fall back to `totalmem() - reserved - 4 GB safety` if freemem looks
// pessimistic, and pick the larger of the two estimates.
function pickContextSize() {
  const totalGB = os.totalmem() / (1024 ** 3)
  const freeGB = os.freemem() / (1024 ** 3)
  const reservedGB = 7
  const headroomGB = Math.max(freeGB - reservedGB, totalGB - reservedGB - 4)

  // Real global-attention KV cost is O(n²) on generated tokens, so we don't
  // over-provision — 32 K covers the app's actual usage (system prompt + a few
  // tool round-trips is <15 K) and stays fast on typical laptops.
  //   headroom ≈ 21 GB (32 GB machine)  → 65 K
  //   headroom ≈  5 GB (16 GB machine)  → 32 K
  //   headroom ≈  1 GB (12 GB machine)  → 16 K
  //   headroom ≤  0 GB (8 GB device — swapping likely) → 8 K
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
      `total RAM is only ${totalGB.toFixed(1)}GB — the 5 GB Gemma weights plus Electron will likely swap. Consider using the Anthropic Claude provider instead.`,
    )
  }
  return size
}

async function ensureChatSession(session) {
  if (session.gemma?.chat) return session.gemma

  const model = await ensureModel()
  const { LlamaChatSession } = await getLlamaModule()
  const context = await model.createContext({ contextSize: pickContextSize() })
  const seq = context.getSequence()
  const chat = new LlamaChatSession({
    contextSequence: seq,
    systemPrompt: session.systemPrompt,
    // Rely on Gemma 4's Jinja template baked into the GGUF via auto-detection.
  })
  session.gemma = { chat, context }
  return session.gemma
}

// Gemma 4's chat template uses channel delimiters (`<channel|>reasoning`,
// `<channel|>final`, plus `<|tool_response>` / `</s>` etc.) to bracket
// thinking-mode reasoning and structured segments. node-llama-cpp normally
// consumes these via the Jinja template baked into the GGUF, but the unsloth
// Q4_K_XL build ships with some control tokens mis-classified (the load log
// emits `'<|tool_response>' was not control-type; this is probably a bug in
// the model. its type will be overridden`) — a few of them slip past and
// land in the visible chunk stream as `<channel|>`, `<|message|>`, etc.
//
// Strip them with a small stateful filter: keep an unbounded tail buffer of
// the *shortest string that could still be the start of a template token*
// (a run of `<` `|` `/` letters etc.), flush the rest immediately, and drop
// any full token that matches. This avoids cutting through a token when it
// straddles two chunks.
const GEMMA_TEMPLATE_TOKEN_RE = new RegExp(
  [
    '<channel\\|>[a-zA-Z_]*',      // <channel|>final, <channel|>reasoning, …
    '<\\|channel\\|>[a-zA-Z_]*',   // Harmony-style variant just in case
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
// Any suffix ending mid-token — we hold back this much and re-inspect on the
// next chunk. Bounded to 32 chars to keep the buffer small.
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

// Convert an Anthropic-style tool_use JSON Schema to the subset that
// node-llama-cpp's GBNF grammar builder accepts. The schemas in llmPrompts.js
// are simple enough — no $refs, no oneOf, no format constraints — so they pass
// through directly. Guard against Anthropic-only tweaks anyway.
function sanitiseSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const out = { type: 'object', properties: {}, required: schema.required || undefined }
  for (const [k, v] of Object.entries(schema.properties || {})) {
    const prop = { ...v }
    if (prop.default !== undefined) delete prop.default // GBNF ignores defaults
    out.properties[k] = prop
  }
  return out
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
  const { chat } = await ensureChatSession(session)
  const { defineChatSessionFunction } = await getLlamaModule()

  const send = (channel, payload) => mainWindow.webContents.send(channel, payload)

  // node-llama-cpp v3 is text-only. Verified against the current API surface:
  //   - LlamaModelOptions has no `mmproj` / `projectorPath` field
  //     (https://node-llama-cpp.withcat.ai/api/type-aliases/LlamaModelOptions)
  //   - chat.prompt() takes a string, no image parameter
  //   - The library exposes no `llama-server` spawn helper either — running
  //     llama.cpp's multimodal server as a sidecar would be entirely our own
  //     child_process + HTTP client, plus a per-platform binary + ~992 MB
  //     mmproj file to bundle or download.
  //
  // Native vision is tracked upstream as https://github.com/withcatai/node-llama-cpp/issues/88
  // (targeted for v4.0.0, "In Progress", blocked on upstream libmtmd stabilising
  // in llama.cpp). Once v4 lands with an mmproj loader we can pass the image
  // directly here; until then, Anthropic Claude is the provider that can
  // actually see attachments — Gemma only gets the metadata note below.
  //
  // Alternatives considered and rejected for now:
  //   - Tesseract.js OCR: local, cheap, but text-only extraction (misses
  //     colour / layout / icon-only issues) and adds a ~10 MB WASM dep for a
  //     partial win.
  //   - External llama-server sidecar with mmproj: real vision, but multi-
  //     hundred-line packaging work per platform plus ~1 GB download; not
  //     justified when v4 will supersede it.
  let promptText = userMessage
  if (Array.isArray(attachments) && attachments.length > 0) {
    const notes = attachments
      .map((a, i) => {
        const bits = []
        if (typeof a.occurrenceIndex === 'number') bits.push(`occurrence #${a.occurrenceIndex + 1}`)
        if (a.pageTitle) bits.push(`page "${a.pageTitle}"`)
        if (a.url) bits.push(a.url)
        if (a.xpath) bits.push(`xpath ${a.xpath}`)
        return `- Screenshot ${i + 1}: ${bits.join(', ') || 'unlabeled'}`
      })
      .join('\n')
    promptText =
      `${userMessage}\n\n---\n[Note: the user attached ${attachments.length} screenshot(s), but this local model runner is text-only and cannot view them. Reason from the HTML, xpath, and message provided. If you need visual context (colour contrast, layout, focus order), call get_page_screenshot which delivers the image to the user separately.]\n${notes}`
  }

  // Build the function table. Each handler dispatches into the shared
  // `runTool` implementation from llmAnalysis.js, then converts the result to
  // a string (or emits attachments to the UI + returns just the JSON payload).
  const functions = {}
  for (const t of toolSchemas) {
    const params = sanitiseSchema(t.input_schema)
    functions[t.name] = defineChatSessionFunction({
      description: t.description,
      params,
      handler: async (args) => {
        const id = `gemma-${t.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        send('llmChat:toolCall', { sessionId, id, name: t.name, status: 'start' })
        send('llmChat:toolCall', { sessionId, id, name: t.name, status: 'ready', input: args })
        let result
        try {
          result = runTool(session, t.name, args || {})
        } catch (e) {
          send('llmChat:toolCall', {
            sessionId,
            id,
            name: t.name,
            status: 'error',
            summary: e.message,
          })
          return JSON.stringify({ error: e.message })
        }

        // Full-page screenshot marker: Gemma can't consume base64 image blocks
        // inside a function-call return, so we forward the image to the UI
        // only and give the model a text pointer.
        if (result && result.__imageContent) {
          send('llmChat:toolCall', {
            sessionId,
            id,
            name: t.name,
            status: 'done',
            summary: `screenshot: ${result.pageUrl} (${result.viewport})`,
          })
          return JSON.stringify({
            pageUrl: result.pageUrl,
            viewport: result.viewport,
            note: 'Screenshot delivered to the user; describe the page or ask a follow-up.',
          })
        }

        // Element-screenshot marker: attachments go to the UI, text payload to
        // the model.
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
            name: t.name,
            status: 'done',
            summary: `${result.__attachments.length} screenshot(s) attached`,
          })
          const payload = JSON.stringify(result.payload)
          return payload.length > 40_000 ? payload.slice(0, 40_000) + '\n…[truncated]' : payload
        }

        const text = typeof result === 'string' ? result : JSON.stringify(result)
        send('llmChat:toolCall', {
          sessionId,
          id,
          name: t.name,
          status: 'done',
          summary: `${t.name} returned ${text.length} bytes`,
        })
        return text.length > 40_000 ? text.slice(0, 40_000) + '\n…[truncated]' : text
      },
    })
  }

  const abort = new AbortController()
  session.abort = abort
  const filter = createTemplateTokenFilter()

  // Gemma 4 recommended sampling per the model card:
  // temperature=1.0, topP=0.95, topK=64
  try {
    await chat.prompt(promptText, {
      functions,
      signal: abort.signal,
      temperature: 1.0,
      topP: 0.95,
      topK: 64,
      maxTokens: 4000,
      onTextChunk: (text) => {
        const cleaned = filter.push(text)
        if (cleaned) send('llmChat:chunk', { sessionId, text: cleaned })
      },
    })
    const tail = filter.flush()
    if (tail) send('llmChat:chunk', { sessionId, text: tail })
  } catch (e) {
    if (abort.signal.aborted) {
      log(`session ${sessionId} aborted mid-response`)
      return
    }
    throw e
  }
}

function unloadModel() {
  if (modelSingleton?.model?.dispose) {
    try {
      modelSingleton.model.dispose()
    } catch (e) {
      warn(`dispose model failed: ${e.message}`)
    }
  }
  modelSingleton = null
}

function disposeSession(session) {
  if (!session?.gemma) return
  try {
    session.gemma.context?.dispose?.()
  } catch (e) {
    warn(`dispose context failed: ${e.message}`)
  }
  session.gemma = null
}

module.exports = { streamGemmaChat, disposeSession, unloadModel, ensureModel }
