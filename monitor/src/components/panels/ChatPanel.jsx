import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, ChevronDown, ChevronRight, Terminal, FileText, Pencil, Search, FolderSearch } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useAuth } from '@/hooks/useAuth'
import {
  useLocalRuntime,
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'

// ── Tool call rendering ──────────────────────────────────────────────

const TOOL_ICONS = {
  Bash: Terminal,
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Glob: FolderSearch,
  Grep: Search,
}

function ToolCallBlock({ name, args, result }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = TOOL_ICONS[name] || Terminal

  const summary = (() => {
    if (name === 'Bash' && args?.command) return args.command.slice(0, 60)
    if (['Read', 'Write', 'Edit'].includes(name) && args?.file_path) return args.file_path
    if (name === 'Grep' && args?.pattern) return `/${args.pattern}/`
    if (name === 'Glob' && args?.pattern) return args.pattern
    return ''
  })()

  return (
    <div className="my-1.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Icon className="w-3 h-3 shrink-0 text-blue-500" />
        <span className="font-semibold text-blue-600 dark:text-blue-400">{name}</span>
        <span className="text-neutral-500 dark:text-neutral-400 truncate text-left flex-1">{summary}</span>
      </button>
      {expanded && (
        <div className="border-t border-neutral-200 dark:border-neutral-700">
          <div className="px-2 py-1 bg-neutral-100 dark:bg-neutral-900 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto text-neutral-600 dark:text-neutral-400">
            {JSON.stringify(args, null, 2)}
          </div>
          {result !== undefined && (
            <div className="px-2 py-1 border-t border-neutral-200 dark:border-neutral-700 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-950">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Message part components ─────────────────────────────────────────

function UserTextPart({ part }) {
  return <span>{part.text}</span>
}

function UserImagePart({ part }) {
  return <img src={part.image} alt="attachment" className="max-w-full rounded mt-1" />
}

function AssistantTextPart() {
  return (
    <div className="bg-neutral-100 dark:bg-neutral-800 rounded-2xl rounded-bl-sm px-3 py-2 text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none [&_code]:break-all [&_pre]:overflow-x-auto [&_pre]:text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} />
    </div>
  )
}

function AssistantToolCallPart({ part }) {
  return (
    <ToolCallBlock
      name={part.toolName}
      args={part.args}
      result={part.result}
    />
  )
}

// ── Message components ──────────────────────────────────────────────

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end mb-3">
      <div className="max-w-[85%] bg-blue-500 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
        <MessagePrimitive.Parts
          components={{
            Text: UserTextPart,
            Image: UserImagePart,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start mb-3">
      <div className="max-w-[90%] space-y-1">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantTextPart,
            ToolCall: AssistantToolCallPart,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

// ── Composer ─────────────────────────────────────────────────────────

function ChatComposer() {
  return (
    <ComposerPrimitive.Root className="border-t border-neutral-200 dark:border-neutral-700 p-3 bg-white dark:bg-neutral-800">
      <div className="flex items-end gap-2">
        <ComposerPrimitive.Input
          placeholder="Type a message..."
          rows={1}
          autoFocus
          className="flex-1 resize-none rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
          style={{ minHeight: '38px' }}
        />
        <ComposerPrimitive.Send
          className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  )
}

// ── Thread ───────────────────────────────────────────────────────────

function ChatThread() {
  return (
    <ThreadPrimitive.Root className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 overscroll-contain">
        <ThreadPrimitive.Empty>
          <div className="text-center text-neutral-400 dark:text-neutral-500 text-sm py-12">
            Ask anything about the project...
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>

      <ChatComposer />
    </ThreadPrimitive.Root>
  )
}

// ── Convert backend messages to ThreadMessageLike ───────────────────

function convertBackendMessages(messages) {
  if (!messages || messages.length === 0) return []

  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map((msg, idx) => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: msg.content || '',
          id: `msg-${idx}`,
        }
      }

      // Assistant — may have tool_calls and text content
      const parts = []
      const toolCalls = msg.tool_calls
        ? (typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : msg.tool_calls)
        : []

      for (const tc of toolCalls) {
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id || `tc-${idx}-${parts.length}`,
          toolName: tc.name,
          args: tc.input || {},
          argsText: JSON.stringify(tc.input || {}),
          result: tc.output,
        })
      }

      if (msg.content) {
        parts.push({ type: 'text', text: msg.content })
      }

      return {
        role: 'assistant',
        content: parts.length > 0 ? parts : (msg.content || ''),
        id: `msg-${idx}`,
        status: { type: 'complete' },
      }
    })
}

// ── Chat model adapter (SSE) ────────────────────────────────────────

function createChatModelAdapter({ projectId, sessionId, authFetch, onSessionCreate }) {
  return {
    async *run({ messages, abortSignal }) {
      // Extract the last user message text
      const lastMsg = messages[messages.length - 1]
      if (!lastMsg || lastMsg.role !== 'user') return

      const textParts = lastMsg.content?.filter?.(p => p.type === 'text') || []
      const userText = textParts.map(p => p.text).join('') || ''
      if (!userText.trim()) return

      // Handle temp session creation
      let activeSessionId = sessionId
      if (!activeSessionId) {
        const created = await onSessionCreate()
        if (!created) return
        activeSessionId = created
      }

      // Send message via SSE
      const response = await authFetch(`/api/projects/${projectId}/chats/${activeSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
        signal: abortSignal,
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const contentParts = []

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

            switch (evt.type) {
              case 'text': {
                const lastPart = contentParts[contentParts.length - 1]
                if (lastPart?.type === 'text') {
                  lastPart.text += evt.content
                } else {
                  contentParts.push({ type: 'text', text: evt.content })
                }
                yield { content: contentParts.map(p => ({ ...p })) }
                break
              }

              case 'tool_call': {
                contentParts.push({
                  type: 'tool-call',
                  toolCallId: evt.id,
                  toolName: evt.name,
                  args: evt.input || {},
                  argsText: JSON.stringify(evt.input || {}),
                })
                yield { content: contentParts.map(p => ({ ...p })) }
                break
              }

              case 'tool_result': {
                const tc = contentParts.find(p => p.type === 'tool-call' && p.toolCallId === evt.id)
                if (tc) tc.result = evt.output
                yield { content: contentParts.map(p => ({ ...p })) }
                break
              }

              case 'error': {
                contentParts.push({ type: 'text', text: `\n\n⚠️ Error: ${evt.content}` })
                yield { content: contentParts.map(p => ({ ...p })) }
                break
              }

              case 'done': {
                return {
                  content: contentParts.map(p => ({ ...p })),
                  status: { type: 'complete' },
                }
              }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      // Stream ended without explicit done
      return {
        content: contentParts.map(p => ({ ...p })),
        status: { type: 'complete' },
      }
    },
  }
}

// ── Inner chat component (keyed per session) ────────────────────────

function AssistantChat({ projectId, sessionId, authFetch, onSessionCreate, initialMessages }) {
  const adapter = useMemo(
    () => createChatModelAdapter({ projectId, sessionId, authFetch, onSessionCreate }),
    [projectId, sessionId, authFetch, onSessionCreate]
  )

  const runtime = useLocalRuntime(adapter, {
    initialMessages,
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread />
    </AssistantRuntimeProvider>
  )
}

// ── Main ChatPanel ──────────────────────────────────────────────────

export default function ChatPanel({ open, onClose, selectedProject, chatSession, onSessionCreated }) {
  const { authFetch } = useAuth()
  const [initialMessages, setInitialMessages] = useState(null)
  const [sessionId, setSessionId] = useState(chatSession?.id || null)
  const [loading, setLoading] = useState(false)

  // Track sessionId from props
  useEffect(() => {
    setSessionId(chatSession?.id || null)
  }, [chatSession?.id])

  // Load messages when session changes
  useEffect(() => {
    if (!chatSession || !selectedProject) {
      setInitialMessages([])
      return
    }
    if (chatSession._temp) {
      setInitialMessages([])
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/chats/${chatSession.id}`)
        if (cancelled) return
        const data = await res.json()
        const converted = convertBackendMessages(data.session?.messages || [])
        setInitialMessages(converted)
      } catch {
        setInitialMessages([])
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [chatSession?.id, selectedProject?.id])

  // Create session callback for temp sessions
  const handleSessionCreate = useCallback(async () => {
    if (!selectedProject) return null
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) return null
      const data = await res.json()
      const newSession = data.session
      setSessionId(newSession.id)
      if (onSessionCreated) onSessionCreated(newSession)
      return newSession.id
    } catch {
      return null
    }
  }, [selectedProject?.id, authFetch, onSessionCreated])

  const chatKey = `${selectedProject?.id}-${sessionId || 'temp'}-${chatSession?._temp ? 'temp' : 'saved'}`

  return (
    <Panel id="chat" open={open} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          💬 {chatSession?.title || 'Chat'}
        </span>
      </PanelHeader>

      {loading || initialMessages === null ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
        </div>
      ) : (
        <AssistantChat
          key={chatKey}
          projectId={selectedProject?.id}
          sessionId={sessionId}
          authFetch={authFetch}
          onSessionCreate={handleSessionCreate}
          initialMessages={initialMessages}
        />
      )}
    </Panel>
  )
}
