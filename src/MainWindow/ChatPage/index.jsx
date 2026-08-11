import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { marked } from 'marked'
import SummaryCard from './SummaryCard'
import Button from '../../common/components/Button'
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

const renderMarkdown = (text) => {
  try {
    const html = marked.parse(normalizeLLMMarkdown(text))
    if (typeof DOMParser === 'undefined') return html
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const root = doc.body.firstChild
    if (!root) return html
    injectHexSwatches(root)
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

const PROVIDER_STORAGE_KEY = 'llmProvider'
const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic Claude (cloud)' },
  { id: 'gemma', label: 'Gemma 4 E4B (local)' },
]

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

const readStoredProvider = () => {
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY)
    return PROVIDERS.some((p) => p.id === raw) ? raw : 'anthropic'
  } catch (_) {
    return 'anthropic'
  }
}

const ChatPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const scanId = location.state?.scanId

  const [provider, setProvider] = useState(readStoredProvider)
  const [providerAvailability, setProviderAvailability] = useState(null)
  const providerInitialisedRef = useRef(false)
  // A new sessionId is minted on every provider switch — the backend disposes
  // the previous state and treats it as a fresh session.
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const sessionId = useMemo(() => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEpoch])

  const [summary, setSummary] = useState(null)
  const [startError, setStartError] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [respondingDots, setRespondingDots] = useState(1)
  const [streamError, setStreamError] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(true)

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

  const modelReady = provider !== 'gemma' || modelStatus?.downloaded === true

  // Probe provider availability once. If Anthropic isn't configured on this
  // machine (no ANTHROPIC_API_KEY / ~/.claude/settings.json), pre-select Gemma
  // so the dropdown lands on something the user can actually use.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await window.services.llmChatProviders()
        if (cancelled) return
        setProviderAvailability(p)
        if (!providerInitialisedRef.current) {
          providerInitialisedRef.current = true
          if (!p?.anthropic?.available && provider === 'anthropic') {
            try {
              window.localStorage.setItem(PROVIDER_STORAGE_KEY, 'gemma')
            } catch (_) {}
            setProvider('gemma')
            setSessionEpoch((e) => e + 1)
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

  // Probe model status whenever the user picks Gemma so we know if the
  // download panel needs to render.
  useEffect(() => {
    if (provider !== 'gemma') return
    let cancelled = false
    ;(async () => {
      try {
        const s = await window.services.llmModelStatus()
        if (!cancelled) setModelStatus(s)
      } catch (e) {
        if (!cancelled) setDownloadError(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, isDownloading])

  useEffect(() => {
    window.services.onLlmModelDownloadProgress((data) => setDownloadProgress(data))
    return () => window.services.removeLlmModelDownloadListeners()
  }, [])

  const startDownload = async () => {
    setDownloadError(null)
    setIsDownloading(true)
    setDownloadProgress({ downloaded: 0, total: modelStatus?.expectedBytes || 0, percent: 0 })
    try {
      const res = await window.services.llmModelDownload()
      if (!res?.ok) setDownloadError(res?.error || 'Download failed')
    } catch (e) {
      setDownloadError(e.message)
    } finally {
      setIsDownloading(false)
    }
  }

  const cancelDownload = () => {
    window.services.llmModelDownloadAbort()
  }

  const changeProvider = (next) => {
    if (next === provider) return
    try {
      window.localStorage.setItem(PROVIDER_STORAGE_KEY, next)
    } catch (_) {
      // localStorage disabled — ignore
    }
    setProvider(next)
    setMessages([])
    setStartError(null)
    setStreamError(null)
    setDetailsOpen(true)
    setSummary(null)
    setSessionEpoch((e) => e + 1)
  }

  useEffect(() => {
    if (!scanId) {
      setStartError('Missing scanId. Return to the home page and start a new scan.')
      return
    }
    if (!modelReady) return // gate on model download for Gemma
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.services.llmChatStart({ sessionId, scanId, provider })
        if (cancelled) return
        if (res && res.ok) {
          setSummary(res.summary)
        } else {
          setStartError(res?.error || 'Failed to start chat session.')
        }
      } catch (e) {
        if (!cancelled) setStartError(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, scanId, provider, modelReady])

  useEffect(() => {
    window.services.onLlmChatChunk(({ sessionId: sid, text }) => {
      if (sid !== sessionId) return
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

    window.services.onLlmChatToolCall(({ sessionId: sid, name, id, status, input, error }) => {
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
        const entry = { id, name, status, input, error }
        if (existing >= 0) {
          toolCalls[existing] = { ...toolCalls[existing], ...entry }
        } else {
          toolCalls.push(entry)
        }
        next[idx] = { ...next[idx], toolCalls }
        return next
      })
    })

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
    })

    window.services.onLlmChatError(({ sessionId: sid, message }) => {
      if (sid !== sessionId) return
      streamingIndexRef.current = null
      setIsStreaming(false)
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
    stickToBottomRef.current = true
    setIsStreaming(true)
    window.services.llmChatSend({ sessionId, userMessage: text, attachments })
    if (inputRef.current) inputRef.current.focus()
  }

  const askAboutRule = (rule) => {
    if (!rule) return
    const label = rule.description ? `"${rule.rule}" (${rule.description})` : `"${rule.rule}"`
    sendMessage(`Tell me more about the ${label} rule — where it occurs, why it matters, and how to fix it.`)
  }

  const fetchFindingDetail = useMemo(
    () => async (category, ruleId) => {
      return window.services.llmFindingDetail({ sessionId, category, ruleId })
    },
    [sessionId],
  )

  const askAboutOccurrence = (ctx) => {
    if (!ctx || !ctx.rule || !ctx.occurrence) return
    const { rule, description, category, conformance, axeImpact, helpUrl, occurrence, index } = ctx
    const htmlSnippet = (occurrence.html || '').slice(0, 500)
    const wcagFormatted = formatWcagConformance(conformance)
    const wcagList = wcagFormatted.length > 0 ? wcagFormatted.join(', ') : null
    const categoryLabel =
      category === 'mustFix' ? 'Must Fix'
        : category === 'goodToFix' ? 'Good to Fix'
          : category === 'needsReview' ? 'Needs Review'
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

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div id="chat-page">
      <div className="chat-page-header">
        <Button type="btn-link" onClick={() => navigate('/')}>
          ← Back
        </Button>
        <h1>LLM analysis</h1>
        <div className="chat-provider-select">
          <label htmlFor="chat-provider">Model</label>
          <select
            id="chat-provider"
            value={provider}
            onChange={(e) => changeProvider(e.target.value)}
            disabled={isStreaming || isDownloading}
          >
            {PROVIDERS.map((p) => {
              const unavailable =
                p.id === 'anthropic' && providerAvailability?.anthropic?.available === false
              return (
                <option key={p.id} value={p.id} disabled={unavailable}>
                  {unavailable ? `${p.label} — not configured` : p.label}
                </option>
              )
            })}
          </select>
        </div>
      </div>

      {provider === 'gemma' && modelStatus?.downloaded === false && (
        <div className="chat-model-download" role="region" aria-label="Gemma model download">
          <h2>Download Gemma 4 E4B</h2>
          <p>
            The local model runs entirely on your machine — no data leaves this device. First-time
            download is ~5 GB and is cached under your app data folder.
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
                <Button type="btn-link" onClick={() => changeProvider('anthropic')}>
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
            {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && (
              <div className="chat-tool-calls">
                {m.toolCalls.map((tc) => (
                  <div key={tc.id} className={`chat-tool-call chat-tool-call-${tc.status}`}>
                    {tc.status === 'start' && <>Calling <code>{tc.name}</code>…</>}
                    {tc.status === 'end' && <>Called <code>{tc.name}</code></>}
                    {tc.status === 'error' && (
                      <>
                        <code>{tc.name}</code> failed: {tc.error}
                      </>
                    )}
                  </div>
                ))}
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
                      {a.pageTitle || a.url ? (
                        <span className="chat-attachment-page">{a.pageTitle || a.url}</span>
                      ) : null}
                      {a.xpath ? <code className="chat-attachment-xpath">{a.xpath}</code> : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {m.role === 'assistant' ? (
              <div
                className="chat-message-body chat-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
              />
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
                            {a.pageTitle || a.url ? (
                              <span className="chat-attachment-page">{a.pageTitle || a.url}</span>
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
        <div ref={messagesEndRef} />
      </div>

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
    </div>
  )
}

export default ChatPage
