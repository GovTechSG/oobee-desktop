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
const { execFileSync } = require('child_process')
const { getModelPath, getMmprojPath } = require('./llmModelManager')
const llamaServer = require('./llamaServer')

const log = (...args) => console.log('[llmGemma]', ...args)
const warn = (...args) => console.warn('[llmGemma]', ...args)

// win32-x64 runs llama.cpp's Vulkan backend, which — unlike the two
// unified-memory targets we ship for (darwin-arm64 Metal, win32-arm64 Adreno
// OpenCL, where GPU and CPU share one physical RAM pool) — can be backed by
// a discrete GPU with its own separate VRAM pool. With `-ngl 999` (full GPU
// offload, see buildArgs in llamaServer.js), VRAM capacity is what weights +
// mmproj + KV cache actually have to fit inside on that target; system RAM
// can be a very misleading proxy there (e.g. 64 GB system RAM with a 4 GB
// discrete GPU would wrongly size a huge context that doesn't fit on-GPU).
//
// Detect dedicated VRAM via the registry rather than WMI's
// Win32_VideoController.AdapterRAM, which is a well-known-unreliable 32-bit
// field that wraps/misreports for GPUs with >4 GB VRAM on many drivers.
// HardwareInformation.qwMemorySize is a 64-bit value under each display
// adapter's driver subkey and is accurate for modern discrete GPUs.
// Class GUID {4d36e968-e325-11ce-bfc1-08002be10318} = "Display adapters".
// Cached for the process lifetime (queried once) — same rationale as
// resolveContextSize() below: this reflects the machine's hardware, not
// something that should be re-probed on every message send.
let cachedVramBytes // undefined = not probed yet; null = probed, unavailable
function getWindowsDedicatedVramBytes() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return null
  if (cachedVramBytes !== undefined) return cachedVramBytes
  try {
    const psScript = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$base = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}"',
      'Get-ChildItem $base | ForEach-Object {',
      '  $v = (Get-ItemProperty -Path $_.PsPath -Name "HardwareInformation.qwMemorySize" -ErrorAction SilentlyContinue)."HardwareInformation.qwMemorySize"',
      '  if ($v) { Write-Output $v }',
      '}',
    ].join('; ')
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 5000, encoding: 'utf8', windowsHide: true },
    )
    const values = out
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    // Multiple entries can appear (integrated + discrete GPU). llama.cpp's
    // Vulkan device selection generally prefers the most capable device, so
    // use the largest reported VRAM as our sizing budget.
    cachedVramBytes = values.length > 0 ? Math.max(...values) : null
  } catch (e) {
    warn(`VRAM detection failed, falling back to system-RAM heuristic: ${e.message}`)
    cachedVramBytes = null
  }
  return cachedVramBytes
}

// Token-budget guardrails for local inference stability. Large tool payloads
// and long chat history can force multi-thousand-token prompt reprocessing on
// each tool hop, which degrades throughput and increases CPU pressure.
const MAX_TOOL_RESULT_CHARS = 12_000
const MAX_HISTORY_MESSAGES = 18
// Ceiling that triggers a trim, and a lower target we cut back to once
// triggered (hysteresis). llama-server caches the KV state for whatever
// prefix it last decoded (see llamaServer.js buildArgs) and reuses it when
// the next request's messages[] shares that prefix. If we trimmed down to
// just-under-MAX_HISTORY_CHARS every time (the old behaviour), a single
// large tool result would push us back over the ceiling almost every hop —
// each trim changes the prefix, which invalidates the cache and forces a
// full reprocess. Cutting deep to HISTORY_TARGET_CHARS instead means the
// trimmed prefix has real headroom to grow across several more hops before
// triggering again, so the cache actually gets reused between trims.
const MAX_HISTORY_CHARS = 55_000
const HISTORY_TARGET_CHARS = 30_000
// Two-tier timeout, not one flat ceiling from request start. llama-server
// sends nothing at all over the SSE stream during prompt processing/prefill
// — we have no visibility into that phase's progress — so a request that's
// genuinely still working can go quiet for minutes before the first token
// (we measured 230s of prefill in one hop). FIRST_CHUNK_TIMEOUT_MS is a
// generous flat ceiling for that silent phase (a real hang before any
// output starts). Once streaming begins, each individual chunk arrives in
// tens-to-hundreds of ms even on slow hardware — a gap of IDLE_TIMEOUT_MS
// with zero new chunks means the generation has genuinely stalled, not just
// "is slow but still working". The timer is rearmed with IDLE_TIMEOUT_MS on
// every chunk received, so a hop that's actively streaming (even a very
// slow one — we've measured legitimate hops over 450s) is never killed for
// simply taking a long time; only a real stall trips it.
const FIRST_CHUNK_TIMEOUT_MS = 600_000
const IDLE_TIMEOUT_MS = 120_000
// After a model (re)start, /v1/chat/completions can briefly return
// `503 {"error":{"message":"Loading model"...}}` while weights/KV warm up.
// Treat this as transient and retry with short backoff instead of failing the
// whole turn when users switch CPU-only <-> GPU mode.
const MODEL_LOADING_MAX_RETRIES = 10
const MODEL_LOADING_RETRY_BASE_MS = 750

// Context window sizing — same tiered heuristic we used with node-llama-cpp,
// because the RAM math is the same underneath. Gemma 4's hybrid attention
// (mostly sliding-window 512, a few global layers) keeps the effective KV
// cost well below the naive f16-across-all-layers estimate, so these tiers
// are conservative on the safe side. Baseline: ~5–7 GB weights + ~1 GB mmproj
// + ~2 GB llama-server/Electron working set = ~10 GB. On macOS `freemem()`
// under-reports because inactive memory shows as "used"; fall back to
// `totalmem() - reserved - 4 GB safety` and pick the larger.
// Note: `reservedGB` assumes effectively single-slot KV memory usage. This
// held true even before we pinned llama-server to `-np 1` (see buildArgs in
// llamaServer.js) because logs showed `kv_unified = 'true'` under the old
// n_slots=4 default too — the KV buffer is shared across slots, not
// multiplied by slot count. So `-np 1` doesn't change this math; it only
// fixes cache-slot-selection ambiguity, not memory footprint.
function pickContextSize() {
  const reservedGB = 8 // weights + mmproj + working set

  // win32-x64 (Vulkan) can be a discrete GPU with its own VRAM pool separate
  // from system RAM — size from detected VRAM there instead of system RAM.
  // darwin-arm64 (Metal) and win32-arm64 (Adreno OpenCL) are both genuinely
  // unified-memory architectures where system RAM is the correct proxy, so
  // they fall through to the RAM-based tiering below unchanged.
  const vramBytes = getWindowsDedicatedVramBytes()
  if (vramBytes !== null) {
    const vramGB = vramBytes / (1024 ** 3)
    const vramHeadroomGB = vramGB - reservedGB

    let size
    if (vramHeadroomGB >= 20) size = 65536
    else if (vramHeadroomGB >= 5) size = 32768
    else if (vramHeadroomGB >= 1) size = 16384
    else size = 8192

    log(
      `contextSize=${size} (VRAM=${vramGB.toFixed(1)}GB, vramHeadroom≈${vramHeadroomGB.toFixed(1)}GB) [win32-x64 Vulkan: sized from detected dedicated VRAM, not system RAM]`,
    )
    if (vramGB < 6) {
      warn(
        `detected dedicated VRAM is only ${vramGB.toFixed(1)}GB — Gemma weights plus mmproj will likely spill off-GPU and run slowly. Consider using the Anthropic Claude provider instead.`,
      )
    }
    return size
  }

  const totalGB = os.totalmem() / (1024 ** 3)
  const freeGB = os.freemem() / (1024 ** 3)
  // Extra safety padding on top of reservedGB, used only by the total-RAM
  // floor branch below (the fallback for when freemem() itself is
  // unreliable — see note above). Reduced from 4 -> 2 on 2026-08-19 after
  // two empirical findings on a 31.6 GB Snapdragon X unified-memory
  // machine: (a) real peak usage under heavy scan+chat load topped out at
  // ~21 GB, leaving >10 GB genuinely free — more margin than the old 4 GB
  // padding assumed; (b) an A/B hop comparison at the SAME allocated
  // `-c 32768` ceiling showed decode/prefill slowdown tracks actual
  // conversation depth in use (prompt_tokens), not the size of the
  // allocated ceiling itself (hop1 ~3800 tokens: prefill 95.5 tok/s, decode
  // 7.57 tok/s; hop2 ~10600 tokens, same ceiling: prefill 29.6 tok/s,
  // decode 5.20 tok/s — see llmGemma hop usage logs from that session). So
  // a larger ceiling does not itself introduce the overhead this padding
  // was originally guarding against; only real usage depth does.
  const safetyMarginGB = 2
  const headroomGB = Math.max(freeGB - reservedGB, totalGB - reservedGB - safetyMarginGB)

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

// pickContextSize() reads live free RAM, which drifts by hundreds of MB to a
// few GB just from normal OS/Electron/browser churn over a session. Calling
// it fresh on every ensureModel() invocation (i.e. every user message send)
// meant an ordinary RAM-reading drift across a tier boundary (5 GB / 20 GB
// headroom) would change the computed contextSize turn-to-turn, make
// llamaServer.ensure()'s sameConfig() check see a "config change", and
// forcibly restart the running server — including killing an in-flight
// request mid-stream (Windows child_process.kill() always maps to an
// abrupt TerminateProcess; this surfaced as `chat error: terminated` plus
// `server exited (code=4294967295, signal=null)` in the field). The RAM
// tier is meant to reflect the machine's RAM class once, not fluctuate
// per turn, so cache it for the process lifetime instead of resampling.
let cachedContextSize = null
function resolveContextSize() {
  if (cachedContextSize === null) {
    cachedContextSize = pickContextSize()
  }
  return cachedContextSize
}

// Resolve model + mmproj paths and (re)start the llama-server subprocess
// pointing at them. Idempotent: repeated calls for the same modelId (and the
// same cpuOnly mode) don't respawn; a different modelId or a CPU/GPU mode
// switch does (llamaServer.ensure handles that via sameConfig()).
async function ensureModel(modelId, cpuOnly) {
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
    contextSize: resolveContextSize(),
    cpuOnly: !!cpuOnly,
  })
  return { baseUrl, modelId }
}

// Historical defensive filter: Gemma's chat template uses channel delimiters
// (`<channel|>reasoning`, `<|tool_response>`, etc.) that llama-server should
// consume server-side with `--jinja`. If any leak through we strip them here.
// Kept across the node-llama-cpp → llama-server migration as belt-and-braces.
//
// Gemma 4 added a "thinking" mode with its own channel marker convention that
// is asymmetric from the older style above: opener `<|channel>thought` (pipe
// only on the left) vs. closer `<channel|>` (pipe only on the right) — see
// the model card's "Thinking Mode Configuration" section. Neither side of
// that pair matches the older `<\|channel\|>` (pipes on both sides) pattern,
// so without this addition any leaked thinking markers would render as raw
// text in the chat instead of being stripped.
const GEMMA_TEMPLATE_TOKEN_RE = new RegExp(
  [
    '<channel\\|>[a-zA-Z_]*',
    '<\\|channel\\|>[a-zA-Z_]*',
    '<\\|channel>[a-zA-Z_]*',
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

  // Hysteresis gate: only trim when actually over the ceiling. Scanning here
  // is cheap and a no-op below the ceiling, so this is safe to call every hop.
  const systemChars = estimateMessageChars(system)
  const totalChars = tail.reduce((n, m) => n + estimateMessageChars(m), systemChars)
  if (tail.length <= MAX_HISTORY_MESSAGES && totalChars <= MAX_HISTORY_CHARS) return

  const kept = []
  let chars = systemChars
  for (let i = tail.length - 1; i >= 0; i--) {
    const msg = tail[i]
    const msgChars = estimateMessageChars(msg)
    if (kept.length >= MAX_HISTORY_MESSAGES) break
    // Cut back to the lower HISTORY_TARGET_CHARS floor, not just under the
    // ceiling, so the resulting prefix is stable for several future hops.
    if (kept.length > 0 && chars + msgChars > HISTORY_TARGET_CHARS) break
    kept.unshift(msg)
    chars += msgChars
  }

  while (kept.length > 0 && kept[0]?.role === 'tool') kept.shift()

  const next = [system, ...kept]
  const dropped = messages.length - next.length
  if (dropped > 0) {
    log(
      `trimmed gemma history: dropped ${dropped} old message(s), kept ${next.length} (cut to ${HISTORY_TARGET_CHARS} char floor so prefix stays stable for llama-server's prompt cache)`,
    )
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

function isModelLoading503(status, text) {
  if (status !== 503) return false
  const body = String(text || '')
  if (/loading\s+model/i.test(body)) return true
  try {
    const parsed = JSON.parse(body)
    const msg = String(parsed?.error?.message || '')
    return /loading\s+model/i.test(msg)
  } catch (_) {
    return false
  }
}

function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      signal?.removeEventListener?.('abort', onAbort)
      reject(new Error('aborted'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
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
  const { baseUrl } = await ensureModel(session.modelId || 'gemma-e4b', session.cpuOnly)
  if (!session.gemma) {
    // Note: Gemma 4's documented `<|think|>` thinking-mode trigger was
    // tried here and confirmed (via live testing, multiple hops, raw
    // output sampling) to have NO effect on this model/llama-server combo
    // — zero thinking-channel content was ever produced, so "Thinking" is
    // Anthropic-only for now (see the UI toggle in ChatPage/index.jsx).
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
    // Was 2000 — field report: a hop hit finish_reason='length' at exactly
    // 2000 completion_tokens while the visible answer was only one short
    // sentence. Bumped to match the Anthropic path's max_tokens (4000) so
    // ordinary detailed answers have real headroom instead of hitting a
    // hard wall mid-explanation. (A "thinking" mode budget bump was tried
    // here and reverted — see streamGemmaChat's session.gemma init comment;
    // Gemma 4 E2B/E4B never produced any thinking-channel content via
    // llama-server in live testing, so there's no reasoning pass to budget
    // extra headroom for.)
    max_tokens: 4000,
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
  // Bounded retry for the empty-final-turn case below: local Gemma
  // occasionally emits a single EOS-only completion (0 tokens generated,
  // finish_reason=stop) right after a tool result it can't act on further
  // (e.g. a get_page_screenshot marker with no real vision attached — see
  // runToolCall's __imageContent branch). One nudge-and-retry recovers most
  // of these instead of hard-failing the whole turn.
  const MAX_EMPTY_RESPONSE_RETRIES = 1
  let emptyResponseRetries = 0

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    trimGemmaHistory(session.gemma.messages)
    const requestAbort = new AbortController()
    // Starts armed with the generous first-chunk ceiling (covers silent
    // prefill); rearmed with the much shorter idle window on every chunk
    // received once streaming begins — see the constants' doc comment above.
    let timeoutId = setTimeout(() => {
      requestAbort.abort(new Error(`no response from llama-server within ${FIRST_CHUNK_TIMEOUT_MS}ms (stuck before first token)`))
    }, FIRST_CHUNK_TIMEOUT_MS)
    const armIdleTimeout = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        requestAbort.abort(new Error(`no new tokens for ${IDLE_TIMEOUT_MS}ms (generation appears stalled)`))
      }, IDLE_TIMEOUT_MS)
    }
    const onUserAbort = () => requestAbort.abort(new Error('aborted by user'))
    abort.signal.addEventListener('abort', onUserAbort, { once: true })

    const approxChars = session.gemma.messages.reduce((n, m) => n + estimateMessageChars(m), 0)
    log(`hop=${hop + 1}/${MAX_TOOL_HOPS} messages=${session.gemma.messages.length} approxChars=${approxChars}`)

    // Prompt processing (prefill) genuinely consumes/reads tokens before any
    // are generated — llama-server's own console shows this as "prompt
    // processing, n_tokens=..., progress=...". The authoritative usage
    // object only arrives once the whole hop completes though, so without
    // this the GUI showed nothing at all during what can be the longest
    // part of a turn. Emit a rough estimate now (~4 chars/token, same
    // heuristic used elsewhere for approximations) so the indicator has
    // something during processing; it gets overwritten with the real
    // count from the completed hop below.
    send('llmChat:usage', {
      sessionId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: Math.round(approxChars / 4),
      isEstimate: true,
    })

    // Wall-clock timing for this hop's request, paired with the server's own
    // authoritative token counts (via stream_options.include_usage below) so
    // we can log a measured tokens/sec per hop instead of relying only on
    // the client-side approximation used for the live UI indicator. This is
    // pure instrumentation — no inference/config behavior change — added to
    // empirically test whether decode speed correlates with context depth
    // (prompt_tokens) rather than guessing from Task Manager readings alone.
    const hopRequestStart = Date.now()

    let res
    let content = '' // accumulated assistant text this hop
    const toolCalls = new Map() // index → { id, name, args }
    let finishReason = null
    let usage = null // set from the final SSE chunk's usage field, if present

    // Both the fetch() call and the SSE-reading loop below share ONE
    // try/finally so the timeout (and user-abort forwarding) stay armed for
    // the entire hop. Bug fixed here: `fetch()` resolves as soon as response
    // HEADERS arrive — for a `stream: true` request that happens almost
    // immediately, long before generation finishes. The previous code
    // cleared the timeout in a `finally` attached only to the fetch() call,
    // so REQUEST_TIMEOUT_MS was cancelled right after each request started
    // and never actually covered the body-streaming phase, where all the
    // real time is spent. Confirmed in the field: a hop ran 453.7s — well
    // past the 180s timeout — and completed with no abort at all.
    //
    // llama-server sends NOTHING over the SSE stream during prompt
    // processing (prefill) — a hop with a large/uncached tool result can
    // spend minutes here with the renderer showing only a ticking "Xs …
    // processing" and no indication of what's actually happening. llama-
    // server does log its own periodic prefill progress to stderr though
    // ("prompt processing, n_tokens = …, progress = …"), which llamaServer.js
    // parses and re-emits as 'promptProgress' — forward that to the
    // renderer via the same llmChat:status channel used for the model
    // warm-up message, so the user sees real percentage/token/speed
    // progress instead of silence. Cleared automatically once the first
    // real chunk arrives (see onLlmChatChunk in ChatPage).
    const onPromptProgress = ({ tokensProcessed, progress, tokensPerSec }) => {
      const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100)
      send('llmChat:status', {
        sessionId,
        message: `Processing prompt… ${pct}% · ${tokensProcessed.toLocaleString()} tokens · ~${tokensPerSec.toFixed(0)} tok/s`,
      })
    }
    llamaServer.events.on('promptProgress', onPromptProgress)
    try {
      for (let loadingRetry = 0; ; loadingRetry++) {
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
              // llama-server (OpenAI-compatible endpoint) supports the standard
              // stream_options.include_usage field: the final SSE chunk gets an
              // empty `choices` array plus a `usage` object with authoritative
              // prompt_tokens/completion_tokens/total_tokens for this request.
              // Diagnostic-only — does not change generation behavior.
              stream_options: { include_usage: true },
              // Explicit belt-and-braces: llama-server defaults this to true, but
              // we rely on it heavily now (single slot + hysteresis-trimmed
              // history, see llamaServer.js buildArgs and MAX_HISTORY_CHARS above)
              // so make it non-negotiable rather than trusting the server default.
              cache_prompt: true,
              ...samplingKnobs,
            }),
          })
        } catch (e) {
          if (abort.signal.aborted || requestAbort.signal.aborted) {
            log(`session ${sessionId} aborted before response stream opened`)
            return
          }
          throw e
        }

        if (res.ok) break

        const text = await res.text().catch(() => '')
        const shouldRetryLoading =
          isModelLoading503(res.status, text) && loadingRetry < MODEL_LOADING_MAX_RETRIES
        if (!shouldRetryLoading) {
          throw new Error(`llama-server returned ${res.status}: ${text.slice(0, 500)}`)
        }

        const waitMs = Math.min(5000, MODEL_LOADING_RETRY_BASE_MS * (loadingRetry + 1))
        send('llmChat:status', {
          sessionId,
          message: `Switching model, warming up local Gemma (${loadingRetry + 1}/${MODEL_LOADING_MAX_RETRIES})…`,
        })
        warn(
          `llama-server still loading model (503) after CPU/GPU switch; retry ${loadingRetry + 1}/${MODEL_LOADING_MAX_RETRIES} in ${waitMs}ms`,
        )
        await waitWithAbort(waitMs, requestAbort.signal)
      }

      // We got a stream response; clear any transient warm-up status line.
      send('llmChat:status', { sessionId, message: null })

      try {
        for await (const chunk of readChatSSE(res)) {
          // Any received chunk is proof the request is still actively
          // progressing (prefill finished and/or a new token arrived) --
          // rearm with the short idle window instead of leaving the long
          // first-chunk ceiling in effect for the rest of the hop.
          armIdleTimeout()
          if (chunk.usage) usage = chunk.usage
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
      llamaServer.events.off('promptProgress', onPromptProgress)
    }

    const tail = filter.flush()
    if (tail) send('llmChat:chunk', { sessionId, text: tail })

    // Log the server's authoritative token counts + measured wall-clock
    // tok/s for this hop, when available, so slowdowns can be correlated
    // against real context depth (prompt_tokens) instead of guessed at.
    if (usage) {
      const hopElapsedSec = Math.max((Date.now() - hopRequestStart) / 1000, 0.001)
      const measuredTokPerSec = usage.completion_tokens
        ? (usage.completion_tokens / hopElapsedSec).toFixed(2)
        : 'n/a'
      log(
        `hop=${hop + 1} usage: prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} total_tokens=${usage.total_tokens} wallClockSec=${hopElapsedSec.toFixed(1)} measuredTokPerSec=${measuredTokPerSec}`,
      )
      // Forward to the renderer so the live indicator can show real token
      // counts next to the processing/tok-per-sec line, instead of only
      // being visible in the main-process console. isEstimate:false marks
      // this as authoritative, overwriting the rough pre-request estimate
      // sent at the top of this hop.
      send('llmChat:usage', {
        sessionId,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        isEstimate: false,
      })
    }

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
      if (emptyResponseRetries < MAX_EMPTY_RESPONSE_RETRIES) {
        emptyResponseRetries++
        warn(
          `hop ${hop + 1} produced an empty response (finish_reason=${finishReason}) — nudging the model to continue instead of failing immediately`,
        )
        session.gemma.messages.push({
          role: 'user',
          content:
            'You stopped without giving an answer. Please provide your response now based on what you already know from the tool results above — do not call another tool unless you genuinely still need one.',
        })
        continue
      }
      throw new Error('Model returned an empty response after retrying. Please try again.')
    }

    // No tool call — this is the final assistant turn.
    if (finishReason === 'length') {
      // Hit max_tokens before the model naturally finished. Log the visible
      // content length alongside completion_tokens so a large gap between
      // them (like the field case that motivated this: completion_tokens=
      // 2000 vs. a one-sentence visible answer) is easy to spot in the
      // console — that gap points at hidden-channel content (e.g. Gemma 4
      // "thinking") consuming the budget rather than genuine long output.
      warn(
        `hop ${hop + 1} hit max_tokens (finish_reason='length'): visible content=${content.length} chars vs completion budget=${samplingKnobs.max_tokens} tokens`,
      )
      // Shown to the user only — NOT appended to the persisted `content`
      // that goes into session.gemma.messages, so the model's own history
      // doesn't end up containing a note it never actually wrote (which
      // could confuse it into thinking it authored that note in a later turn).
      const cutoffNote =
        '\n\n*(Response was cut short — reached the model’s output length limit. Try asking a more focused follow-up question.)*'
      send('llmChat:chunk', { sessionId, text: cutoffNote })
    }
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

module.exports = {
  streamGemmaChat,
  disposeSession,
  unloadModel,
  ensureModel,
  // Reused by llmOpenAICompatible.js: both providers speak the same OpenAI
  // tool-calling wire format, so the tool-schema conversion and per-call
  // dispatch/attachment-handling logic is provider-agnostic.
  toOpenAITools,
  runToolCall,
}
