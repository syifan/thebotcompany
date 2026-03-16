import React, { useRef, useCallback, useEffect } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ScheduleDiagram, { parseScheduleBlock, stripAllMetaBlocks, parseTimingBlock, MetaBlockBadges } from '@/components/ScheduleDiagram'
import LiveDuration from '@/components/layout/LiveDuration'

// Lazy report summary component — triggers summarization on first render if missing
const summaryCache = new Map() // reportId -> summary string | 'loading' | 'error'

function ReportSummary({ reportId, projectId, summary: initialSummary, className }) {
  const [summary, setSummary] = React.useState(initialSummary || summaryCache.get(reportId) || null)
  const [loading, setLoading] = React.useState(false)

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

export default function ReportsPanel({
  open,
  onClose,
  comments,
  commentsLoading,
  loadMoreComments,
  liveAgentLog,
  focusedReportId,
  setFocusedReportId,
  selectedAgent,
  clearAgentFilter,
  selectedProject,
}) {
  const liveLogRef = useRef(null)
  const liveLogAtBottomRef = useRef(true)
  const reportsScrollRef = useRef(null)

  const onLiveLogScroll = useCallback((e) => {
    const el = e.currentTarget
    liveLogAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  useEffect(() => {
    if (liveLogRef.current && liveLogAtBottomRef.current) {
      liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight
    }
  }, [liveAgentLog])

  return (
    <Panel id="reports" open={open} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          Agent Reports
          {selectedAgent && (
            <Badge variant="secondary" className="ml-2 capitalize">
              {selectedAgent}
              <button onClick={clearAgentFilter} className="ml-1 hover:text-red-500"><X className="w-3 h-3" /></button>
            </Badge>
          )}
          <span className="text-sm font-normal text-neutral-400 ml-auto">{comments.length} loaded</span>
        </span>
      </PanelHeader>
      <PanelContent onScroll={(e) => {
          const { scrollTop, scrollHeight, clientHeight } = e.target
          if (scrollHeight - scrollTop - clientHeight < 100) loadMoreComments()
        }}>
        <div ref={reportsScrollRef}>
          {liveAgentLog && (
            <>
              <div data-report-id="live">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Avatar className="w-6 h-6 sm:w-8 sm:h-8">
                    <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-xs">
                      {liveAgentLog.agent.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{liveAgentLog.agent}</span>
                  <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Running
                  </span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    <LiveDuration startTime={liveAgentLog.startTime} />
                  </span>
                  {liveAgentLog.model && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{liveAgentLog.model}</Badge>}
                </div>
                <div
                  ref={(el) => { liveLogRef.current = el; if (el && liveLogAtBottomRef.current) el.scrollTop = el.scrollHeight }}
                  onScroll={onLiveLogScroll}
                  className="max-h-[400px] overflow-y-auto rounded bg-neutral-50 dark:bg-neutral-900/50 p-2 text-xs font-mono space-y-0.5 mt-1"
                >
                  {liveAgentLog.log.length === 0 && <p className="text-neutral-400 italic">Waiting for output...</p>}
                  {liveAgentLog.log.map((entry, i) => (
                    <div key={i} className={`leading-relaxed break-words whitespace-pre-wrap ${entry.msg.startsWith('Tool:') ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-600 dark:text-neutral-300'}`}>
                      <span className="text-neutral-400 dark:text-neutral-500 mr-1.5">{new Date(entry.time).toLocaleTimeString()}</span>
                      {entry.msg}
                    </div>
                  ))}
                </div>
              </div>
              <Separator className="my-4" />
            </>
          )}
          {comments.length === 0 && !commentsLoading && !liveAgentLog && <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-8">No reports found</p>}
          {comments.map((comment, idx) => (
            <div key={comment.id} data-report-id={comment.id}>
              {idx > 0 && <Separator className="my-4" />}
              <div className={`rounded-lg transition-colors duration-700 ${focusedReportId === comment.id ? 'bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-300 dark:ring-blue-700 p-2 -m-2' : ''}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Avatar className="w-6 h-6 sm:w-8 sm:h-8">
                    <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-xs">
                      {(comment.agent || comment.author).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{comment.agent || comment.author}</span>
                  {(() => { const t = parseTimingBlock(comment.body); return t ? (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5">
                      <span>{t.ended}</span>
                      <span className="text-neutral-300 dark:text-neutral-600">·</span>
                      <span>{t.duration}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">{new Date(comment.created_at).toLocaleString()}</span>
                  ); })()}
                </div>
                <ReportSummary reportId={comment.id} projectId={selectedProject?.id} summary={comment.summary} className="text-xs text-neutral-500 dark:text-neutral-400 italic block mb-1" />
                <div className="text-sm text-neutral-700 dark:text-neutral-300 prose prose-sm prose-neutral dark:prose-invert max-w-none break-words [&_code]:break-all overflow-x-auto [&_table]:text-xs [&_pre]:overflow-x-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripAllMetaBlocks(comment.body)}</ReactMarkdown>
                  {parseScheduleBlock(comment.body) && (
                    <ScheduleDiagram schedule={parseScheduleBlock(comment.body)} />
                  )}
                  <MetaBlockBadges text={comment.body} />
                </div>
              </div>
            </div>
          ))}
          {commentsLoading && (
            <div className="flex items-center justify-center py-4 gap-2 text-neutral-400 dark:text-neutral-500">
              <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading...</span>
            </div>
          )}
        </div>
      </PanelContent>
    </Panel>
  )
}
