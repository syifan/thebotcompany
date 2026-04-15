import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, Plus, X, ChevronDown } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useAuth } from '@/hooks/useAuth'
import { AgentContentBlocks, buildChatAssistantBlocks } from '@/components/ui/agent-text-blocks'

function MessageBubble({ msg }) {
  if (msg.role === 'error') {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[90%] bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    )
  }

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
            <div className={`rounded-2xl rounded-br-sm px-3 py-2 text-sm ${msg.failed ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900' : 'bg-blue-500 text-white'}`}>
              {msg.content}
              {msg.failed && (
                <div className="mt-1 text-[11px] opacity-80">Failed to send{msg.error ? `: ${msg.error}` : ''}</div>
              )}
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

function buildCustomModelOptions(customConfig) {
  if (!customConfig) return []
  const options = []
  const seen = new Set()
  const pushOption = (id, label = id) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    options.push({ id, name: label })
  }

  pushOption(customConfig.defaultModel, customConfig.defaultModel)
  ;['high', 'mid', 'low', 'xlow'].forEach(tier => {
    const tierModel = customConfig.tiers?.[tier]?.model
    if (tierModel) pushOption(tierModel, `${tierModel} (${tier})`)
  })

  return options
}

function getModelOptionsForKey(key, availableModels = {}) {
  if (!key) return []
  if (key.provider === 'custom') return buildCustomModelOptions(key.customConfig)
  return availableModels[key.provider] || []
}

function formatSendErrorMessage({ error, statusCode, source, cooldownMs }) {
  if (source === 'local_cooldown') {
    return `This key is currently rate limited by TBC${cooldownMs ? ` for about ${Math.ceil(cooldownMs / 60_000)}m` : ''}.`
  }
  if (source === 'provider_429' || statusCode === 429) {
    return `Provider returned a 429/rate-limit error.${error ? `\n\n${error}` : ''}`
  }
  if (statusCode >= 500) {
    return `Server error (${statusCode}).${error ? `\n\n${error}` : ''}`
  }
  return error || 'Failed to send message.'
}

function normalizeSessionSelection(session) {
  return {
    selectedKeyId: session?.selected_key_id || 'auto',
    selectedModel: session?.selected_model || 'auto',
  }
}

function mergeServerMessages(serverMessages = [], localMessages = []) {
  const getServerImages = (server) => {
    if (server?.images) return server.images
    if (Array.isArray(server?.tool_calls)) return server.tool_calls
    if (typeof server?.tool_calls === 'string') {
      try {
        return JSON.parse(server.tool_calls || '[]')
      } catch {
        return []
      }
    }
    return []
  }

  const normalizeMessage = (msg) => ({
    role: msg?.role || '',
    content: msg?.content || '',
    images: msg?.images || getServerImages(msg),
    pending: !!msg?.pending,
    failed: !!msg?.failed,
    error: msg?.error || null,
  })

  const messagesEqual = (a = [], b = []) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (JSON.stringify(normalizeMessage(a[i])) !== JSON.stringify(normalizeMessage(b[i]))) return false
    }
    return true
  }

  const pendingMessages = localMessages.filter(msg => msg?.pending)
  if (pendingMessages.length === 0) {
    return messagesEqual(serverMessages, localMessages) ? localMessages : serverMessages
  }

  const unreconciledPending = pendingMessages.filter(pending => {
    return !serverMessages.some(server => {
      if (server?.role !== pending?.role) return false
      if ((server?.content || '') !== (pending?.content || '')) return false

      const serverImages = JSON.stringify(getServerImages(server))
      const pendingImages = JSON.stringify(pending?.images || [])
      return serverImages === pendingImages
    })
  })

  const mergedMessages = unreconciledPending.length === 0 ? serverMessages : [...serverMessages, ...unreconciledPending]
  return messagesEqual(mergedMessages, localMessages) ? localMessages : mergedMessages
}

export default function ChatPanel({ open, onClose, selectedProject, chatSession, onSessionCreated, chatConfig = {} }) {
  const { authFetch } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [selectedKeyId, setSelectedKeyId] = useState('auto')
  const [selectedModel, setSelectedModel] = useState('auto')
  const [attachedImages, setAttachedImages] = useState([]) // [{ file, preview, uploaded: { filename, url, mimeType } }]
  const fileInputRef = useRef(null)
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingToolCalls, setStreamingToolCalls] = useState([])
  const [streamingBlocks, setStreamingBlocks] = useState([]) // ordered: {type:'text',content} | {type:'tool',...}
  const [reconnecting, setReconnecting] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const shouldStickToBottomRef = useRef(true)
  const hydratedSessionIdRef = useRef(null)
  const keyOptions = (chatConfig.keyPool?.keys || []).filter(key => key.enabled)
  const selectedKey = selectedKeyId !== 'auto' ? keyOptions.find(key => key.id === selectedKeyId) || null : null
  const modelOptions = getModelOptionsForKey(selectedKey, chatConfig.availableModels)

  // Load messages when session changes
  useEffect(() => {
    if (!open || !chatSession || !selectedProject) {
      if (!open || !chatSession) {
        hydratedSessionIdRef.current = null
      }
      if (!chatSession || !selectedProject) {
        setMessages([])
      }
      return
    }
    if (chatSession._temp) {
      setMessages([])
      hydratedSessionIdRef.current = null
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
        if (cancelled) return
        const data = await res.json()
        if (data.session?.messages) setMessages(prev => mergeServerMessages(data.session.messages, prev))
        if (data.session) {
          const persistedSelection = normalizeSessionSelection(data.session)
          setSelectedKeyId(persistedSelection.selectedKeyId)
          setSelectedModel(persistedSelection.selectedModel)
          hydratedSessionIdRef.current = chatSession.id
        }

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
                    if (finalData.session?.messages) setMessages(prev => mergeServerMessages(finalData.session.messages, prev))
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
  }, [open, chatSession?.id, selectedProject?.id])

  // Poll for new messages (syncs across devices, picks up background completions)
  useEffect(() => {
    if (!chatSession || !selectedProject || !open || chatSession._temp) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.session?.messages) {
          setMessages(prev => mergeServerMessages(data.session.messages, prev))
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
                    if (fd.session?.messages) setMessages(prev => mergeServerMessages(fd.session.messages, prev))
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
  const updateScrollToBottomVisibility = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const isNearBottom = distanceFromBottom <= 12
    const hasOverflow = container.scrollHeight > container.clientHeight + 12
    shouldStickToBottomRef.current = isNearBottom
    setShowScrollToBottom(hasOverflow && !isNearBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    shouldStickToBottomRef.current = true
    updateScrollToBottomVisibility()
  }, [])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    let touchStartY = null

    const handleScroll = () => updateScrollToBottomVisibility()
    const handleWheel = (event) => {
      if (event.deltaY < 0) {
        shouldStickToBottomRef.current = false
        setShowScrollToBottom(true)
      }
    }
    const handlePointerDown = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      if (distanceFromBottom > 12) {
        shouldStickToBottomRef.current = false
      }
    }
    const handleTouchStart = (event) => {
      touchStartY = event.touches?.[0]?.clientY ?? null
    }
    const handleTouchMove = (event) => {
      const touchY = event.touches?.[0]?.clientY
      if (touchStartY !== null && touchY !== undefined && touchY > touchStartY + 4) {
        shouldStickToBottomRef.current = false
        setShowScrollToBottom(true)
      }
    }
    const handleTouchEnd = () => {
      touchStartY = null
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('pointerdown', handlePointerDown, { passive: true })
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    updateScrollToBottomVisibility()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [open, chatSession?.id, updateScrollToBottomVisibility])

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return
    scrollToBottom()
  }, [messages, streamingText, streamingToolCalls, scrollToBottom])

  // Reset streaming state when panel opens, but keep persisted chat selectors
  useEffect(() => {
    if (open) {
      setStreaming(false)
      setStreamingBlocks([])
      setStreamingText(''); setStreamingToolCalls([])
      if (chatSession?._temp) {
        setSelectedKeyId('auto')
        setSelectedModel('auto')
      } else if (chatSession) {
        const persistedSelection = normalizeSessionSelection(chatSession)
        setSelectedKeyId(persistedSelection.selectedKeyId)
        setSelectedModel(persistedSelection.selectedModel)
      }
      shouldStickToBottomRef.current = true
      requestAnimationFrame(() => scrollToBottom())
      if (inputRef.current) setTimeout(() => inputRef.current?.focus(), 350)
    }
  }, [open, chatSession?.id, chatSession?.selected_key_id, chatSession?.selected_model, chatSession?._temp, scrollToBottom])

  useEffect(() => {
    if (selectedKeyId === 'auto') {
      if (selectedModel !== 'auto') setSelectedModel('auto')
      return
    }
    if (selectedModel !== 'auto' && modelOptions.length > 0 && !modelOptions.some(model => model.id === selectedModel)) {
      setSelectedModel('auto')
    }
  }, [selectedKeyId, selectedModel, modelOptions])

  const persistSelection = useCallback(async (nextKeyId, nextModel) => {
    if (!chatSession || chatSession._temp || !selectedProject) return
    try {
      await authFetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedKeyId: nextKeyId !== 'auto' ? nextKeyId : null,
          selectedModel: nextModel !== 'auto' ? nextModel : null,
        }),
      })
    } catch {}
  }, [authFetch, chatSession, selectedProject])

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

  const resizeInput = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const resetInputHeight = () => {
    if (!inputRef.current) return
    inputRef.current.style.height = 'auto'
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
          body: JSON.stringify({
            selectedKeyId: selectedKeyId !== 'auto' ? selectedKeyId : null,
            selectedModel: selectedModel !== 'auto' ? selectedModel : null,
          }),
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
    const uploadedImages = attachedImages.filter(a => a.uploaded)
    const imageUrls = uploadedImages.map(a => a.uploaded.url)
    const optimisticId = `pending-${Date.now()}`
    setInput('')
    resetInputHeight()
    setAttachedImages([])
    setMessages(prev => [...prev, { id: optimisticId, role: 'user', content: userMsg, images: imageUrls, pending: true }])
    setStreaming(true)
    setStreamingText(''); setStreamingBlocks([])
    setStreamingToolCalls([])

    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/chats/${activeSession.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          keyId: selectedKeyId !== 'auto' ? selectedKeyId : null,
          model: selectedModel !== 'auto' ? selectedModel : null,
          images: uploadedImages.map(a => ({
            filename: a.uploaded.filename,
            mimeType: a.uploaded.mimeType,
          })),
        }),
      })

      if (!response.ok) {
        let errorData = null
        let errorMessage = 'Failed to send message'
        try {
          errorData = await response.json()
          if (errorData?.error) errorMessage = errorData.error
        } catch {}
        const err = new Error(errorMessage)
        err.hardFailure = true
        err.statusCode = response.status
        err.payload = errorData || { error: errorMessage, statusCode: response.status }
        throw err
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accText = ''
      let accToolCalls = []
      let streamErrored = false

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
                streamErrored = true
                try {
                  const errRes = await fetch(`/api/projects/${selectedProject.id}/chats/${activeSession.id}`)
                  const errData = await errRes.json()
                  if (errData.session?.messages) {
                    setMessages(errData.session.messages)
                  }
                } catch {
                  setMessages(prev => prev.map(msg => msg.id === optimisticId ? { ...msg, pending: false, failed: true, error: data.content } : msg))
                }
                break

              case 'done':
                setMessages(prev => prev.map(msg => msg.id === optimisticId ? { ...msg, pending: false } : msg))
                // Finalize — add assistant message with ordered blocks
                if (accText || accToolCalls.length > 0) {
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: accText,
                    tool_calls: accToolCalls.length > 0 ? accToolCalls : null,
                  }])
                }
                if (streamErrored && !accText && accToolCalls.length === 0) {
                  setStreamingText('')
                }
                // cleared
                break
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err?.hardFailure) {
        resizeInput(inputRef.current)
        const formattedError = formatSendErrorMessage(err.payload || { error: err.message, statusCode: err.statusCode || 500 })
        try {
          const errRes = await fetch(`/api/projects/${selectedProject.id}/chats/${activeSession.id}`)
          const errData = await errRes.json()
          if (errData.session?.messages) {
            const hasStoredError = errData.session.messages.some(msg => msg.role === 'assistant' && (msg.content || '').trim() === formattedError.trim())
            if (hasStoredError) {
              setMessages(errData.session.messages)
            } else {
              setMessages([
                ...errData.session.messages,
                { role: 'assistant', content: formattedError, success: false },
              ])
            }
          } else {
            setMessages(prev => [
              ...prev.map(msg => msg.id === optimisticId ? { ...msg, pending: false, failed: true, error: err.message || 'Failed to send message' } : msg),
              { role: 'assistant', content: formattedError },
            ])
          }
        } catch {
          setMessages(prev => [
            ...prev.map(msg => msg.id === optimisticId ? { ...msg, pending: false, failed: true, error: err.message || 'Failed to send message' } : msg),
            { role: 'assistant', content: formattedError },
          ])
        }
      } else {
        // Connection lost — backend continues processing in background.
        // Reload saved state and check if still streaming to reconnect.
        setReconnecting(true)
        try {
          const res = await fetch(`/api/projects/${selectedProject.id}/chats/${activeSession.id}`)
        if (res.ok) {
          const data = await res.json()
          if (data.session?.messages) setMessages(prev => mergeServerMessages(data.session.messages, prev))
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
      }
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
        <div className="relative flex-1 min-h-0">
          <div
            ref={messagesContainerRef}
            className="h-full overflow-y-auto overflow-x-hidden p-4 space-y-1 overscroll-contain"
          >
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

          {showScrollToBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 right-3 h-10 w-10 rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-colors flex items-center justify-center"
              title="Scroll to bottom"
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          )}
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
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-3 shadow-sm">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={streaming}
              rows={1}
              className="w-full resize-none bg-transparent px-0 py-0 text-base text-neutral-800 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none disabled:opacity-50 max-h-40 overflow-y-auto"
              style={{ minHeight: '1.5rem' }}
              onInput={(e) => resizeInput(e.target)}
            />
            <div className="mt-3 flex items-center gap-2 sm:gap-3">
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming}
                className="h-9 w-9 flex items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-50 transition-colors shrink-0"
                title="Attach images"
                aria-label="Attach images"
              >
                <Plus className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <select
                  value={selectedKeyId}
                  onChange={(e) => {
                    const nextKeyId = e.target.value
                    setSelectedKeyId(nextKeyId)
                    const nextModel = nextKeyId === 'auto' ? 'auto' : selectedModel
                    if (nextKeyId === 'auto') setSelectedModel('auto')
                    persistSelection(nextKeyId, nextModel)
                  }}
                  className="min-w-0 flex-1 px-3 py-2 text-xs bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-full text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  title="Key"
                  aria-label="Key"
                >
                  <option value="auto">Key: Auto</option>
                  {keyOptions.map(key => (
                    <option key={key.id} value={key.id}>{key.label} — {key.provider}</option>
                  ))}
                </select>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    const nextModel = e.target.value
                    setSelectedModel(nextModel)
                    persistSelection(selectedKeyId, nextModel)
                  }}
                  disabled={selectedKeyId === 'auto'}
                  className="min-w-0 flex-1 px-3 py-2 text-xs bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-full text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  title="Model"
                  aria-label="Model"
                >
                  <option value="auto">Model: Auto</option>
                  {modelOptions.map(model => (
                    <option key={model.id} value={model.id}>{model.name || model.id}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={sendMessage}
                disabled={streaming || !input.trim()}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                title="Send"
                aria-label="Send"
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
