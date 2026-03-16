import React, { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { parseTimingBlock } from '@/components/ScheduleDiagram'
import LiveDuration from '@/components/layout/LiveDuration'

// Lazy report summary — triggers summarization on first render if missing
const summaryCache = new Map()

function ReportSummary({ reportId, projectId, summary: initialSummary, className }) {
  const [summary, setSummary] = useState(initialSummary || summaryCache.get(reportId) || null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (summary || loading || summaryCache.get(reportId) === 'loading') return
    if (summaryCache.get(reportId) === 'error') return
    const cached = summaryCache.get(reportId)
    if (cached && cached !== 'loading' && cached !== 'error') { setSummary(cached); return }

    summaryCache.set(reportId, 'loading')
    setLoading(true)
    fetch(`/api/projects/${projectId}/reports/${reportId}/summarize`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.summary) {
          summaryCache.set(reportId, data.summary)
          setSummary(data.summary)
        } else {
          summaryCache.set(reportId, 'error')
        }
      })
      .catch(() => summaryCache.set(reportId, 'error'))
      .finally(() => setLoading(false))
  }, [reportId, projectId, summary, loading])

  if (!summary && !loading) return null
  return (
    <span className={className || "text-xs text-neutral-500 dark:text-neutral-400 italic"}>
      {loading ? '…' : summary}
    </span>
  )
}

export default function AgentReportsCard({
  comments,
  commentsLoading,
  loadMoreComments,
  liveAgentLog,
  selectedProject,
  setFocusedReportId,
  setReportsPanelOpen,
}) {
  return (
    <Card className="h-[500px]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" />Agent Reports</span>
          <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400">{comments.length} loaded</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 overflow-hidden">
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800 overflow-y-auto overflow-x-hidden h-full" onScroll={(e) => {
          const { scrollTop, scrollHeight, clientHeight } = e.target
          if (scrollHeight - scrollTop - clientHeight < 100) loadMoreComments()
        }}>
          {liveAgentLog && (
            <>
              <div
                className="py-2.5 bg-blue-50 dark:bg-blue-900/20 cursor-pointer transition-colors -mx-1 px-2 rounded"
                onClick={() => { setFocusedReportId('live'); setReportsPanelOpen(true); }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <Avatar className="w-5 h-5">
                    <AvatarFallback className="bg-gradient-to-br from-green-400 to-emerald-500 text-white text-[9px]">
                      {liveAgentLog.agent.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{liveAgentLog.agent}</span>
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 ml-auto whitespace-nowrap flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <LiveDuration startTime={liveAgentLog.startTime} />
                    {liveAgentLog.model && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{liveAgentLog.model}</Badge>}
                  </span>
                </div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 break-words leading-relaxed pl-7 italic">
                  Running... ({liveAgentLog.log.length} log entries)
                </div>
              </div>
              {comments.length > 0 && <Separator className="my-1" />}
            </>
          )}
          {comments.length === 0 && !commentsLoading && !liveAgentLog && <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-4">No reports</p>}
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors -mx-1 px-1 rounded"
              onClick={() => { setFocusedReportId(comment.id); setReportsPanelOpen(true); }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Avatar className="w-5 h-5">
                  <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-[9px]">
                    {(comment.agent || comment.author).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{comment.agent || comment.author}</span>
                {(() => { const t = parseTimingBlock(comment.body); return t ? (
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 ml-auto whitespace-nowrap flex items-center gap-1">
                    <span>{t.ended}</span>
                    <span className="text-neutral-300 dark:text-neutral-600">·</span>
                    <span>{t.duration}</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 ml-auto whitespace-nowrap">{new Date(comment.created_at).toLocaleString()}</span>
                ); })()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 break-words leading-relaxed pl-7">
                <ReportSummary reportId={comment.id} projectId={selectedProject?.id} summary={comment.summary} />
              </div>
            </div>
          ))}
          {commentsLoading && (
            <div className="flex items-center justify-center py-3 text-neutral-400">
              <span className="text-xs">Loading...</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
