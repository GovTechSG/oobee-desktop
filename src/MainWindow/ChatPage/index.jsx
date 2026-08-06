import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { marked } from 'marked'
import SummaryCard from './SummaryCard'
import Button from '../../common/components/Button'
import './ChatPage.scss'

const renderMarkdown = (text) => {
  try {
    return marked.parse(text || '')
  } catch (_) {
    return text || ''
  }
}

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
          next.push({ role: 'assistant', content: '', toolCalls: [] })
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

  const sendMessage = () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setStreamError(null)
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    streamingIndexRef.current = null
    setIsStreaming(true)
    window.services.llmChatSend({ sessionId, userMessage: text })
    if (inputRef.current) inputRef.current.focus()
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

      {summary && <SummaryCard summary={summary} />}

      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 && !startError && (
          <div className="chat-empty">
            Ask a question about the scan — e.g. <em>"What's the worst issue?"</em> or{' '}
            <em>"Show me the HTML around the first color-contrast violation."</em>
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
