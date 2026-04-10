import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, Paperclip, X } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useAuth } from '@/hooks/useAuth'
import { AgentContentBlocks, buildChatAssistantBlocks } from '@/components/ui/agent-text-blocks'

function MessageBubble({ msg }) {
  if (msg.role === 'user') {
    // Images stored in tool_calls field for user messages (from DB), or in images field (from local state)
    const images = msg.images || (msg.tool_calls ? (typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : msg.tool_calls) : null)
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%]">
          {images && images.length > 0 && (
            <div className="flex gap-1 justify-end mb-1">
              {images.map((url, i) => (
                <img key={i} src={url} alt="" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
              ))}
            </div>
          )}
          {msg.content && (
            <div className="bg-blue-500 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm">
              {msg.content}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (msg.role === 'tool_result') {
    // Don't render separately — tool results are shown inline in tool calls
    return null
  }

  // Assistant
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[90%]">
        <AgentContentBlocks blocks={buildChatAssistantBlocks(msg)} />
      </div>
    </div>
  )
}

export default function ChatPanel({ open, onClose, selectedProject, chatSession, onSessionCreated, modelTiers = {} }) {
  const { authFetch } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [modelTier, setModelTier] = useState(chatSession?.model_tier || 'high')
  const [attachedImages, setAttachedImages] = useState([]) // [{ file, preview, uploaded: { filename, url, mimeType } }]
  const fileInputRef = useRef(null)
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingToolCalls, setStreamingToolCalls] = useState([])
  const [streamingBlocks, setStreamingBlocks] = useState([]) // ordered: {type:'text',content} | {type:'tool',...}
  const [reconnecting, setReconnecting] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Load messages when session changes
  useEffect(() => {
    if (!chatSession || !selectedProject) {
      setMessages([])
      return
    }
    if (chatSession._temp) {
      setMessages([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
        if (cancelled) return
        const data = await res.json()
        if (data.session?.messages) setMessages(data.session.messages)

        // If backend is NOT streaming, ensure frontend streaming state is cleared
        if (!data.streaming) {
          setStreaming(false)
          setStreamingBlocks([])
          setStreamingText('')
          setStreamingToolCalls([])
        }

        // If backend is still streaming, show current content and reconnect
        if (data.streaming && data.streamingContent) {
          setStreaming(true)
          // Build initial blocks from streaming content
          const initialBlocks = []
          const sc = data.streamingContent
          if (sc.text) initialBlocks.push({ type: 'text', content: sc.text })
          if (sc.toolCalls) sc.toolCalls.forEach(tc => initialBlocks.push({ type: 'tool', ...tc }))
          setStreamingBlocks(initialBlocks)
          setStreamingText(sc.text || '')
          setStreamingToolCalls(sc.toolCalls || [])

          // Reconnect to SSE stream for remaining events
          const evtRes = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}/stream`)
          if (cancelled) return
          const reader = evtRes.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done || cancelled) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const evt = JSON.parse(line.slice(6))
                switch (evt.type) {
                  case 'text':
                    setStreamingBlocks(prev => {
                      const last = prev[prev.length - 1]
                      if (last?.type === 'text') return [...prev.slice(0, -1), { type: 'text', content: last.content + evt.content }]
                      return [...prev, { type: 'text', content: evt.content }]
                    })
                    break
                  case 'tool_call':
                    setStreamingBlocks(prev => [...prev, { type: 'tool', ...evt }])
                    break
                  case 'tool_result':
                    setStreamingBlocks(prev => prev.map(b => b.type === 'tool' && b.id === evt.id ? { ...b, output: evt.output, ok: evt.ok, exitCode: evt.exitCode } : b))
                    break
                  case 'done':
                    const finalRes = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
                    const finalData = await finalRes.json()
                    if (finalData.session?.messages) setMessages(finalData.session.messages)
                    setStreaming(false)
                    setStreamingText(''); setStreamingBlocks([])
                    setStreamingToolCalls([])
                    return
                }
              } catch {}
            }
          }
          setStreaming(false)
          setStreamingText(''); setStreamingBlocks([])
          setStreamingToolCalls([])
        }
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [chatSession?.id, selectedProject?.id])

  // Poll for new messages (syncs across devices, picks up background completions)
  useEffect(() => {
    if (!chatSession || !selectedProject || !open || chatSession._temp) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.session?.messages && data.session.messages.length !== messages.length) {
          setMessages(data.session.messages)
        }
        // If backend started streaming (from another device), show content and reconnect
        if (data.streaming && !streaming) {
          setStreaming(true)
          if (data.streamingContent) {
            const blocks = []
            if (data.streamingContent.text) blocks.push({ type: 'text', content: data.streamingContent.text })
            if (data.streamingContent.toolCalls) data.streamingContent.toolCalls.forEach(tc => blocks.push({ type: 'tool', ...tc }))
            setStreamingBlocks(blocks)
            setStreamingText(data.streamingContent.text || '')
          }
          // Connect to SSE stream
          try {
            const evtRes = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}/stream`)
            const reader = evtRes.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop()
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                try {
                  const evt = JSON.parse(line.slice(6))
                  if (evt.type === 'text') setStreamingBlocks(prev => {
                    const last = prev[prev.length - 1]
                    if (last?.type === 'text') return [...prev.slice(0, -1), { type: 'text', content: last.content + evt.content }]
                    return [...prev, { type: 'text', content: evt.content }]
                  })
                  else if (evt.type === 'tool_call') setStreamingBlocks(prev => [...prev, { type: 'tool', ...evt }])
                  else if (evt.type === 'tool_result') setStreamingBlocks(prev => prev.map(b => b.id === evt.id ? { ...b, output: evt.output, ok: evt.ok, exitCode: evt.exitCode } : b))
                  else if (evt.type === 'done') {
                    const fr = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
                    const fd = await fr.json()
                    if (fd.session?.messages) setMessages(fd.session.messages)
                    setStreaming(false)
                    setStreamingBlocks([])
                    setStreamingText('')
                    break
                  }
                } catch {}
              }
            }
          } catch { setStreaming(false); setStreamingBlocks([]) }
        }
        // If backend stopped streaming, update messages
        if (!data.streaming && streaming) {
          setStreaming(false)
          setStreamingBlocks([])
          setStreamingText('')
        }
      } catch {}
    }
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [chatSession?.id, selectedProject?.id, open, streaming, messages.length])

  // Auto-scroll — use scrollTop instead of scrollIntoView to prevent parent scroll
  const messagesContainerRef = useRef(null)
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamingText, streamingToolCalls])

  // Reset streaming state and sync model tier when panel opens
  useEffect(() => {
    if (open) {
      setStreaming(false)
      setStreamingBlocks([])
      setStreamingText(''); setStreamingToolCalls([])
      if (chatSession?.model_tier) setModelTier(chatSession.model_tier)
      if (inputRef.current) setTimeout(() => inputRef.current?.focus(), 350)
    }
  }, [open, chatSession?.id])



  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const preview = URL.createObjectURL(file)
      // Upload immediately
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await authFetch(`/api/projects/${selectedProject.id}/chats/upload`, {
          method: 'POST',
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          setAttachedImages(prev => [...prev, { file, preview, uploaded: data }])
        }
      } catch {}
    }
    e.target.value = '' // reset input
  }

  const removeImage = (idx) => {
    setAttachedImages(prev => {
      const removed = prev[idx]
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const sendMessage = async () => {
    if ((!input.trim() && attachedImages.length === 0) || streaming || !chatSession || !selectedProject) return

    let activeSession = chatSession

    // If temp session, create it in DB first
    if (chatSession._temp) {
      try {
        const res = await authFetch(`/api/projects/${selectedProject.id}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) return
        const data = await res.json()
        activeSession = data.session
        if (onSessionCreated) onSessionCreated(activeSession)
      } catch { return }
    } else {
      // Double-check backend isn't already processing
      try {
        const checkRes = await fetch(`/api/projects/${selectedProject.id}/chats/${activeSession.id}`)
        const checkData = await checkRes.json()
        if (checkData.streaming) {
          setStreaming(true)
          return
        }
      } catch {}
    }

    const userMsg = input.trim()
    setInput('')
    const imageUrls = attachedImages.filter(a => a.uploaded).map(a => a.uploaded.url)
    setAttachedImages([])
    setMessages(prev => [...prev, { role: 'user', content: userMsg, images: imageUrls }])
    setStreaming(true)
    setStreamingText(''); setStreamingBlocks([])
    setStreamingToolCalls([])

    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/chats/${activeSession.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          modelTier,
          images: attachedImages.filter(a => a.uploaded).map(a => ({
            filename: a.uploaded.filename,
            mimeType: a.uploaded.mimeType,
          })),
        }),
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
                // Append to or update last text block
                setStreamingBlocks(prev => {
                  const last = prev[prev.length - 1]
                  if (last && last.type === 'text') {
                    return [...prev.slice(0, -1), { type: 'text', content: last.content + data.content }]
                  }
                  return [...prev, { type: 'text', content: data.content }]
                })
                break

              case 'tool_call':
                accToolCalls = [...accToolCalls, { id: data.id, name: data.name, input: data.input }]
                setStreamingToolCalls([...accToolCalls])
                setStreamingBlocks(prev => [...prev, { type: 'tool', id: data.id, name: data.name, input: data.input }])
                break

              case 'tool_result':
                accToolCalls = accToolCalls.map(tc =>
                  tc.id === data.id ? { ...tc, output: data.output, ok: data.ok, exitCode: data.exitCode } : tc
                )
                setStreamingToolCalls([...accToolCalls])
                setStreamingBlocks(prev => prev.map(b =>
                  b.type === 'tool' && b.id === data.id ? { ...b, output: data.output, ok: data.ok, exitCode: data.exitCode } : b
                ))
                break

              case 'error':
                accText += `\n\n⚠️ Error: ${data.content}`
                setStreamingText(accText)
                setStreamingBlocks(prev => [...prev, { type: 'text', content: `\n\n⚠️ Error: ${data.content}` }])
                break

              case 'done':
                // Finalize — add assistant message with ordered blocks
                if (accText || accToolCalls.length > 0) {
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: accText,
                    tool_calls: accToolCalls.length > 0 ? accToolCalls : null,
                  }])
                }
                // cleared
                break
            }
          } catch {}
        }
      }
    } catch (err) {
      // Connection lost — backend continues processing in background.
      // Reload saved state and check if still streaming to reconnect.
      setReconnecting(true)
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
        if (res.ok) {
          const data = await res.json()
          if (data.session?.messages) setMessages(data.session.messages)
          if (data.streaming && data.streamingContent) {
            // Still streaming — show current content and reconnect
            setStreamingText(data.streamingContent.text || '')
            setStreamingBlocks(data.streamingContent.toolCalls?.map(tc => ({ type: 'tool', ...tc })) || [])
            // Reconnect SSE
            try {
              const evtRes = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}/stream`)
              const reader = evtRes.body.getReader()
              const decoder = new TextDecoder()
              let buffer = ''
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop()
                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue
                  try {
                    const evt = JSON.parse(line.slice(6))
                    if (evt.type === 'text') setStreamingBlocks(prev => {
                      const last = prev[prev.length - 1]
                      if (last?.type === 'text') return [...prev.slice(0, -1), { type: 'text', content: last.content + evt.content }]
                      return [...prev, { type: 'text', content: evt.content }]
                    })
                    else if (evt.type === 'tool_call') setStreamingBlocks(prev => [...prev, { type: 'tool', ...evt }])
                    else if (evt.type === 'tool_result') setStreamingBlocks(prev => prev.map(b => b.id === evt.id ? { ...b, output: evt.output, ok: evt.ok, exitCode: evt.exitCode } : b))
                    else if (evt.type === 'done') {
                      const finalRes2 = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
                      const finalData2 = await finalRes2.json()
                      if (finalData2.session?.messages) setMessages(finalData2.session.messages)
                      break
                    }
                  } catch {}
                }
              }
            } catch {}
          }
        }
      } catch {}
      setReconnecting(false)
    } finally {
      setStreaming(false)
      setStreamingText(''); setStreamingBlocks([])
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
        💬 {chatSession?.title || 'Chat'}
      </PanelHeader>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Messages area */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 overscroll-contain">
          {messages.length === 0 && !streaming && (
            <div className="text-center text-neutral-400 dark:text-neutral-500 text-sm py-12">
              Ask anything about the project...
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          {/* Streaming indicators */}
          {streaming && streamingBlocks.length > 0 && (
            <div className="flex justify-start mb-3">
              <div className="max-w-[90%]">
                <AgentContentBlocks blocks={streamingBlocks} />
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

        {/* Reconnecting indicator */}
        {reconnecting && (
          <div className="border-t border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-3 py-2 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
            <span className="text-xs text-blue-600 dark:text-blue-400">Reconnecting...</span>
          </div>
        )}

        {/* Model selector + Input area */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-3 bg-white dark:bg-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">Model</span>
            <select
              value={modelTier}
              onChange={(e) => setModelTier(e.target.value)}
              className="px-2 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {['high', 'mid', 'low', 'xlow'].map(tier => {
                const info = modelTiers[tier]
                const label = info?.model
                  ? `${tier.charAt(0).toUpperCase() + tier.slice(1)} — ${info.model}${info.reasoningEffort ? ` (${info.reasoningEffort})` : ''}`
                  : tier.charAt(0).toUpperCase() + tier.slice(1)
                return <option key={tier} value={tier}>{label}</option>
              })}
            </select>
          </div>
          {/* Image previews */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto">
              {attachedImages.map((img, idx) => (
                <div key={idx} className="relative shrink-0">
                  <img src={img.preview} alt="" className="w-16 h-16 object-cover rounded border border-neutral-200 dark:border-neutral-600" />
                  <button onClick={() => removeImage(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-50 transition-colors shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={streaming}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-base text-neutral-800 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '38px' }}
              onInput={(e) => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              className="p-3 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}
