import React, { useEffect, useState } from 'react'
import { MessageCircle, Plus, Trash2 } from 'lucide-react'
import DashboardWidget from '@/components/ui/DashboardWidget'
import { useAuth } from '@/hooks/useAuth'

export default function ChatCard({ selectedProject, onOpenChat, onNewChat }) {
  const { authFetch } = useAuth()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchSessions = async () => {
    if (!selectedProject) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/chats`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchSessions() }, [selectedProject?.id])

  const handleNew = () => {
    if (!selectedProject) return
    // Create a temporary unsaved session — only persists to DB on first message
    const tempSession = { id: null, title: 'New Chat', _temp: true }
    if (onNewChat) onNewChat(tempSession)
  }

  const handleDelete = async (e, chatId) => {
    e.stopPropagation()
    try {
      await authFetch(`/api/projects/${selectedProject.id}/chats/${chatId}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== chatId))
    } catch {}
  }

  return (
    <DashboardWidget
      icon={MessageCircle}
      title="Chat"
      headerRight={
        <button
          onClick={handleNew}
          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 transition-colors"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </button>
      }
    >
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800 overflow-y-auto h-full">
          {sessions.length === 0 && !loading && (
            <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-4">
              No chats yet
            </p>
          )}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors -mx-1 px-1 rounded group"
              onClick={() => onOpenChat(session)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate flex-1">
                  {session.title}
                </span>
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                  {session.message_count || 0} msgs
                </span>
                <button
                  onClick={(e) => handleDelete(e, session.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-500 transition-all"
                  title="Delete chat"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                {new Date(session.updated_at).toLocaleString()}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center justify-center py-3 text-neutral-400">
              <span className="text-xs">Loading...</span>
            </div>
          )}
        </div>
    </DashboardWidget>
  )
}
