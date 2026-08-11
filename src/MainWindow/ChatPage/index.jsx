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

const ChatPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const scanId = location.state?.scanId

  const sessionId = useMemo(() => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }, [])

  const [summary, setSummary] = useState(null)
  const [startError, setStartError] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamError, setStreamError] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(true)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const streamingIndexRef = useRef(null)

  useEffect(() => {
    if (!scanId) {
      setStartError('Missing scanId. Return to the home page and start a new scan.')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.services.llmChatStart({ sessionId, scanId })
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
  }, [sessionId, scanId])

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

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  const sendMessage = (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text || isStreaming || startError) return
    setStreamError(null)
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setDetailsOpen(false)
    streamingIndexRef.current = null
    setIsStreaming(true)
    window.services.llmChatSend({ sessionId, userMessage: text })
    if (inputRef.current) inputRef.current.focus()
  }

  const askAboutRule = (rule) => {
    if (!rule) return
    const label = rule.description ? `"${rule.rule}" (${rule.description})` : `"${rule.rule}"`
    sendMessage(`Tell me more about the ${label} rule — where it occurs, why it matters, and how to fix it.`)
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
      </div>

      {startError && (
        <div className="chat-error-banner" role="alert">
          {startError}
        </div>
      )}

      {summary && (
        <SummaryCard
          summary={summary}
          onAskAboutRule={askAboutRule}
          detailsOpen={detailsOpen}
          onTopRulesToggle={setDetailsOpen}
        />
      )}

      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 && !startError && (
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
              <div className="chat-message-body">{m.content}</div>
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
            isStreaming ? 'Responding…' : 'Ask about the scan (Enter to send, Shift+Enter for newline)'
          }
          disabled={isStreaming || !!startError}
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
              disabled={!input.trim() || !!startError}
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
