import React, { useEffect, useState } from 'react'
import { MessageSquare, XCircle, Timer, Eye, EyeOff, Focus } from 'lucide-react'
import DashboardWidget from '@/components/ui/DashboardWidget'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import StatusPill from '@/components/ui/status-pill'
import LiveDuration from '@/components/layout/LiveDuration'
import ScheduleDiagram, { parseScheduleBlock } from '@/components/ScheduleDiagram'

function parseInlineSchedule(text) {
  if (!text) return null
  const startMarker = '<!-- SCHEDULE -->'
  const endMarker = '<!-- /SCHEDULE -->'
  const start = text.indexOf(startMarker)
  if (start === -1) return null
  const end = text.indexOf(endMarker, start + startMarker.length)
  if (end === -1) return null
  const rawText = text.slice(start + startMarker.length, end).trim()
  if (!rawText) return null
  try {
    const raw = JSON.parse(rawText)
    if (!Array.isArray(raw)) return null
    const steps = raw.map(step => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null
      if (step.delay !== undefined) {
        return Object.keys(step).length === 1 && typeof step.delay === 'number' ? { delay: step.delay } : null
      }
      if (typeof step.agent !== 'string' || !step.agent.trim()) return null
      const { agent, ...rest } = step
      if (!Object.prototype.hasOwnProperty.call(rest, 'prompt')) return null
      return { [agent]: rest }
    })
    return steps.every(Boolean) ? { _steps: steps } : null
  } catch {
    return null
  }
}

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

function formatDuration(ms) {
  if (!ms) return null
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatDateTime(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function extractStartedAt(report) {
  if (report._startTime) return report._startTime
  const match = report.body?.match(/^>\s*⏱\s*Started:\s*([^|\n]+)/m)
  return match ? match[1].trim() : report.created_at || null
}

function formatTokens(n) {
  if (!n) return null
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return `${n}`
}

const visibilityConfig = {
  full: {
    icon: Eye,
    label: 'Full',
    className: 'shrink-0 text-emerald-700 dark:text-emerald-300',
  },
  focused: {
    icon: Focus,
    label: 'Focused',
    className: 'shrink-0 text-amber-700 dark:text-amber-300',
  },
  blind: {
    icon: EyeOff,
    label: 'Blind',
    className: 'shrink-0 text-red-700 dark:text-red-300',
  },
  'write-only': {
    icon: EyeOff,
    label: 'Write-only',
    className: 'shrink-0 text-cyan-700 dark:text-cyan-300',
  },
}

export function ReportCardHeader({ report }) {
  const agent = report.agent || report.author
  const visibilityMode = (report.visibility_mode || report.visibility?.mode || 'full').toLowerCase()
  const visibilityIssues = report.visibility_issues || report.visibility?.issues || []
  const visibilityMeta = visibilityConfig[visibilityMode] || visibilityConfig.full
  const VisibilityIcon = visibilityMeta.icon
  const visibilityTitle = visibilityMode === 'focused' && visibilityIssues.length
    ? `Visibility: focused (#${visibilityIssues.join(', #')})`
    : `Visibility: ${visibilityMode}`
  const startedAt = extractStartedAt(report)

  return (
    <div className="mb-0.5">
      <div className="flex items-start gap-2">
        <Avatar className="w-5 h-5 mt-0.5">
          <AvatarFallback className={`text-white text-[9px] ${
            report._live
              ? 'bg-gradient-to-br from-green-400 to-emerald-500'
              : report.success === 0 || report.timed_out === 1
                ? 'bg-gradient-to-br from-red-400 to-red-600'
                : 'bg-gradient-to-br from-blue-400 to-purple-500'
          }`}>
            {agent.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-neutral-800 dark:text-neutral-100 capitalize truncate">{agent}</span>
              {!report._live && report.success === 0 && <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
              {!report._live && report.timed_out === 1 && <Timer className="w-3 h-3 text-orange-500 shrink-0" title="Timed out" />}
              {report._live && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />}
            </div>
            <div className="ml-auto text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap flex items-center gap-1.5">
              {startedAt && <span>{formatDateTime(startedAt)}</span>}
              {(startedAt && (report._live || report.duration_ms != null)) && <span>·</span>}
              {report._live && report._startTime != null ? <LiveDuration startTime={report._startTime} /> : report.duration_ms != null && <span>{formatDuration(report.duration_ms)}</span>}
            </div>
          </div>

          <div className="text-[10px] text-neutral-400 dark:text-neutral-500 leading-relaxed flex flex-wrap gap-x-2">
            {report.input_tokens > 0 && <span>{formatTokens(report.input_tokens)} new</span>}
            {report.cache_read_tokens > 0 && <span>{formatTokens(report.cache_read_tokens)} cached</span>}
            {report.output_tokens > 0 && <span>{formatTokens(report.output_tokens)} out</span>}
            {report.cost != null && <span>${report.cost.toFixed(2)}</span>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-neutral-500 dark:text-neutral-400">
            {report.model && <StatusPill variant="meta" className="shrink-0 normal-case">{report.model}</StatusPill>}
            {report.key_id && <StatusPill variant="meta" className="shrink-0 normal-case text-neutral-400" title={report.key_id}>🔑 {report.key_label || report.key_id.slice(0, 8)}</StatusPill>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusPill variant="meta" className={`shrink-0 normal-case ${visibilityMeta.className || ''}`} title={visibilityTitle}>
              <VisibilityIcon className="w-2.5 h-2.5 mr-0.5" />
              {visibilityMeta.label}
            </StatusPill>
          </div>
        </div>
      </div>
    </div>
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
    <DashboardWidget
      icon={MessageSquare}
      title="Agent Reports"
      headerRight={<span className="text-sm font-normal text-neutral-500 dark:text-neutral-400">{comments.length} loaded</span>}
    >
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
                <ReportCardHeader report={{
                  agent: liveAgentLog.agent,
                  model: liveAgentLog.model,
                  key_id: liveAgentLog.keyId || null,
                  key_label: liveAgentLog.keyLabel || null,
                  visibility: liveAgentLog.visibility || { mode: 'full', issues: [] },
                  duration_ms: liveAgentLog.startTime || null,
                  _startTime: liveAgentLog.startTime || null,
                  cost: liveAgentLog.cost || null,
                  input_tokens: liveAgentLog.usage?.inputTokens || null,
                  output_tokens: liveAgentLog.usage?.outputTokens || null,
                  cache_read_tokens: liveAgentLog.usage?.cacheReadTokens || null,
                  success: 1,
                  _live: true,
                }} />
                <div className="text-xs text-neutral-500 dark:text-neutral-400 break-words leading-relaxed pl-7 italic">
                  Running... ({liveAgentLog.log.length} log entries)
                </div>
              </div>
              {comments.length > 0 && <Separator className="my-1" />}
            </>
          )}
          {comments.length === 0 && !commentsLoading && !liveAgentLog && <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-4">No reports</p>}
          {comments.map((comment) => {
            const schedule = parseScheduleBlock(comment.body) || parseInlineSchedule(comment.body)
            return (
            <div
              key={comment.id}
              className="py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors -mx-1 px-1 rounded"
              onClick={() => { setFocusedReportId(comment.id); setReportsPanelOpen(true); }}
            >
              <ReportCardHeader report={comment} />
              <div className="text-xs text-neutral-500 dark:text-neutral-400 break-words leading-relaxed pl-7">
                <ReportSummary reportId={comment.id} projectId={selectedProject?.id} summary={comment.summary} />
                {schedule && (
                  <div className="mt-2 max-w-full overflow-hidden">
                    <ScheduleDiagram schedule={schedule} />
                  </div>
                )}
              </div>
            </div>
          )})}
          {commentsLoading && (
            <div className="flex items-center justify-center py-3 text-neutral-400">
              <span className="text-xs">Loading...</span>
            </div>
          )}
        </div>
    </DashboardWidget>
  )
}
