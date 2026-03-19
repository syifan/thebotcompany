import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, ChevronDown, ChevronRight, Terminal, FileText, Pencil, Search, FolderSearch } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { useAuth } from '@/hooks/useAuth'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const TOOL_ICONS = {
  Bash: Terminal,
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Glob: FolderSearch,
  Grep: Search,
}

function ToolCallBlock({ name, input, output }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = TOOL_ICONS[name] || Terminal

  return (
    <div className="my-1.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Icon className="w-3 h-3 shrink-0 text-blue-500" />
        <span className="font-semibold text-blue-600 dark:text-blue-400">{name}</span>
        <span className="text-neutral-500 dark:text-neutral-400 truncate text-left flex-1">
          {name === 'Bash' && input?.command ? input.command.slice(0, 60) : ''}
          {(name === 'Read' || name === 'Write' || name === 'Edit') && input?.file_path ? input.file_path : ''}
          {name === 'Grep' && input?.pattern ? `/${input.pattern}/` : ''}
          {name === 'Glob' && input?.pattern ? input.pattern : ''}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-neutral-200 dark:border-neutral-700">
          <div className="px-2 py-1 bg-neutral-100 dark:bg-neutral-900 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto text-neutral-600 dark:text-neutral-400">
            {JSON.stringify(input, null, 2)}
          </div>
          {output && (
            <div className="px-2 py-1 border-t border-neutral-200 dark:border-neutral-700 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-950">
              {output}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] bg-blue-500 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm">
          {msg.content}
        </div>
      </div>
    )
  }

  if (msg.role === 'tool_result') {
    // Don't render separately — tool results are shown inline in tool calls
    return null
  }

  // Assistant
  const toolCalls = msg.tool_calls ? (typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : msg.tool_calls) : []

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[90%]">
        {toolCalls.map((tc, i) => (
          <ToolCallBlock key={tc.id || i} name={tc.name} input={tc.input} output={tc.output} />
        ))}
        {msg.content && (
          <div className="bg-neutral-100 dark:bg-neutral-800 rounded-2xl rounded-bl-sm px-3 py-2 text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none [&_code]:break-all [&_pre]:overflow-x-auto [&_pre]:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({ open, onClose, selectedProject, chatSession }) {
  const { authFetch } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingToolCalls, setStreamingToolCalls] = useState([])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Load messages when session changes
  useEffect(() => {
    if (!chatSession || !selectedProject) {
      setMessages([])
      return
    }
    fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.session?.messages) setMessages(data.session.messages)
      })
      .catch(() => {})
  }, [chatSession?.id, selectedProject?.id])

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamingText, streamingToolCalls])

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 350)
    }
  }, [open, chatSession?.id])

  const sendMessage = async () => {
    if (!input.trim() || streaming || !chatSession || !selectedProject) return

    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setStreaming(true)
    setStreamingText('')
    setStreamingToolCalls([])

    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accText = ''
      let accToolCalls = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // Keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            switch (data.type) {
              case 'text':
                accText += data.content
                setStreamingText(accText)
                break

              case 'tool_call':
                accToolCalls = [...accToolCalls, { id: data.id, name: data.name, input: data.input }]
                setStreamingToolCalls([...accToolCalls])
                break

              case 'tool_result':
                accToolCalls = accToolCalls.map(tc =>
                  tc.id === data.id ? { ...tc, output: data.output } : tc
                )
                setStreamingToolCalls([...accToolCalls])
                break

              case 'error':
                accText += `\n\n⚠️ Error: ${data.content}`
                setStreamingText(accText)
                break

              case 'done':
                // Finalize — add assistant message to messages list
                if (accText || accToolCalls.length > 0) {
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: accText,
                    tool_calls: accToolCalls.length > 0 ? accToolCalls : null,
                  }])
                }
                break
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Network error: ${err.message}`,
      }])
    } finally {
      setStreaming(false)
      setStreamingText('')
      setStreamingToolCalls([])
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <Panel id="chat" open={open} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          💬 {chatSession?.title || 'Chat'}
        </span>
      </PanelHeader>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1">
          {messages.length === 0 && !streaming && (
            <div className="text-center text-neutral-400 dark:text-neutral-500 text-sm py-12">
              Ask anything about the project...
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          {/* Streaming indicators */}
          {streaming && (streamingToolCalls.length > 0 || streamingText) && (
            <div className="flex justify-start mb-3">
              <div className="max-w-[90%]">
                {streamingToolCalls.map((tc, i) => (
                  <ToolCallBlock key={tc.id || i} name={tc.name} input={tc.input} output={tc.output} />
                ))}
                {streamingText && (
                  <div className="bg-neutral-100 dark:bg-neutral-800 rounded-2xl rounded-bl-sm px-3 py-2 text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          )}

          {streaming && !streamingText && streamingToolCalls.length === 0 && (
            <div className="flex justify-start mb-3">
              <div className="bg-neutral-100 dark:bg-neutral-800 rounded-2xl rounded-bl-sm px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-3 bg-white dark:bg-neutral-800">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={streaming}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '38px' }}
              onInput={(e) => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}
