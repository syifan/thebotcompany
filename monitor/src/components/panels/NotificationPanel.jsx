import React from 'react'
import { BellOff } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { timeAgo } from '@/utils'
import { useNotifications } from '@/contexts/NotificationContext'

function NotifItem({ n, expandedNotifs, toggleNotifExpand, markRead }) {
  const expanded = expandedNotifs.has(n.id)
  const typeIcons = { milestone: '📌', verified: '✅', 'verify-fail': '❌', phase: '🔄', error: '⚠️', 'agent-done': n.message?.startsWith('✗') ? '✗' : '✓', 'project-complete': '🏁' }
  const icon = typeIcons[n.type] || '📋'
  const isLong = n.message && n.message.length > 120
  const displayMsg = isLong && !expanded ? n.message.slice(0, 120) + '…' : n.message

  const agentMatch = n.type === 'agent-done' && n.message?.match(/^[✓✗]\s+(\S+?):\s(.+)$/s)
  const agentName = agentMatch ? agentMatch[1] : null
  const agentMsg = agentMatch ? agentMatch[2] : displayMsg

  return (
    <div
      className={`p-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${!n.read ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''}`}
      onClick={() => { markRead(n.id); if (isLong) toggleNotifExpand(n.id) }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-base shrink-0 w-5 text-center">{!n.read ? <span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> : <span className="opacity-60">{icon}</span>}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {agentName && <span className={`text-sm font-semibold ${!n.read ? 'text-neutral-800 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-300'}`}>{agentName}</span>}
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{n.project}</span>
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 ml-auto shrink-0">{timeAgo(n.timestamp)}</span>
          </div>
          <div className={`text-sm mt-0.5 leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 ${!n.read ? 'text-neutral-700 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {agentName ? (isLong && !expanded ? agentMsg.slice(0, 120) + '…' : agentMsg) : displayMsg}
            </ReactMarkdown>
          </div>
          {isLong && (
            <button className="text-xs text-blue-500 mt-1" onClick={(e) => { e.stopPropagation(); toggleNotifExpand(n.id) }}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function NotificationPanel({
  open,
  onClose,
}) {
  const { notifList, unreadCount, markAllRead, markRead, expandedNotifs, toggleNotifExpand } = useNotifications()

  return (
    <Panel id="notifications" open={open} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <div className="flex items-center justify-between w-full">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs text-blue-500 hover:text-blue-700">
              Mark all read
            </button>
          )}
        </div>
      </PanelHeader>
      <PanelContent>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {notifList.length === 0 ? (
            <div className="p-8 text-center text-neutral-400 dark:text-neutral-500">
              <BellOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No notifications yet</p>
            </div>
          ) : notifList.map(n => (
            <NotifItem
              key={n.id}
              n={n}
              expandedNotifs={expandedNotifs}
              toggleNotifExpand={toggleNotifExpand}
              markRead={markRead}
            />
          ))}
        </div>
      </PanelContent>
    </Panel>
  )
}
