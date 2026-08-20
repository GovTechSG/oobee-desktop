import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { marked } from 'marked'
import SummaryCard from './SummaryCard'
import Button from '../../common/components/Button'
import Modal from '../../common/components/Modal'
import { handleClickLink } from '../../common/constants'
import './ChatPage.scss'

// LLMs frequently emit emphasis in shapes CommonMark treats as literal — most
// notably a closing `**` that's immediately followed by a word char, or spaces
// tucked inside the delimiters (`** foo **`). We nudge these back into a valid
// flanking shape so the user isn't left staring at raw asterisks.
const normalizeLLMMarkdown = (text) => {
  if (!text) return ''
  let out = text
  // Small models over-escape markdown: they emit `\*\*text\*\*` thinking the
  // backslashes make the asterisks "safe", but CommonMark treats `\*` as a
  // hard-literal asterisk — so the pair renders as visible `**text**`. When
  // we see a paired-up run of escaped asterisks with printable content
  // between them (no line breaks), strip the escapes so the emphasis works.
  out = out.replace(/\\\*\\\*([^\n]+?)\\\*\\\*/g, '**$1**')
  out = out.replace(/\\\*([^\n\\*]+?)\\\*/g, '*$1*')
  // Insert a space between a word char and an adjacent `**`, on either side of
  // the emphasis, so the delimiter run becomes valid left/right-flanking.
  out = out.replace(/(\w)(\*\*)(?=\S)/g, '$1 $2')
  out = out.replace(/(?<=\S)(\*\*)(\w)/g, '$1 $2')
  // Strip whitespace tucked inside `** ... **` on either or both sides. Open
  // must be at a valid left-flank (start / non-word non-`*`); close at a valid
  // right-flank (end / non-word non-`*`). Content forbids nested `**`. Together
  // these prevent matching across two adjacent bolds.
  const OPEN = String.raw`(?<=^|[^\w*])\*\*`
  const CLOSE = String.raw`\*\*(?=$|[^\w*])`
  const CONTENT = String.raw`(?:[^*\n]|\*(?!\*))+?`
  out = out.replace(new RegExp(`${OPEN}[ \\t]+(${CONTENT})[ \\t]+${CLOSE}`, 'g'), '**$1**')
  out = out.replace(new RegExp(`${OPEN}[ \\t]+(${CONTENT})${CLOSE}`, 'g'), '**$1**')
  out = out.replace(new RegExp(`${OPEN}(${CONTENT})[ \\t]+${CLOSE}`, 'g'), '**$1**')
  const U_OPEN = String.raw`(?<=^|[^\w_])__`
  const U_CLOSE = String.raw`__(?=$|[^\w_])`
  const U_CONTENT = String.raw`(?:[^_\n]|_(?!_))+?`
  out = out.replace(new RegExp(`${U_OPEN}[ \\t]+(${U_CONTENT})[ \\t]+${U_CLOSE}`, 'g'), '__$1__')
  out = out.replace(new RegExp(`${U_OPEN}[ \\t]+(${U_CONTENT})${U_CLOSE}`, 'g'), '__$1__')
  out = out.replace(new RegExp(`${U_OPEN}(${U_CONTENT})[ \\t]+${U_CLOSE}`, 'g'), '__$1__')
  // Close an odd number of ``` fences so the tail isn't rendered as one <pre>.
  const fences = out.match(/^[ \t]*```/gm)
  if (fences && fences.length % 2 === 1) out += '\n```'
  return out
}

// Axe tag → human WCAG SC. Oobee/axe report conformance as raw axe tags
// (e.g. `wcag211`, `wcag412`, plus level tags like `wcag2a`, `wcag2aa`,
// `wcag21aa`). Level tags are dropped — they name a WCAG level, not a Success
// Criterion — and numeric tags are expanded into `WCAG X.Y.Z` so the LLM
// receives references it can actually cite.
const LEVEL_TAG_RE = /^wcag(2|21|22)(a|aa|aaa)$/
const SC_TAG_RE = /^wcag(\d)(\d)(\d+)$/
const formatWcagConformance = (tags) => {
  if (!Array.isArray(tags)) return []
  const out = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().toLowerCase()
    if (!t || LEVEL_TAG_RE.test(t)) continue
    const m = t.match(SC_TAG_RE)
    if (m) {
      out.push(`WCAG ${m[1]}.${m[2]}.${m[3]}`)
      continue
    }
    // Fall through — keep the original tag if it's already in a readable
    // shape (e.g. explicit "WCAG 2.1.1" strings from other pipelines).
    out.push(raw)
  }
  return out
}

const HEX_COLOUR_RE = /#[0-9a-fA-F]{6}\b/g

// Walk the parsed markdown DOM and, in text nodes only, insert a coloured
// swatch immediately after any 6-digit hex colour. Attribute values (e.g.
// href="...#anchor") are left untouched.
const injectHexSwatches = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let current
  while ((current = walker.nextNode())) textNodes.push(current)
  for (const node of textNodes) {
    const text = node.nodeValue || ''
    HEX_COLOUR_RE.lastIndex = 0
    if (!HEX_COLOUR_RE.test(text)) continue
    HEX_COLOUR_RE.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    let match
    while ((match = HEX_COLOUR_RE.exec(text)) !== null) {
      const hex = match[0]
      if (match.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, match.index)))
      }
      frag.appendChild(document.createTextNode(hex))
      const swatch = document.createElement('span')
      swatch.className = 'hex-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.backgroundColor = hex
      frag.appendChild(swatch)
      last = match.index + hex.length
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode.replaceChild(frag, node)
  }
}

// Wrap each fenced `<pre>` in a positioned container carrying a Copy button.
// The button is a click target only — the actual clipboard write is done via
// event delegation on the message body (see the assistant `onClick` below),
// so we don't need to bind React handlers to nodes produced by
// `dangerouslySetInnerHTML`.
const wrapCodeBlocksWithCopy = (root) => {
  const pres = root.querySelectorAll('pre')
  for (const pre of pres) {
    if (pre.parentElement && pre.parentElement.classList.contains('chat-code-block')) continue
    const wrapper = pre.ownerDocument.createElement('div')
    wrapper.className = 'chat-code-block'
    const btn = pre.ownerDocument.createElement('button')
    btn.type = 'button'
    btn.className = 'chat-code-copy'
    btn.setAttribute('aria-label', 'Copy code')
    btn.textContent = 'Copy'
    pre.parentNode.insertBefore(wrapper, pre)
    wrapper.appendChild(pre)
    wrapper.appendChild(btn)
  }
}

const renderMarkdown = (text) => {
  try {
    const html = marked.parse(normalizeLLMMarkdown(text))
    if (typeof DOMParser === 'undefined') return html
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const root = doc.body.firstChild
    if (!root) return html
    injectHexSwatches(root)
    wrapCodeBlocksWithCopy(root)
    return root.innerHTML
  } catch (_) {
    return text || ''
  }
}

const SUGGESTED_QUESTIONS = [
  "What's the worst accessibility issue on this site?",
  'Which page has the most issues, and why?',
  'Give me copy-pasteable fixes for the top must-fix rule.',
  'Are there any color-contrast violations I should worry about?',
]

// Storage key holds the plain provider id (`anthropic` / `gemma` /
// `openai-compatible`). Which specific local Gemma model size to use
// (E2B/E4B/12B) is a separate persisted choice (see GEMMA_MODEL_STORAGE_KEY
// below), selected inside the Configure modal rather than the main
// dropdown — the main dropdown just shows "Local" for any Gemma size, same
// as it shows one "Anthropic Claude" entry regardless of which Claude
// model the user's config points at.
const PROVIDER_STORAGE_KEY = 'llmProvider'
const BASE_OPTIONS = ['anthropic', 'gemma', 'openai-compatible']
const VALID_OPTIONS = new Set(BASE_OPTIONS)
const optionToProvider = (id) => {
  if (id === 'anthropic') return 'anthropic'
  if (id === 'openai-compatible') return 'openai'
  return 'gemma'
}

// CPU-only mode: a UI-only variant of the same underlying Gemma model —
// reuses the exact same downloaded weights/mmproj, just runs llama-server
// with -ngl 0 (CPU-only) instead of full GPU offload — see llamaServer.js
// buildArgs. Windows-only in the UI (see isWindows gating below) since it
// exists specifically to work around the Adreno OpenCL backend sometimes
// underperforming CPU on Snapdragon X hardware (community-benchmarked in
// ggml-org/llama.cpp discussion #8273). Previously encoded as a `-cpu`
// suffix on the provider id (doubling the dropdown's entry count); now a
// standalone checkbox next to the dropdown, orthogonal to model selection.
const CPU_ONLY_STORAGE_KEY = 'llmCpuOnly'
const readStoredCpuOnly = () => {
  try {
    return window.localStorage.getItem(CPU_ONLY_STORAGE_KEY) === '1'
  } catch (_) {
    return false
  }
}

// Thinking mode: opt-in step-by-step reasoning before the final answer.
// Anthropic-only: uses Claude's native `thinking` Messages API param (see
// streamAnthropicTurn in llmAnalysis.js). A Gemma 4 equivalent (`<|think|>`
// system-prompt trigger + channel-tag parsing) was implemented and tested
// live, but confirmed to have no effect — across multiple hops and a live
// run, Gemma 4 E2B/E4B never produced any thinking-channel content via
// llama-server, so that path was reverted rather than shipping a toggle
// that silently does nothing. Not offered for the generic OpenAI
// Compatible Provider either — no reliable way to know whether an
// arbitrary user-configured endpoint supports a reasoning mode, let alone
// which convention it uses.
const THINKING_STORAGE_KEY = 'llmThinking'
const readStoredThinking = () => {
  try {
    return window.localStorage.getItem(THINKING_STORAGE_KEY) === '1'
  } catch (_) {
    return false
  }
}

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

// Legacy pre-"Local" values looked like `gemma-e4b` (optionally with a
// `-cpu` suffix from the even older per-variant dropdown entries). Detects
// those so both readStoredOption and readStoredGemmaModelId below can
// migrate a user's existing preference instead of silently resetting it.
const LEGACY_GEMMA_OPTION_RE = /^gemma-(e2b|e4b|12b)(-cpu)?$/

const readStoredOption = () => {
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY)
    // Any legacy per-size Gemma value (bare or `-cpu` suffixed) collapses to
    // the single 'gemma' ("Local") option now.
    if (raw === 'gemma' || LEGACY_GEMMA_OPTION_RE.test(String(raw))) return 'gemma'
    return VALID_OPTIONS.has(raw) ? raw : 'anthropic'
  } catch (_) {
    return 'anthropic'
  }
}

// One-time migration: if the persisted provider id was one of the old
// `-cpu` suffixed values, carry that preference over to the new standalone
// CPU_ONLY_STORAGE_KEY so users don't silently lose their setting.
const readStoredCpuOnlyWithMigration = () => {
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY)
    if (typeof raw === 'string' && raw.endsWith('-cpu')) return true
  } catch (_) {
    // fall through to the plain stored value
  }
  return readStoredCpuOnly()
}

// Which Gemma model size (E2B/E4B/12B) to run — now chosen inside the
// Configure modal (see #chat-model-options-form below) rather than as a
// separate main-dropdown entry per size.
const GEMMA_MODEL_STORAGE_KEY = 'llmGemmaModelId'
const readStoredGemmaModelId = () => {
  try {
    const raw = window.localStorage.getItem(GEMMA_MODEL_STORAGE_KEY)
    if (typeof raw === 'string' && LEGACY_GEMMA_OPTION_RE.test(raw.replace(/-cpu$/, ''))) {
      return raw.replace(/-cpu$/, '')
    }
    // Migrate from the legacy main-dropdown value if this key was never set.
    const legacyRaw = window.localStorage.getItem(PROVIDER_STORAGE_KEY)
    if (typeof legacyRaw === 'string' && LEGACY_GEMMA_OPTION_RE.test(legacyRaw)) {
      return legacyRaw.replace(/-cpu$/, '')
    }
  } catch (_) {
    // fall through to the default below
  }
  return 'gemma-e4b'
}

const ChatPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const scanId = location.state?.scanId

  const [selectedOption, setSelectedOption] = useState(readStoredOption)
  const provider = optionToProvider(selectedOption)
  // Which Gemma model size is actually selected (E2B/E4B/12B) — chosen
  // inside the Configure modal, not the main dropdown (see
  // GEMMA_MODEL_STORAGE_KEY doc comment above).
  const [gemmaModelId, setGemmaModelId] = useState(readStoredGemmaModelId)
  const chosenModelId = provider === 'gemma' ? gemmaModelId : null
  const [cpuOnly, setCpuOnly] = useState(readStoredCpuOnlyWithMigration)
  // Shown for both local Gemma and Anthropic Claude (each via a different
  // mechanism — see THINKING_STORAGE_KEY doc comment above); hidden for the
  // OpenAI Compatible Provider.
  const [thinking, setThinking] = useState(readStoredThinking)
  const [providerAvailability, setProviderAvailability] = useState(null)
  const [availableModels, setAvailableModels] = useState([])
  const providerInitialisedRef = useRef(false)
  // CPU-only mode is Windows-only (see CPU_ONLY_STORAGE_KEY doc comment
  // above) — gated on the existing getIsWindows bridge already used
  // elsewhere in the app (services.js).
  const [isWindows, setIsWindows] = useState(false)
  // "OpenAI Compatible Provider": user-supplied endpoint/key/model,
  // persisted via userDataManager (see llmChat:getCustomProviderConfig /
  // llmChat:setCustomProviderConfig). Loaded once on mount and refreshed
  // after every successful save from the Configure modal.
  const [customConfig, setCustomConfig] = useState({ baseUrl: '', apiKey: '', model: '' })
  const [showConfigureModal, setShowConfigureModal] = useState(false)
  const [configDraft, setConfigDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const [configSaveError, setConfigSaveError] = useState(null)
  // Configure modal for Gemma model selection + CPU-only toggle, and
  // Anthropic's Thinking toggle — mirrors the OpenAI Compatible Provider
  // Configure pattern above. Unlike that modal, these controls don't need a
  // manual "Save" click, but they DO need to *defer* applying (clearing
  // messages/summary + restarting the session) until the modal closes
  // rather than on every change — applying immediately caused the whole
  // page to visibly reflow/shift while the user was still deciding inside
  // the modal.
  const [showModelOptionsModal, setShowModelOptionsModal] = useState(false)
  const [gemmaModelIdDraft, setGemmaModelIdDraft] = useState('gemma-e4b')
  const [cpuOnlyDraft, setCpuOnlyDraft] = useState(false)
  const [thinkingDraft, setThinkingDraft] = useState(false)
  const wasModelOptionsModalOpenRef = useRef(false)
  // A new sessionId is minted on every provider/model switch — the backend
  // disposes the previous state and treats it as a fresh session.
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const sessionId = useMemo(() => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEpoch])
  // Resolves once the backend `llmChatStart` for the current sessionId has
  // returned — per-session IPCs like findingDetail can't safely run before
  // then, otherwise the backend returns "Session not found" during the race
  // window after a session reset (e.g. Delete chat).
  const sessionReadyRef = useRef(null)
  if (sessionReadyRef.current?.forSessionId !== sessionId) {
    let resolveFn
    const p = new Promise((resolve) => {
      resolveFn = resolve
    })
    sessionReadyRef.current = { forSessionId: sessionId, promise: p, resolve: resolveFn }
  }

  const [summary, setSummary] = useState(null)
  const [startError, setStartError] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [respondingDots, setRespondingDots] = useState(1)
  const [streamError, setStreamError] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [copiedIndex, setCopiedIndex] = useState(null)

  // Gemma-specific state
  const [modelStatus, setModelStatus] = useState(null) // { downloaded, path, sizeBytes, expectedBytes }
  const [downloadProgress, setDownloadProgress] = useState(null) // { downloaded, total, percent }
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  // Whether auto-scroll-to-bottom should follow new tokens. Flipped off as
  // soon as the user scrolls up so they can read/expand the summary card
  // without being yanked back to the tail on every streamed chunk.
  const stickToBottomRef = useRef(true)
  const inputRef = useRef(null)
  const streamingIndexRef = useRef(null)
  // Live "elapsed / tok-per-sec" indicator, similar to what most local-model
  // chat UIs show while streaming. Computed entirely client-side from chunk
  // arrival timing — no backend changes, no dependency on llama-server
  // exposing exact token counts over the OpenAI-compatible endpoint. Each
  // `onLlmChatChunk` event already corresponds to one non-empty text delta
  // (llmGemma.js only sends after its template-token filter yields non-empty
  // output), so counting events is a reasonable proxy for "tokens generated"
  // — labelled with a “~” in the UI since it's an approximation, not the
  // authoritative count llama-server logs server-side.
  //
  // `requestStartTime` marks when the user hit send — covers prompt
  // processing / prefill and tool-call execution too (the phases that can
  // take minutes on their own, per the long "prompt processing" runs seen in
  // llama-server logs), not just the token-streaming phase. `startTime` marks
  // the first generated token specifically, used only for the tok/s rate so
  // that number isn't diluted by prefill/tool time — mirrors how
  // llama-server's own `tg` timing starts from the first generated token.
  const streamStatsRef = useRef({ requestStartTime: null, startTime: null, tokenCount: 0 })
  const [streamStats, setStreamStats] = useState(null) // { elapsedSec, tokenCount, tokensPerSec }
  // Authoritative token usage from the model backend (llama-server for
  // Gemma, Anthropic's API for Claude), forwarded via llmChat:usage. Unlike
  // streamStats.tokenCount (a client-side per-chunk approximation), this is
  // the real prompt/completion/total token count for the most recently
  // completed hop — updates once per hop, not continuously.
  const [tokenUsage, setTokenUsage] = useState(null) // { promptTokens, completionTokens, totalTokens }
  // Mirrors tokenUsage synchronously so onLlmChatDone (registered once per
  // sessionId via the effect below) can read the latest value at completion
  // time without depending on a `tokenUsage` closure that would otherwise be
  // stale for the lifetime of that effect.
  const tokenUsageRef = useRef(null)
  const [backendStatus, setBackendStatus] = useState(null)
  // Snapshot of streamStats/tokenUsage taken the moment a response finishes,
  // so the "Xs · ~Y tok/s · Z tokens" line stays visible after streaming
  // ends instead of disappearing (it used to be gated on `isStreaming`
  // alone). Persists until the next message is sent.
  const [lastTurnStats, setLastTurnStats] = useState(null)

  const modelReady =
    provider === 'gemma'
      ? modelStatus?.downloaded === true
      : provider === 'openai'
        ? !!customConfig?.baseUrl && !!customConfig?.model
        : true

  // Windows-only gate for CPU-only mode (see CPU_ONLY_STORAGE_KEY doc
  // comment). getIsWindows already exists and is used elsewhere (services.js).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const win = await window.services.getIsWindows()
        if (!cancelled) setIsWindows(!!win)
      } catch (_) {
        // ignore — CPU-only options just stay hidden if this probe fails
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load the persisted "OpenAI Compatible Provider" config once on mount so
  // modelReady can gate correctly even before the user opens Configure.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await window.services.llmChatGetCustomProviderConfig()
        if (!cancelled && cfg) setCustomConfig(cfg)
      } catch (_) {
        // ignore — Configure modal will show empty fields either way
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Probe provider availability + model registry once. If Anthropic isn't
  // configured on this machine (no ANTHROPIC_API_KEY / ~/.claude/settings.json),
  // pre-select the first Gemma model the host can actually run.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await window.services.llmChatProviders()
        if (cancelled) return
        setProviderAvailability(p)
        const models = Array.isArray(p?.models) ? p.models : []
        setAvailableModels(models)
        if (!providerInitialisedRef.current) {
          providerInitialisedRef.current = true
          const anthropicOk = !!p?.anthropic?.available
          const currentSupported =
            selectedOption === 'anthropic'
              ? anthropicOk
              : selectedOption === 'openai-compatible'
                ? true
                : models.find((m) => m.id === gemmaModelId)?.supported !== false
          if (!currentSupported) {
            if (anthropicOk) {
              try {
                window.localStorage.setItem(PROVIDER_STORAGE_KEY, 'anthropic')
              } catch (_) {}
              setSelectedOption('anthropic')
              setSessionEpoch((e) => e + 1)
            } else {
              // No cloud fallback available — switch to (or stay on) Local,
              // but make sure the selected Gemma model size is actually one
              // this machine can run. Prefer E4B when the machine clears its
              // RAM bar (best default quality/speed tradeoff); otherwise fall
              // back to the smallest supported model (E2B), then to models[0]
              // (unsupported, greyed out) as a last resort.
              const fallbackModelId =
                models.find((m) => m.id === 'gemma-e4b' && m.supported)?.id ||
                models.find((m) => m.supported)?.id ||
                models[0]?.id ||
                'gemma-e4b'
              try {
                window.localStorage.setItem(PROVIDER_STORAGE_KEY, 'gemma')
                window.localStorage.setItem(GEMMA_MODEL_STORAGE_KEY, fallbackModelId)
              } catch (_) {}
              setSelectedOption('gemma')
              setGemmaModelId(fallbackModelId)
              setSessionEpoch((e) => e + 1)
            }
          }
        }
      } catch (_) {
        if (!cancelled) setProviderAvailability({ anthropic: { available: false } })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Probe model status whenever the user picks a Gemma option so we know if
  // the download panel needs to render. Re-fetch on model switch too.
  useEffect(() => {
    if (!chosenModelId) return
    let cancelled = false
    ;(async () => {
      try {
        const s = await window.services.llmModelStatus(chosenModelId)
        if (!cancelled) {
          setModelStatus(s)
          // Forward cpuOnly so the preloaded server starts in the right mode
          // the first time — otherwise it spawns in GPU mode by default, then
          // has to detect the config mismatch and restart into CPU mode once
          // the real chat request fires, wasting a full extra model load.
          if (s?.downloaded) window.services.llmChatPreloadModel(chosenModelId, cpuOnly)
        }
      } catch (e) {
        if (!cancelled) setDownloadError(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
    // cpuOnly is included so toggling the CPU-only variant of an already-
    // downloaded model re-preloads the server in the right mode immediately,
    // instead of waiting for the next chat send to trigger a restart.
  }, [chosenModelId, cpuOnly, isDownloading])

  useEffect(() => {
    window.services.onLlmModelDownloadProgress((data) => setDownloadProgress(data))
    return () => window.services.removeLlmModelDownloadListeners()
  }, [])

  const startDownload = async () => {
    if (!chosenModelId) return
    setDownloadError(null)
    setIsDownloading(true)
    setDownloadProgress({ downloaded: 0, total: modelStatus?.expectedBytes || 0, percent: 0 })
    try {
      const res = await window.services.llmModelDownload(chosenModelId)
      if (!res?.ok) setDownloadError(res?.error || 'Download failed')
    } catch (e) {
      setDownloadError(e.message)
    } finally {
      setIsDownloading(false)
    }
  }

  const cancelDownload = () => {
    window.services.llmModelDownloadAbort(chosenModelId)
  }

  const changeOption = (next) => {
    if (!VALID_OPTIONS.has(next) || next === selectedOption) return
    try {
      window.localStorage.setItem(PROVIDER_STORAGE_KEY, next)
    } catch (_) {
      // localStorage disabled — ignore
    }
    setSelectedOption(next)
    setMessages([])
    setStartError(null)
    setStreamError(null)
    setDetailsOpen(true)
    setSummary(null)
    // Every option change is now a genuinely different model/provider (CPU-
    // only mode is a separate toggle that doesn't touch this), so always
    // clear stale download panel state to avoid briefly showing the
    // previous model's progress bar before the new status probe returns.
    setModelStatus(null)
    setDownloadError(null)
    setDownloadProgress(null)
    setSessionEpoch((e) => e + 1)
  }

  // CPU-only mode, thinking mode, and which Gemma model size to run are all
  // independent of the main provider/model dropdown, but all three still
  // require a fresh backend session to take effect (CPU-only and model-
  // size both restart llama-server in the new configuration; thinking
  // changes the request shape for Anthropic).
  // Rather than restarting on every individual control change (which caused
  // a visible page reflow while the Configure modal was still open), the
  // controls only update local draft state; this effect detects the modal
  // closing and applies all changes together in one reset.
  useEffect(() => {
    if (wasModelOptionsModalOpenRef.current && !showModelOptionsModal) {
      const cpuOnlyChanged = cpuOnlyDraft !== cpuOnly
      const thinkingChanged = thinkingDraft !== thinking
      const gemmaModelChanged = gemmaModelIdDraft !== gemmaModelId
      if (cpuOnlyChanged || thinkingChanged || gemmaModelChanged) {
        try {
          if (cpuOnlyChanged) window.localStorage.setItem(CPU_ONLY_STORAGE_KEY, cpuOnlyDraft ? '1' : '0')
          if (thinkingChanged) window.localStorage.setItem(THINKING_STORAGE_KEY, thinkingDraft ? '1' : '0')
          if (gemmaModelChanged) window.localStorage.setItem(GEMMA_MODEL_STORAGE_KEY, gemmaModelIdDraft)
        } catch (_) {
          // localStorage disabled — ignore
        }
        if (cpuOnlyChanged) setCpuOnly(cpuOnlyDraft)
        if (thinkingChanged) setThinking(thinkingDraft)
        if (gemmaModelChanged) setGemmaModelId(gemmaModelIdDraft)
        setMessages([])
        setStartError(null)
        setStreamError(null)
        setDetailsOpen(true)
        setSummary(null)
        // A different Gemma model size means a genuinely different download
        // (different file, different disk state) — clear the stale download
        // panel state the same way changeOption does, so we don't briefly
        // show the previous model's progress bar.
        if (gemmaModelChanged) {
          setModelStatus(null)
          setDownloadError(null)
          setDownloadProgress(null)
        }
        setSessionEpoch((e) => e + 1)
      }
    }
    wasModelOptionsModalOpenRef.current = showModelOptionsModal
    // Only meant to react to the modal's open/closed transition itself —
    // the draft/current values are read from the latest closure each time
    // this effect re-runs on that transition, not tracked as separate deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModelOptionsModal])

  useEffect(() => {
    if (!scanId) {
      setStartError('Missing scanId. Return to the home page and start a new scan.')
      return
    }
    if (!modelReady) return // gate on model download for Gemma
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.services.llmChatStart({
          sessionId,
          scanId,
          provider,
          modelId: chosenModelId,
          cpuOnly,
          thinking,
        })
        if (cancelled) return
        if (res && res.ok) {
          setSummary(res.summary)
        } else {
          setStartError(res?.error || 'Failed to start chat session.')
        }
      } catch (e) {
        if (!cancelled) setStartError(e.message)
      } finally {
        const gate = sessionReadyRef.current
        if (gate && gate.forSessionId === sessionId) gate.resolve()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, scanId, provider, chosenModelId, cpuOnly, thinking, modelReady])

  useEffect(() => {
    window.services.onLlmChatChunk(({ sessionId: sid, text }) => {
      if (sid !== sessionId) return
      setBackendStatus(null)
      // First chunk of the turn marks the start of actual generation (as
      // opposed to time spent waiting for the model / running tools before
      // the first token) — mirrors how llama-server's own tg timing starts
      // from the first generated token, not from request start.
      if (streamStatsRef.current.startTime === null) {
        streamStatsRef.current.startTime = Date.now()
      }
      streamStatsRef.current.tokenCount += 1
      setMessages((prev) => {
        const next = [...prev]
        const idx = streamingIndexRef.current
        if (idx === null || idx === undefined || !next[idx] || next[idx].role !== 'assistant') {
          streamingIndexRef.current = next.length
          next.push({ role: 'assistant', content: text, toolCalls: [] })
        } else {
          next[idx] = { ...next[idx], content: (next[idx].content || '') + text }
        }
        return next
      })
    })

    // Thinking-mode reasoning text (Gemma's channel-tag parsing or
    // Anthropic's native thinking_delta — see THINKING_STORAGE_KEY doc
    // comment). Accumulated onto the same streaming assistant message as a
    // separate `reasoning` field, rendered as its own collapsible section
    // (see the render below) rather than mixed into `content`.
    window.services.onLlmChatThinking(({ sessionId: sid, text }) => {
      if (sid !== sessionId) return
      if (!text) return
      setMessages((prev) => {
        const next = [...prev]
        let idx = streamingIndexRef.current
        if (idx === null || idx === undefined || !next[idx] || next[idx].role !== 'assistant') {
          streamingIndexRef.current = next.length
          next.push({ role: 'assistant', content: '', toolCalls: [], reasoning: '' })
          idx = streamingIndexRef.current
        }
        next[idx] = { ...next[idx], reasoning: (next[idx].reasoning || '') + text }
        return next
      })
    })

    window.services.onLlmChatToolCall(
      ({ sessionId: sid, name, id, status, input, error, result, summary }) => {
        if (sid !== sessionId) return
        setMessages((prev) => {
          const next = [...prev]
          let idx = streamingIndexRef.current
          if (idx === null || idx === undefined || !next[idx] || next[idx].role !== 'assistant') {
            streamingIndexRef.current = next.length
            next.push({ role: 'assistant', content: '', toolCalls: [], attachments: [] })
            idx = streamingIndexRef.current
          }
          const toolCalls = [...(next[idx].toolCalls || [])]
          const existing = toolCalls.findIndex((c) => c.id === id)
          const patch = { id, name, status }
          if (input !== undefined) patch.input = input
          if (error !== undefined) patch.error = error
          if (result !== undefined) patch.result = result
          if (summary !== undefined) patch.summary = summary
          if (existing >= 0) {
            toolCalls[existing] = { ...toolCalls[existing], ...patch }
          } else {
            toolCalls.push(patch)
          }
          next[idx] = { ...next[idx], toolCalls }
          return next
        })
      }
    )

    window.services.onLlmChatAttachment((payload) => {
      if (payload?.sessionId !== sessionId) return
      setMessages((prev) => {
        const next = [...prev]
        let idx = streamingIndexRef.current
        if (idx === null || idx === undefined || !next[idx] || next[idx].role !== 'assistant') {
          streamingIndexRef.current = next.length
          next.push({ role: 'assistant', content: '', toolCalls: [], attachments: [] })
          idx = streamingIndexRef.current
        }
        const attachments = [...(next[idx].attachments || [])]
        attachments.push({
          toolCallId: payload.toolCallId,
          occurrenceIndex: payload.occurrenceIndex,
          url: payload.url,
          pageTitle: payload.pageTitle,
          xpath: payload.xpath,
          dataUri: payload.dataUri,
        })
        next[idx] = { ...next[idx], attachments }
        return next
      })
    })

    window.services.onLlmChatDone(({ sessionId: sid }) => {
      if (sid !== sessionId) return
      streamingIndexRef.current = null
      setIsStreaming(false)
      setBackendStatus(null)
      // Freeze the live stats as of this moment so the total time/tokens for
      // the just-completed response remain visible under the composer.
      const { requestStartTime, startTime, tokenCount } = streamStatsRef.current
      if (requestStartTime !== null) {
        const elapsedSec = Math.max((Date.now() - requestStartTime) / 1000, 0.001)
        const tokensPerSec =
          startTime !== null
            ? tokenCount / Math.max((Date.now() - startTime) / 1000, 0.001)
            : null
        setLastTurnStats({
          elapsedSec,
          tokensPerSec,
          totalTokens: tokenUsageRef.current?.totalTokens ?? null,
          isEstimate: !!tokenUsageRef.current?.isEstimate,
        })
      }
    })

    window.services.onLlmChatUsage(({ sessionId: sid, promptTokens, completionTokens, totalTokens, isEstimate }) => {
      if (sid !== sessionId) return
      const usage = { promptTokens, completionTokens, totalTokens, isEstimate: !!isEstimate }
      tokenUsageRef.current = usage
      setTokenUsage(usage)
    })

    window.services.onLlmChatStatus(({ sessionId: sid, message }) => {
      if (sid !== sessionId) return
      setBackendStatus(message || null)
    })

    window.services.onLlmChatError(({ sessionId: sid, message }) => {
      if (sid !== sessionId) return
      streamingIndexRef.current = null
      setIsStreaming(false)
      setBackendStatus(null)
      setStreamError(message)
    })

    return () => {
      window.services.removeLlmChatListeners()
    }
  }, [sessionId])

  // Cycle 1 → 2 → 3 dots on the composer placeholder while streaming so users
  // can tell the app isn't frozen (Gemma's first-token latency can be 5-15 s).
  useEffect(() => {
    if (!isStreaming) {
      setRespondingDots(1)
      return
    }
    const id = setInterval(() => {
      setRespondingDots((d) => (d >= 3 ? 1 : d + 1))
    }, 400)
    return () => clearInterval(id)
  }, [isStreaming])

  // Tick the live elapsed/tok-per-sec display every 200ms while streaming.
  // Reads from streamStatsRef (updated synchronously in onLlmChatChunk above)
  // rather than triggering a state update on every single chunk, which would
  // re-render on every token — too frequent for fast local generation.
  //
  // Shows total elapsed (from send) throughout the whole turn, including
  // prompt processing / prefill and tool-call execution — phases that were
  // previously invisible here (the indicator only appeared once tokens
  // started arriving), which is exactly when a slow prefill looks frozen.
  // tok/s only appears once the first token has actually arrived.
  useEffect(() => {
    if (!isStreaming) {
      setStreamStats(null)
      return
    }
    const id = setInterval(() => {
      const { requestStartTime, startTime, tokenCount } = streamStatsRef.current
      if (requestStartTime === null) {
        setStreamStats(null)
        return
      }
      const totalElapsedSec = Math.max((Date.now() - requestStartTime) / 1000, 0.001)
      if (startTime === null) {
        // Still waiting for the first token (prompt processing / tool calls).
        setStreamStats({ elapsedSec: totalElapsedSec, tokenCount: 0, tokensPerSec: null })
        return
      }
      const genElapsedSec = Math.max((Date.now() - startTime) / 1000, 0.001)
      setStreamStats({
        elapsedSec: totalElapsedSec,
        tokenCount,
        tokensPerSec: tokenCount / genElapsedSec,
      })
    }, 200)
    return () => clearInterval(id)
  }, [isStreaming])

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom < 40
  }

  useEffect(() => {
    if (!stickToBottomRef.current) return
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  const sendMessage = (overrideText, opts) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text || isStreaming || startError || !modelReady) return
    const attachments = Array.isArray(opts?.attachments) ? opts.attachments : []
    setStreamError(null)
    setMessages((prev) => [
      ...prev,
      attachments.length > 0
        ? { role: 'user', content: text, attachments }
        : { role: 'user', content: text },
    ])
    setInput('')
    setDetailsOpen(false)
    streamingIndexRef.current = null
    streamStatsRef.current = { requestStartTime: Date.now(), startTime: null, tokenCount: 0 }
    setStreamStats({ elapsedSec: 0, tokenCount: 0, tokensPerSec: null })
    tokenUsageRef.current = null
    setTokenUsage(null)
    setBackendStatus(null)
    setLastTurnStats(null)
    stickToBottomRef.current = true
    setIsStreaming(true)
    window.services.llmChatSend({ sessionId, userMessage: text, attachments })
    if (inputRef.current) inputRef.current.focus()
  }

  const askAboutRule = (rule) => {
    if (!rule) return
    const label = rule.description ? `"${rule.rule}" (${rule.description})` : `"${rule.rule}"`
    // Surface the Oobee → WCAG mapping in the prompt so the model can quote
    // the SC by number (e.g. `search_wcag` with "2.5.8") instead of searching
    // by the axe rule id ("target-size"), which the BM25 corpus doesn't index
    // and which produces garbage top-k hits.
    const wcagFormatted = formatWcagConformance(rule.conformance)
    const wcagList = wcagFormatted.length > 0 ? wcagFormatted.join(', ') : null
    const parts = [
      `Tell me more about the ${label} rule — where it occurs, why it matters, and how to fix it.`,
      wcagList ? `- WCAG references (authoritative): ${wcagList}` : null,
      wcagList
        ? `When citing WCAG or calling \`search_wcag\`, use ONLY the references listed above (${wcagList}) — query by the dotted SC number (e.g. "${wcagFormatted[0].replace(/^WCAG\s+/, '')}"), not by the Oobee/axe rule id. Do not invent or substitute other WCAG success criteria.`
        : 'If you are unsure of the exact WCAG success criterion, say so instead of guessing.',
    ]
      .filter(Boolean)
      .join('\n')
    sendMessage(parts)
  }

  const fetchFindingDetail = useMemo(
    () => async (category, ruleId) => {
      // Wait for llmChatStart to finish for this sessionId — otherwise the
      // backend hasn't registered the session yet and returns "Session not
      // found". Closes the race that happens right after Delete chat.
      const gate = sessionReadyRef.current
      if (gate && gate.forSessionId === sessionId) {
        await gate.promise
      }
      return window.services.llmFindingDetail({ sessionId, category, ruleId })
    },
    [sessionId],
  )

  const askAboutOccurrence = (ctx) => {
    if (!ctx || !ctx.rule || !ctx.occurrence) return
    const { rule, description, category, conformance, axeImpact, helpUrl, occurrence, index } = ctx
    const htmlSnippet = (occurrence.html || '').slice(0, 2000)
    const wcagFormatted = formatWcagConformance(conformance)
    const wcagList = wcagFormatted.length > 0 ? wcagFormatted.join(', ') : null
    const categoryLabel =
      category === 'mustFix' ? 'Must Fix'
        : category === 'goodToFix' ? 'Good to Fix'
          : category === 'needsReview' ? 'Manual Review Required'
            : category || null
    const attachments = occurrence.screenshotDataUri
      ? [
          {
            dataUri: occurrence.screenshotDataUri,
            kind: 'occurrence-screenshot',
            occurrenceIndex: index,
            pageTitle: occurrence.pageTitle || null,
            url: occurrence.url || null,
            xpath: occurrence.xpath || null,
          },
        ]
      : []
    // CSS-dependent rules (colour contrast, focus visibility) can't be
    // answered from the element HTML alone — the failing style lives in a
    // stylesheet. Nudge the model to call get_page_css first so it either
    // finds the rule in inline CSS or is honest that the styles live in an
    // external file the scan didn't capture.
    const ruleLower = String(rule || '').toLowerCase()
    const msgLower = String(occurrence.message || '').toLowerCase()
    const isCssDependent =
      ruleLower.includes('color-contrast') ||
      ruleLower.includes('contrast') ||
      ruleLower.includes('focus-visible') ||
      ruleLower.includes('focus-order') ||
      msgLower.includes('could not be determined') ||
      msgLower.includes('background image') ||
      msgLower.includes('background gradient')
    const cssHint = isCssDependent
      ? 'This is a CSS-dependent rule. Before answering, call `get_page_computed_styles` with pageUrl set to the URL above and selector set to the XPath/selector shown (axe reports CSS selectors under the "xpath" field). That returns the actually-applied browser styles — the definitive answer for colour and contrast. If it errors because the scan was run without OOBEE_SAVE_COMPUTED_STYLES=1, fall back to `get_page_css` for the inline `<style>` blocks and say plainly if the failing rule lives in an external stylesheet that was not captured.'
      : null
    // DOM-context-dependent rules (ARIA names, labels, landmarks, headings,
    // duplicate ids, skip-link targets) can't be answered from the element
    // snippet alone — the *rest* of the page determines the right fix
    // (whether an aria-labelledby target already exists, whether a nearby
    // heading could label a region, whether an id truly is duplicated).
    // Without this nudge, Gemma just returns generic textbook advice.
    const isDomContextDependent =
      !isCssDependent && (
        ruleLower.startsWith('aria-') ||
        ruleLower.includes('label') ||
        ruleLower === 'button-name' ||
        ruleLower === 'link-name' ||
        ruleLower === 'input-button-name' ||
        ruleLower === 'input-image-alt' ||
        ruleLower === 'image-alt' ||
        ruleLower === 'heading-order' ||
        ruleLower === 'empty-heading' ||
        ruleLower === 'page-has-heading-one' ||
        ruleLower.startsWith('landmark-') ||
        ruleLower === 'region' ||
        ruleLower === 'bypass' ||
        ruleLower === 'skip-link' ||
        ruleLower.startsWith('duplicate-id') ||
        ruleLower === 'frame-title' ||
        ruleLower === 'document-title' ||
        ruleLower === 'html-has-lang' ||
        ruleLower === 'html-lang-valid' ||
        msgLower.includes('aria-labelledby') ||
        msgLower.includes('aria-describedby') ||
        msgLower.includes('references elements that do not exist') ||
        msgLower.includes('accessible name') ||
        msgLower.includes('unique id')
      )
    // scanToolViewport is computed just below for geometryHint; recompute it
    // here too since domHint fires on a different (and mostly disjoint)
    // rule set and this hint is evaluated before the geometry branch.
    const domHintScanViewportRaw = typeof summary?.viewport === 'string' ? summary.viewport.trim() : ''
    const domHintToolViewport = domHintScanViewportRaw.toLowerCase() === 'desktop' ? 'desktop' : 'mobile'
    // get_page_dom is disabled server-side for local Gemma models (see
    // GEMMA_TOOL_SCHEMAS in public/electron/llmAnalysis.js) — telling Gemma to
    // call it here would just produce a wasted/failing tool hop. Point it at
    // get_element_context with a deeper ancestor walk instead, which is the
    // tool Gemma actually has access to.
    const domHint = isDomContextDependent
      ? provider === 'gemma'
        ? `This fix depends on the surrounding DOM, not just the element itself. \`get_page_dom\` is not available for local models — instead call \`get_element_context\` with pageUrl set to the URL above, selector set to \`${occurrence.xpath || 'the XPath shown above'}\`, ancestorDepth=3 (wider than the default, to see more surrounding structure), and \`viewport="${domHintToolViewport}"\` (the scan viewport — the opposite slot is typically not populated). Then search the returned ancestor HTML for: (a) an existing element whose id would be a plausible aria-labelledby / aria-describedby target for this element (e.g. a heading, caption, or visible title near the element); (b) any duplicate ids or landmark/region siblings relevant to this rule; (c) nearby visible text that could serve as the accessible name. Base your recommendation on what is actually present in the returned HTML — cite the specific existing id or heading text — rather than inventing generic labels. If no element matched the selector, follow the retryHints in the tool's response before giving up.`
        : `This fix depends on the surrounding DOM, not just the element itself. Before answering, call \`get_page_dom\` with pageUrl set to the URL above and \`viewport="${domHintToolViewport}"\` (the scan viewport — the opposite slot is typically not populated). Then search the returned HTML for: (a) an existing element whose id would be a plausible aria-labelledby / aria-describedby target for this element (e.g. a heading, caption, or visible title near the element in the DOM); (b) any duplicate ids or landmark/region siblings that are relevant to this rule; (c) nearby visible text that could serve as the accessible name. Base your recommendation on what is actually present in the DOM — cite the specific existing id or heading text — rather than inventing generic labels. If the returned HTML is truncated (>30 KB), say so and describe only what you could see.`
      : null
    // Geometry-dependent rules (target-size, and any layout-size check where
    // the failing element may wrap a differently-sized visible child). Without
    // a specific nudge the model reads only the element HTML + failure
    // message, latches onto the reported pixel value (typically the collapsed
    // wrapper's inline metrics ≈ 19 px on a 16 px font), and recommends a
    // one-size-fits-all "add padding to 24 px" fix — missing both the child
    // element that already meets the SC and the spacing-exemption path.
    const isGeometryDependent =
      !isCssDependent && !isDomContextDependent && (
        ruleLower === 'target-size' ||
        ruleLower.includes('target-size') ||
        msgLower.includes('insufficient target size') ||
        msgLower.includes('adjacent element')
      )
    // Resolve the scan viewport once so the geometry hint tells the model
    // EXACTLY which viewport slot to inspect. Without this, an earlier draft
    // of the hint said "call get_page_computed_styles twice — once with
    // viewport=desktop and once with viewport=mobile", which caused the
    // model to default to desktop on a Mobile scan (where the desktop slot
    // is empty). Keep this in sync with the buildSystemPrompt viewport
    // resolution in public/electron/llmPrompts.js.
    const scanViewportRaw = typeof summary?.viewport === 'string' ? summary.viewport.trim() : ''
    const isDesktopScan = scanViewportRaw.toLowerCase() === 'desktop'
    const scanToolViewport = isDesktopScan ? 'desktop' : 'mobile'
    const scanViewportLabel = scanViewportRaw || 'the scan'
    const geometryHint = isGeometryDependent
      ? `This rule depends on rendered element geometry AT THE ${scanViewportLabel.toUpperCase()} VIEWPORT (\`viewport="${scanToolViewport}"\`${isDesktopScan ? '' : `; only the mobile capture slot is populated on this scan — \`viewport="desktop"\` will typically return "not captured"`}). The failing element is often a bare wrapper (e.g. \`<a>\` with no height class) around a taller/wider visible child (e.g. a styled \`<div>\`). Do NOT answer from the failure message + element HTML alone — the reported pixel value may be the wrapper's collapsed inline box, not the visible target${isDesktopScan ? '' : ', AND responsive classes (`md:*`, `lg:*`) DO NOT apply at this narrow viewport'}. Before recommending anything, do all of the following in order — do not skip any step, and pass \`viewport="${scanToolViewport}"\` on EVERY tool call unless comparing viewports (see step 4):\n\n` +
        `1. Call \`get_element_context\` with pageUrl set to the URL above, selector set to the XPath/selector shown, ancestorDepth=2, and \`viewport="${scanToolViewport}"\`. Inspect the returned HTML for whether the failing element wraps a visibly-styled child. If it does, note the child's classes/tag — that child is the visual target the user actually sees.${isDesktopScan ? '' : ' If the classes include responsive prefixes like `md:py-6` or `lg:h-10`, flag that these DO NOT apply at this viewport.'}\n\n` +
        `2. Call \`get_page_computed_styles\` with \`viewport="${scanToolViewport}"\` and the failing element's selector. If a visible child was found in step 1, call it again with the child's selector (same viewport). For each element, read the LAYOUT properties directly: \`height\`, \`width\`, \`min-height\`, \`min-width\`, \`padding-top\`, \`padding-bottom\`, \`padding-left\`, \`padding-right\`, \`box-sizing\`, and \`display\`. Do NOT report \`line-height\` in place of \`height\` — a 24 px \`line-height\` on a 16 px font produces an inline-box height near 19 px, which is a common source of confusion in target-size findings. Resolve \`rem\`/\`em\`/\`%\` values to pixels using a 16 px base font-size before comparing to the 24 px threshold.\n\n` +
        // get_page_dom is disabled server-side for local Gemma models — reuse
        // get_element_context (with a deeper ancestorDepth) instead, since
        // that's the tool Gemma actually has access to.
        (provider === 'gemma'
          ? `3. If the wrapper and child computed heights differ (e.g. wrapper collapses to ~19 px inline while the child is 32 px), also call \`get_element_context\` with \`viewport="${scanToolViewport}"\`, the failing element's selector, and ancestorDepth=3 (\`get_page_dom\` is not available for local models). Confirm which classes are actually present in the returned ancestor HTML vs. the authored HTML in the finding — do not infer runtime behaviour from class names alone.\n\n`
          : `3. If the wrapper and child computed heights differ (e.g. wrapper collapses to ~19 px inline while the child is 32 px), also call \`get_page_dom\` with \`viewport="${scanToolViewport}"\` and locate the failing element (search by class or nearby text). Confirm which classes are actually present in the rendered DOM vs. the authored HTML in the finding — do not infer runtime behaviour from class names alone.\n\n`) +
        `4. Only call the OPPOSITE viewport ("${isDesktopScan ? 'mobile' : 'desktop'}") if you need to compare — and only after first calling \`list_page_captures\` to confirm that opposite slot has data. Do not "check both viewports" reflexively; on this scan the primary evidence lives at \`viewport="${scanToolViewport}"\`.\n\n` +
        `5. When you state a dimension, cite THREE things: the element it belongs to (the failing wrapper vs. the visible child), the viewport it was measured at (always name it — this scan is **${scanViewportLabel}**), and the computed-style property it came from — e.g. "at ${scanViewportLabel} viewport, the \`<a>\` has no explicit \`height\`; its \`line-height\` is 24 px, giving an inline-box height of ~19 px; the inner \`<div>\` has \`height: 2rem\` = 32 px".\n\n` +
        `6. If a measurement contradicts what the user has stated or what the attached screenshot shows, do NOT invent an explanation (e.g. "the mobile viewport collapses it" without evidence). Either call \`get_page_screenshot\` with \`viewport="${scanToolViewport}"\` and describe what you actually see, or say the discrepancy is unexplained and ask the user for guidance. Verify, don't speculate.\n\n` +
        `For WCAG 2.5.8 specifically, enumerate three satisfaction paths as CO-EQUAL options and pick the minimum change that satisfies the SC:\n` +
        `(a) enlarge the target to ≥ 24 × 24 CSS px (the SC minimum, not the visible child's size);\n` +
        `(b) meet the spacing exemption — a 24 CSS-px-diameter circle centered on each undersized target does not intersect another target's circle;\n` +
        `(c) if the failing wrapper already has a visible child ≥ 24 × 24, add a \`min-height\` / \`min-width\` to the wrapper so its own layout box matches the SC minimum (this addresses the tool measurement without altering the visible design).\n` +
        `Option (c) is often the right pick for wrapper-collapse cases — it needs no visual change and no spacing rework.`
      : null
    const parts = [
      `About occurrence #${index + 1} of the **${rule}** rule:`,
      description ? `- Rule description: ${description}` : null,
      categoryLabel ? `- Category: ${categoryLabel}` : null,
      wcagList ? `- WCAG references (authoritative): ${wcagList}` : null,
      axeImpact ? `- Impact: ${axeImpact}` : null,
      helpUrl ? `- Help URL: ${helpUrl}` : null,
      `- Page: ${occurrence.pageTitle || occurrence.url || 'unknown'}`,
      occurrence.pageTitle && occurrence.url ? `- URL: ${occurrence.url}` : null,
      occurrence.xpath ? `- XPath: \`${occurrence.xpath}\`` : null,
      occurrence.message ? `- Failure message: ${occurrence.message}` : null,
      htmlSnippet ? `- Element:\n\n\`\`\`html\n${htmlSnippet}\n\`\`\`` : null,
      attachments.length > 0
        ? '- A screenshot of the element is attached to this message.'
        : null,
      '',
      'Why does this specific occurrence matter, and what would fix it?',
      cssHint,
      domHint,
      geometryHint,
      wcagList
        ? `When citing WCAG, use ONLY the references listed above (${wcagList}). Do not invent or substitute other WCAG success criteria.`
        : 'If you are unsure of the exact WCAG success criterion, say so instead of guessing.',
    ]
      .filter(Boolean)
      .join('\n')
    sendMessage(parts, { attachments })
  }

  const stop = () => {
    if (!isStreaming) return
    window.services.llmChatAbort(sessionId)
  }

  const handleDeleteChat = () => {
    if (isStreaming) {
      try {
        window.services.llmChatAbort(sessionId)
      } catch (_) {}
    }
    setMessages([])
    setStreamError(null)
    setLastTurnStats(null)
    setTokenUsage(null)
    setSessionEpoch((e) => e + 1)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const copyAssistantMarkdown = async (index, text) => {
    const md = normalizeLLMMarkdown(text || '')
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(md)
      } else {
        const ta = document.createElement('textarea')
        ta.value = md
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedIndex(index)
      setTimeout(() => {
        setCopiedIndex((cur) => (cur === index ? null : cur))
      }, 1500)
    } catch (_) {
      // Silently swallow — clipboard permission denials shouldn't break chat.
    }
  }

  return (
    <div id="chat-page">
      <div className="chat-page-header">
        <Button type="btn-link" onClick={() => {
          window.services.llmChatDispose(sessionId)
          navigate('/')
        }}>
          ← Back
        </Button>
        <h1>LLM Chat (alpha)</h1>
        <div className="chat-provider-select">
          <label htmlFor="chat-provider">Model:</label>
          <select
            id="chat-provider"
            value={selectedOption}
            onChange={(e) => changeOption(e.target.value)}
            disabled={isStreaming || isDownloading}
          >
            {(() => {
              const anthropicUnavailable =
                providerAvailability?.anthropic?.available === false
              return [
                <option key="anthropic" value="anthropic" disabled={anthropicUnavailable}>
                  {anthropicUnavailable
                    ? 'Anthropic Claude (not detected)'
                    : 'Anthropic Claude'}
                </option>,
                <option key="gemma" value="gemma">
                  Local (on device)
                </option>,
                <option key="openai-compatible" value="openai-compatible">
                  OpenAI Compatible Provider
                </option>,
              ]
            })()}
          </select>
          {selectedOption === 'openai-compatible' && (
            <button
              type="button"
              className="chat-configure-link"
              onClick={() => {
                setConfigDraft(customConfig)
                setConfigSaveError(null)
                setShowConfigureModal(true)
              }}
            >
              Configure
            </button>
          )}
          {(provider === 'gemma' || provider === 'anthropic') && (
            <button
              type="button"
              className="chat-configure-link"
              onClick={() => {
                setGemmaModelIdDraft(gemmaModelId)
                setCpuOnlyDraft(cpuOnly)
                setThinkingDraft(thinking)
                setShowModelOptionsModal(true)
              }}
            >
              Configure
            </button>
          )}
        </div>
      </div>

      {showConfigureModal && (
        <Modal
          id="chat-configure-modal"
          showModal={showConfigureModal}
          showHeader={true}
          modalTitle="Configure OpenAI Compatible Provider"
          modalSizeClass="modal-dialog-centered"
          modalBody={
            <form
              id="chat-configure-form"
              onSubmit={async (e) => {
                e.preventDefault()
                setConfigSaveError(null)
                try {
                  const res = await window.services.llmChatSetCustomProviderConfig(configDraft)
                  if (res?.ok) {
                    setCustomConfig(configDraft)
                    setShowConfigureModal(false)
                    // Restart the session so the newly saved config is picked
                    // up immediately rather than requiring a manual re-select.
                    if (selectedOption === 'openai-compatible') setSessionEpoch((ep) => ep + 1)
                  } else {
                    setConfigSaveError(res?.error || 'Failed to save configuration.')
                  }
                } catch (err) {
                  setConfigSaveError(err.message)
                }
              }}
            >
              <p className="chat-configure-hint">
                Point this at any server implementing the standard OpenAI{' '}
                <code>/chat/completions</code> streaming API — a self-hosted Ollama / LM Studio /
                Open WebUI instance, a corporate LLM gateway, etc.
              </p>
              <label htmlFor="chat-configure-baseurl">API Base URL</label>
              <input
                id="chat-configure-baseurl"
                type="text"
                placeholder="https://api.example.com/v1"
                value={configDraft.baseUrl}
                onChange={(e) => setConfigDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                autoComplete="off"
              />
              <label htmlFor="chat-configure-model">Model</label>
              <input
                id="chat-configure-model"
                type="text"
                placeholder="gpt-4o-mini"
                value={configDraft.model}
                onChange={(e) => setConfigDraft((d) => ({ ...d, model: e.target.value }))}
                autoComplete="off"
              />
              <label htmlFor="chat-configure-apikey">API Key (optional)</label>
              <input
                id="chat-configure-apikey"
                type="password"
                placeholder="sk-…"
                value={configDraft.apiKey}
                onChange={(e) => setConfigDraft((d) => ({ ...d, apiKey: e.target.value }))}
                autoComplete="off"
              />
              <p className="chat-configure-security-note">
                Stored locally on this device alongside your other app settings. Leave the API key
                blank if your endpoint doesn't require one.
              </p>
              {configSaveError && (
                <div className="chat-error-banner" role="alert">
                  {configSaveError}
                </div>
              )}
            </form>
          }
          modalFooter={
            <>
              <Button type="btn-secondary" onClick={() => setShowConfigureModal(false)}>
                Cancel
              </Button>
              <button
                type="submit"
                form="chat-configure-form"
                className="btn-primary modal-button"
                disabled={!configDraft.baseUrl.trim() || !configDraft.model.trim()}
              >
                Save
              </button>
            </>
          }
          setShowModal={setShowConfigureModal}
        />
      )}

      {showModelOptionsModal && (
        <Modal
          id="chat-model-options-modal"
          showModal={showModelOptionsModal}
          showHeader={true}
          modalTitle={provider === 'gemma' ? 'Configure Local Gemma' : 'Configure Claude'}
          modalSizeClass="modal-dialog-centered"
          modalBody={
            <div id="chat-model-options-form">
              {provider === 'gemma' && (
                <div className="chat-model-select-group">
                  <label htmlFor="chat-gemma-model-select">
                    <strong>Local model size</strong>
                  </label>
                  <p className="chat-toggle-hint">
                    Smaller models reply faster but are less capable; larger models need more RAM
                    but give better answers. Models greyed out below need more RAM than this
                    machine has.
                  </p>
                  <select
                    id="chat-gemma-model-select"
                    value={gemmaModelIdDraft}
                    onChange={(e) => setGemmaModelIdDraft(e.target.value)}
                    disabled={isStreaming || isDownloading}
                  >
                    {availableModels.map((m) => {
                      const sizeSuffix = m.sizeBytes ? ` — ${formatBytes(m.sizeBytes)}` : ''
                      const unsupportedSuffix = m.supported === false ? ' (unsupported)' : ''
                      return (
                        <option
                          key={m.id}
                          value={m.id}
                          disabled={m.supported === false}
                          title={m.supported === false ? m.unsupportedReason || '' : ''}
                        >
                          {`${m.label}${sizeSuffix}${unsupportedSuffix}`}
                        </option>
                      )
                    })}
                  </select>
                  {(() => {
                    const draftModel = availableModels.find((m) => m.id === gemmaModelIdDraft)
                    if (!draftModel) return null
                    return (
                      <p className="chat-toggle-hint chat-model-select-description">
                        {draftModel.description}
                        {draftModel.supported === false && draftModel.unsupportedReason
                          ? ` ${draftModel.unsupportedReason}.`
                          : ''}
                      </p>
                    )
                  })()}
                </div>
              )}
              {provider === 'gemma' && isWindows && (
                <label className="chat-toggle-control chat-toggle-control-modal">
                  <span className="chat-toggle-control-row">
                    <input
                      type="checkbox"
                      checked={cpuOnlyDraft}
                      onChange={(e) => setCpuOnlyDraft(e.target.checked)}
                      disabled={isStreaming || isDownloading}
                    />
                    <strong>CPU-only mode</strong>
                  </span>
                  <p className="chat-toggle-hint">
                    Runs the model on CPU instead of GPU. Community benchmarks show this can be
                    faster than the Adreno GPU backend on some Snapdragon X hardware.
                  </p>
                </label>
              )}
              {provider === 'anthropic' && (
                <label className="chat-toggle-control chat-toggle-control-modal">
                  <span className="chat-toggle-control-row">
                    <input
                      type="checkbox"
                      checked={thinkingDraft}
                      onChange={(e) => setThinkingDraft(e.target.checked)}
                      disabled={isStreaming || isDownloading}
                    />
                    <strong>Thinking</strong>
                  </span>
                  <p className="chat-toggle-hint">
                    Lets the model reason step-by-step before answering. Can improve accuracy on
                    complex questions, but is slower and uses more tokens.
                  </p>
                </label>
              )}
            </div>
          }
          modalFooter={
            <Button type="btn-primary" onClick={() => setShowModelOptionsModal(false)}>
              Close
            </Button>
          }
          setShowModal={setShowModelOptionsModal}
        />
      )}

      {provider === 'openai' && !modelReady && (
        <div className="chat-model-download" role="region" aria-label="OpenAI Compatible Provider configuration">
          <h2>OpenAI Compatible Provider not configured</h2>
          <p>
            Enter an API base URL and model name to use a custom endpoint — a self-hosted server,
            a corporate gateway, or any other OpenAI-compatible API.
          </p>
          <div className="chat-model-download-actions">
            <Button
              type="btn-primary"
              onClick={() => {
                setConfigDraft(customConfig)
                setConfigSaveError(null)
                setShowConfigureModal(true)
              }}
            >
              Configure
            </Button>
            {providerAvailability?.anthropic?.available !== false && (
              <Button type="btn-link" onClick={() => changeOption('anthropic')}>
                Use Anthropic Claude instead
              </Button>
            )}
          </div>
        </div>
      )}

      {provider === 'gemma' && !modelReady && (
        <div className="chat-model-download" role="region" aria-label="Gemma model download">
          <h2>
            Download {availableModels.find((m) => m.id === chosenModelId)?.label || 'Gemma model'}
          </h2>
          <p>
            This model runs entirely on your device. Keep in mind that response times will depend
            on your hardware. First-time download is{' '}
            {modelStatus?.expectedBytes
              ? formatBytes(modelStatus.expectedBytes)
              : 'a few GB'}{' '}
            and is cached under your app data folder.
          </p>
          {isDownloading ? (
            <>
              <div className="chat-progress" role="progressbar"
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round((downloadProgress?.percent || 0) * 100)}
              >
                <div
                  className="chat-progress-bar"
                  style={{ width: `${Math.min(100, (downloadProgress?.percent || 0) * 100)}%` }}
                />
              </div>
              <div className="chat-progress-meta">
                <span>
                  {formatBytes(downloadProgress?.downloaded || 0)} /{' '}
                  {formatBytes(downloadProgress?.total || modelStatus?.expectedBytes || 0)}
                </span>
                <span>{Math.round((downloadProgress?.percent || 0) * 100)}%</span>
              </div>
              <div className="chat-model-download-actions">
                <Button type="btn-secondary" onClick={cancelDownload}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="chat-model-download-actions">
              <Button type="btn-primary" onClick={startDownload}>
                Download{modelStatus?.expectedBytes ? ` ${formatBytes(modelStatus.expectedBytes)}` : '…'}
              </Button>
              {providerAvailability?.anthropic?.available !== false && (
                <Button type="btn-link" onClick={() => changeOption('anthropic')}>
                  Use Anthropic Claude instead
                </Button>
              )}
            </div>
          )}
          {downloadError && (
            <div className="chat-error-banner" role="alert">
              {downloadError}
            </div>
          )}
        </div>
      )}

      {startError && (
        <div className="chat-error-banner" role="alert">
          {startError}
        </div>
      )}

      {summary && (
        <SummaryCard
          summary={summary}
          scanId={scanId}
          onAskAboutRule={askAboutRule}
          onAskAboutOccurrence={askAboutOccurrence}
          fetchFindingDetail={fetchFindingDetail}
          detailsOpen={detailsOpen}
          onDetailsToggle={setDetailsOpen}
        />
      )}

      <div
        className="chat-messages"
        aria-live="polite"
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
      >
        {messages.length === 0 && !startError && modelReady && (
          <div className="chat-empty">
            <p>Ask a question about the scan, or try one of these:</p>
            <div className="chat-suggested-chips">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chat-chip"
                  onClick={() => sendMessage(q)}
                  disabled={isStreaming}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message chat-message-${m.role}`}>
            {m.role === 'assistant' && m.reasoning && (
              <details className="chat-reasoning">
                <summary>Thinking</summary>
                <div className="chat-reasoning-body">{m.reasoning}</div>
              </details>
            )}
            {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && (
              <div className="chat-tool-calls">
                {m.toolCalls.map((tc) => {
                  const inProgress = tc.status === 'start' || tc.status === 'ready'
                  const label =
                    tc.status === 'error'
                      ? `${tc.name} failed`
                      : inProgress
                      ? `Calling ${tc.name}…`
                      : `Called ${tc.name}`
                  const hasBody =
                    (tc.input && Object.keys(tc.input).length > 0) ||
                    tc.result ||
                    tc.error
                  return (
                    <details
                      key={tc.id}
                      className={`chat-tool-call chat-tool-call-${tc.status}`}
                    >
                      <summary>
                        <span className="chat-tool-call-caret" aria-hidden="true">
                          ▸
                        </span>
                        {inProgress ? (
                          <>Calling <code>{tc.name}</code>…</>
                        ) : tc.status === 'error' ? (
                          <>
                            <code>{tc.name}</code> failed
                            {tc.error ? `: ${tc.error}` : ''}
                          </>
                        ) : (
                          <>Called <code>{tc.name}</code></>
                        )}
                      </summary>
                      {hasBody && (
                        <div className="chat-tool-call-body">
                          {tc.input && Object.keys(tc.input).length > 0 && (
                            <>
                              <div className="chat-tool-call-label">Input</div>
                              <pre>{JSON.stringify(tc.input, null, 2)}</pre>
                            </>
                          )}
                          {tc.result && (
                            <>
                              <div className="chat-tool-call-label">Result</div>
                              <pre>{tc.result}</pre>
                            </>
                          )}
                          {tc.error && (
                            <>
                              <div className="chat-tool-call-label">Error</div>
                              <pre>{tc.error}</pre>
                            </>
                          )}
                        </div>
                      )}
                    </details>
                  )
                })}
              </div>
            )}
            {m.role === 'assistant' && Array.isArray(m.attachments) && m.attachments.length > 0 && (
              <div className="chat-attachments" aria-label="Element screenshots">
                {m.attachments.map((a, ai) => (
                  <figure key={`${a.toolCallId}-${a.occurrenceIndex}-${ai}`} className="chat-attachment">
                    <img
                      src={a.dataUri}
                      alt={`Element screenshot for occurrence ${a.occurrenceIndex + 1}${
                        a.url ? ` on ${a.url}` : ''
                      }`}
                      loading="lazy"
                    />
                    <figcaption>
                      <span className="chat-attachment-index">#{a.occurrenceIndex + 1}</span>
                      {a.url ? (
                        <a className="chat-attachment-page" href={a.url} onClick={(e) => handleClickLink(e, a.url)}>
                          {a.pageTitle || a.url}
                        </a>
                      ) : a.pageTitle ? (
                        <span className="chat-attachment-page">{a.pageTitle}</span>
                      ) : null}
                      {a.xpath ? <code className="chat-attachment-xpath">{a.xpath}</code> : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {m.role === 'assistant' ? (
              <>
                <div
                  className="chat-message-body chat-markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  onClick={(e) => {
                    const copyBtn = e.target.closest('.chat-code-copy')
                    if (copyBtn) {
                      const wrapper = copyBtn.closest('.chat-code-block')
                      const pre = wrapper && wrapper.querySelector('pre')
                      const codeText = pre ? pre.innerText : ''
                      if (codeText) {
                        try {
                          navigator.clipboard.writeText(codeText)
                          const originalLabel = copyBtn.textContent
                          copyBtn.textContent = 'Copied'
                          copyBtn.classList.add('is-copied')
                          setTimeout(() => {
                            copyBtn.textContent = originalLabel
                            copyBtn.classList.remove('is-copied')
                          }, 1500)
                        } catch (_) {}
                      }
                      return
                    }
                    const anchor = e.target.closest('a[href]')
                    if (!anchor) return
                    const href = anchor.getAttribute('href')
                    if (!href || href === '#') return
                    handleClickLink(e, href)
                  }}
                />
                {m.content && !(isStreaming && streamingIndexRef.current === i) && (
                  <div className="chat-message-actions">
                    <button
                      type="button"
                      className="chat-copy-btn"
                      onClick={() => copyAssistantMarkdown(i, m.content)}
                      aria-label="Copy response as markdown"
                      title="Copy response as markdown"
                    >
                      {copiedIndex === i ? 'Copied!' : 'Copy as Markdown'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="chat-message-body">
                {m.content}
                {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                  <div className="chat-user-attachments" aria-label="Attached screenshots">
                    {m.attachments.map((a, ai) => (
                      <figure
                        key={`u-${i}-${ai}`}
                        className="chat-attachment chat-user-attachment"
                      >
                        <img
                          src={a.dataUri}
                          alt={`Attached screenshot${
                            typeof a.occurrenceIndex === 'number'
                              ? ` for occurrence ${a.occurrenceIndex + 1}`
                              : ''
                          }${a.url ? ` on ${a.url}` : ''}`}
                          loading="lazy"
                        />
                        {(a.pageTitle || a.url || a.xpath) && (
                          <figcaption>
                            {a.url ? (
                              <a className="chat-attachment-page" href={a.url} onClick={(e) => handleClickLink(e, a.url)}>
                                {a.pageTitle || a.url}
                              </a>
                            ) : a.pageTitle ? (
                              <span className="chat-attachment-page">{a.pageTitle}</span>
                            ) : null}
                            {a.xpath ? (
                              <code className="chat-attachment-xpath">{a.xpath}</code>
                            ) : null}
                          </figcaption>
                        )}
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {streamError && (
          <div className="chat-error-banner" role="alert">
            {streamError}
          </div>
        )}
        {messages.length > 0 && (
          <div className="chat-delete-container">
            <button
              type="button"
              className="chat-chip"
              onClick={handleDeleteChat}
              disabled={isStreaming}
            >
              Delete chat
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {isStreaming && streamStats && (
        <div className="chat-stream-stats" role="status" aria-live="off">
          {streamStats.tokensPerSec === null
            ? `${streamStats.elapsedSec.toFixed(1)}s · processing…`
            : `${streamStats.elapsedSec.toFixed(1)}s · ~${streamStats.tokensPerSec.toFixed(1)} tok/s`}
          {tokenUsage?.totalTokens != null
            ? ` · ${tokenUsage.isEstimate ? '~' : ''}${tokenUsage.totalTokens.toLocaleString()} tokens`
            : ''}
        </div>
      )}

      {!isStreaming && lastTurnStats && (
        <div className="chat-stream-stats chat-stream-stats-final" role="status" aria-live="off">
          {`${lastTurnStats.elapsedSec.toFixed(1)}s total`}
          {lastTurnStats.tokensPerSec != null ? ` · ~${lastTurnStats.tokensPerSec.toFixed(1)} tok/s` : ''}
          {lastTurnStats.totalTokens != null
            ? ` · ${lastTurnStats.isEstimate ? '~' : ''}${lastTurnStats.totalTokens.toLocaleString()} tokens`
            : ''}
        </div>
      )}

      {isStreaming && backendStatus && (
        <div className="chat-stream-status" role="status" aria-live="polite">
          {backendStatus}
        </div>
      )}

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage()
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            isStreaming
              ? `Responding${'.'.repeat(respondingDots)}`
              : 'Ask about the scan (Enter to send, Shift+Enter for newline)'
          }
          disabled={isStreaming || !!startError || !modelReady}
          rows={2}
        />
        <div className="chat-composer-buttons">
          {isStreaming ? (
            <Button type="btn-secondary" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button
              type="btn-primary"
              onClick={sendMessage}
              disabled={!input.trim() || !!startError || !modelReady}
            >
              Send
            </Button>
          )}
        </div>
      </form>
      <p className="chat-footnote">
        Large Language Models are supportive coding assistants but can make mistakes.
      </p>
    </div>
  )
}

export default ChatPage
