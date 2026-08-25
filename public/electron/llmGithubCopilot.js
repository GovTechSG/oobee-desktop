// GitHub Copilot chat backend for the "GitHub Copilot" provider option.
// Speaks the standard OpenAI /chat/completions streaming wire format
// against api.githubcopilot.com — Copilot's chat surface is OpenAI-shaped
// so tool_calls / SSE parsing / attachment format are identical to what
// llmOpenAICompatible.js does.
//
// Differences from llmOpenAICompatible.js:
//   - Fixed base URL (api.githubcopilot.com) rather than user-supplied.
//   - Short-lived bearer token refreshed via githubCopilotAuth before every
//     hop (Copilot API tokens expire ~30 min after issue).
//   - Extra required editor-identity headers (Copilot-Integration-Id,
//     Editor-Version, etc.) — the endpoint rejects requests without them.
//   - Model is whatever the user picked in the Configure modal (default
//     resolved higher up in llmAnalysis.js session start).
//
// See the ToS caveat comment at the top of githubCopilotAuth.js — this
// path is the same one VS Code Copilot Chat uses and is not officially
// available to third-party apps.

const { toOpenAITools, runToolCall } = require('./llmGemma')
const { getCopilotApiToken } = require('./githubCopilotAuth')

const log = (...args) => console.log('[llmGithubCopilot]', ...args)
const warn = (...args) => console.warn('[llmGithubCopilot]', ...args)

const COPILOT_BASE_URL = 'https://api.githubcopilot.com'

// Same flat-cap trim as llmOpenAICompatible.js — Copilot is a remote API
// with no local prompt cache to preserve, so hysteresis is unnecessary.
const MAX_HISTORY_CHARS = 60_000
const HISTORY_TARGET_CHARS = 40_000
const MAX_HISTORY_MESSAGES = 24
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
// llmOpenAICompatible.js's readChatSSE. Duplicated (as that file
// duplicates it from llmGemma.js) so this module stays self-contained.
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

function buildCopilotHeaders(apiToken) {
  // Headers Copilot's chat endpoint expects. The Editor-Version /
  // Editor-Plugin-Version / Copilot-Integration-Id values are what public
  // Copilot clients (aider, copilot.lua, etc.) currently send. Kept
  // aligned with the same headers in githubCopilotAuth.js so if GitHub
  // changes acceptance, both call sites either work or fail together.
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiToken}`,
    'Copilot-Integration-Id': 'vscode-chat',
    'Editor-Version': 'vscode/1.95.0',
    'Editor-Plugin-Version': 'copilot-chat/0.20.0',
    'Openai-Intent': 'conversation-panel',
    'User-Agent': 'GitHubCopilotChat/0.20.0',
  }
}

async function streamGithubCopilotChat({
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
  if (!cfg || !cfg.model) {
    throw new Error(
      'GitHub Copilot is not configured. Open the Configure modal, sign in, and pick a model.',
    )
  }

  if (!session.githubCopilot) {
    session.githubCopilot = { messages: [{ role: 'system', content: session.systemPrompt }] }
  }
  session.githubCopilot.messages.push({ role: 'user', content: buildUserContent(userMessage, attachments) })

  const abort = new AbortController()
  session.abort = abort

  const tools = toOpenAITools(toolSchemas)
  const toolByName = new Map(toolSchemas.map((t) => [t.name, t]))

  const MAX_TOOL_HOPS = 50
  const MAX_EMPTY_RESPONSE_RETRIES = 1
  let emptyResponseRetries = 0

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    trimHistory(session.githubCopilot.messages)
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

    const approxChars = session.githubCopilot.messages.reduce((n, m) => n + estimateMessageChars(m), 0)
    log(`hop=${hop + 1}/${MAX_TOOL_HOPS} messages=${session.githubCopilot.messages.length} approxChars=${approxChars} model=${cfg.model}`)
    send('llmChat:usage', {
      sessionId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: Math.round(approxChars / 4),
      isEstimate: true,
    })

    // Refresh (or fetch fresh) the short-lived Copilot API token right
    // before each hop. Auth module returns the cached one if it's still
    // valid, so this is cheap in the common case.
    let apiToken
    try {
      const { token } = await getCopilotApiToken()
      apiToken = token
    } catch (e) {
      throw new Error(`GitHub Copilot auth failed: ${e.message}`)
    }

    const hopRequestStart = Date.now()

    let res
    let content = ''
    const toolCalls = new Map()
    let finishReason = null
    let usage = null

    try {
      try {
        res = await fetch(`${COPILOT_BASE_URL}/chat/completions`, {
          method: 'POST',
          signal: requestAbort.signal,
          headers: buildCopilotHeaders(apiToken),
          body: JSON.stringify({
            model: cfg.model,
            messages: session.githubCopilot.messages,
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
        // Log the full body on 401/403 — helps diagnose if GitHub changes
        // the header contract (see "Header drift" risk in the plan).
        if (res.status === 401 || res.status === 403) {
          warn(`Copilot returned ${res.status} — body: ${text.slice(0, 1000)}`)
        }
        if (res.status === 401) {
          // Fresh 401 despite a just-refreshed token → the underlying
          // GitHub OAuth token is dead. Force user to sign in again.
          throw new Error('GitHub Copilot sign-in expired. Open Configure and sign in again.')
        }
        if (res.status === 400) {
          // Parse the structured error to give the user a specific hint
          // rather than a raw JSON dump. Common cases:
          //   - unsupported_api_for_model: model isn't chat-capable on
          //     their plan (e.g. `gpt-5.4-mini` returns this even though
          //     it appears in /models — hence the listModels() filter).
          //   - model_not_supported: admin policy has disabled it.
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch (_) {}
          const code = parsed?.error?.code || parsed?.code
          const msg = parsed?.error?.message || parsed?.message
          if (code === 'unsupported_api_for_model' || code === 'model_not_supported') {
            throw new Error(
              `GitHub Copilot: The selected model "${cfg.model}" isn't available on your Copilot plan${msg ? ` (${msg})` : ''}. Open Configure and pick a different model.`,
            )
          }
          throw new Error(`GitHub Copilot returned HTTP 400: ${msg || text.slice(0, 500)}`)
        }
        throw new Error(`GitHub Copilot returned HTTP ${res.status}: ${text.slice(0, 500)}`)
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
      session.githubCopilot.messages.push({ role: 'assistant', content: content || null, tool_calls: calls })

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
        session.githubCopilot.messages.push({
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
        session.githubCopilot.messages.push({
          role: 'user',
          content: 'You stopped without giving an answer. Please provide your response now based on what you already know from the tool results above.',
        })
        continue
      }
      throw new Error('Model returned an empty response after retrying. Please try again.')
    }

    session.githubCopilot.messages.push({ role: 'assistant', content })
    if (finishReason && finishReason !== 'stop' && finishReason !== 'length') {
      warn(`unexpected finish_reason: ${finishReason}`)
    }
    return
  }

  warn(`hit MAX_TOOL_HOPS=${MAX_TOOL_HOPS} — bailing to avoid an infinite tool loop`)
}

function disposeSession(session) {
  if (!session?.githubCopilot) return
  session.githubCopilot = null
}

// Fetch the model list from Copilot. Called from an IPC handler in
// llmAnalysis.js so the token never touches the renderer. Copilot's
// /models endpoint returns richer info than the OpenAI-shape suggests:
//   { data: [{ id, name, capabilities: { type: 'chat'|'embeddings', ... },
//              model_picker_enabled, policy: { state: 'enabled'|... } }] }
// We filter to chat-capable + user-visible + not-admin-disabled models so
// the dropdown never offers something the user's plan can't call. Without
// this filter, endpoints like `gpt-5.4-mini` show up in /models but return
// HTTP 400 "unsupported_api_for_model" on /chat/completions, or an admin
// policy blocks them and every request errors.
async function listModels() {
  const { token } = await getCopilotApiToken()
  const res = await fetch(`${COPILOT_BASE_URL}/models`, {
    method: 'GET',
    headers: buildCopilotHeaders(token),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub Copilot models endpoint returned HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const body = await res.json()
  const raw = Array.isArray(body?.data) ? body.data : []
  const models = raw
    .filter((m) => {
      if (!m || typeof m !== 'object') return false
      const type = m.capabilities?.type
      // If the model advertises a type, it must be chat. Some entries omit
      // capabilities entirely — keep those, safer than dropping them.
      if (type && type !== 'chat') return false
      if (m.model_picker_enabled === false) return false
      if (m.policy && m.policy.state && m.policy.state !== 'enabled') return false
      return true
    })
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name))
    .filter((id) => typeof id === 'string' && id.length > 0)
  return models
}

module.exports = { streamGithubCopilotChat, disposeSession, listModels }
