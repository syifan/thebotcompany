import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { History, MessageSquare, CircleDot, Pencil, CheckCircle2, GitMerge, RotateCcw } from 'lucide-react'
import ScheduleDiagram, { parseScheduleBlock, stripAllMetaBlocks, MetaBlockBadges } from '@/components/ScheduleDiagram'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const EVENT_ICONS = {
  created: CircleDot,
  updated: Pencil,
  closed: CheckCircle2,
  merged: GitMerge,
  reopened: RotateCcw,
}

function formatWhen(value) {
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

function toMillis(value) {
  const time = new Date(value || 0).getTime()
  return Number.isNaN(time) ? 0 : time
}

function EventRow({ item }) {
  const Icon = EVENT_ICONS[item.kind] || History
  return (
    <div className="flex items-start gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 px-3 py-2">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
      <div className="min-w-0 text-sm">
        <div className="text-neutral-800 dark:text-neutral-100">{item.label}</div>
        {item.meta && <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{item.meta}</div>}
      </div>
    </div>
  )
}

function CommentRow({ item }) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Avatar className="w-5 h-5">
          <AvatarFallback className="text-[9px] bg-gradient-to-br from-slate-400 to-slate-600 text-white">
            {(item.author || '?').slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{item.author || 'unknown'}</div>
        <div className="ml-auto text-xs text-neutral-500 dark:text-neutral-400">{item.meta}</div>
      </div>
      <div className="text-sm text-neutral-700 dark:text-neutral-300 prose prose-sm prose-neutral dark:prose-invert max-w-none break-words [&_code]:break-all overflow-x-auto [&_pre]:overflow-x-auto [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripAllMetaBlocks(item.body || '')}</ReactMarkdown>
        {parseScheduleBlock(item.body) && (
          <ScheduleDiagram schedule={parseScheduleBlock(item.body)} />
        )}
        <MetaBlockBadges text={item.body || ''} />
      </div>
    </div>
  )
}

export function EntityTimeline({ title = 'Activity', items = [] }) {
  if (!items.length) return null

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <History className="w-4 h-4 text-neutral-400" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{title}</h4>
      </div>
      <div className="space-y-2">
        {items.map((item, idx) => (
          item.type === 'comment'
            ? <CommentRow key={`comment-${item.id || idx}`} item={item} />
            : <EventRow key={`event-${item.kind}-${item.at || idx}`} item={item} />
        ))}
      </div>
    </div>
  )
}

export function buildIssueEvents(issue) {
  if (!issue) return []
  const events = []
  if (issue.created_at) {
    events.push({
      type: 'event',
      kind: 'created',
      at: issue.created_at,
      label: `Created by ${issue.creator || 'unknown'}`,
      meta: formatWhen(issue.created_at),
    })
  }
  if (issue.updated_at && issue.updated_at !== issue.created_at && issue.updated_by) {
    events.push({
      type: 'event',
      kind: 'updated',
      at: issue.updated_at,
      label: `Updated by ${issue.updated_by}`,
      meta: formatWhen(issue.updated_at),
    })
  }
  if (issue.closed_at) {
    events.push({
      type: 'event',
      kind: issue.status === 'open' ? 'reopened' : 'closed',
      at: issue.closed_at,
      label: issue.status === 'open'
        ? `Reopened by ${issue.updated_by || issue.closed_by || 'unknown'}`
        : `Closed by ${issue.closed_by || issue.updated_by || 'unknown'}`,
      meta: formatWhen(issue.closed_at),
    })
  }
  return events
}

export function buildPREvents(pr) {
  if (!pr) return []
  const events = []
  if (pr.created_at) {
    events.push({
      type: 'event',
      kind: 'created',
      at: pr.created_at,
      label: `Created by ${pr.actor || pr.updated_by || 'unknown'}`,
      meta: formatWhen(pr.created_at),
    })
  }
  if (pr.updated_at && pr.updated_at !== pr.created_at && pr.updated_by) {
    const kind = pr.status === 'merged' ? 'merged' : pr.status === 'closed' ? 'closed' : 'updated'
    let label = `Updated by ${pr.updated_by}`
    if (pr.status === 'merged') label = `Merged by ${pr.updated_by}`
    else if (pr.status === 'closed') label = `Closed by ${pr.updated_by}`
    else if (pr.status === 'ready_for_review') label = `Marked ready for review by ${pr.updated_by}`
    events.push({ type: 'event', kind, at: pr.updated_at, label, meta: formatWhen(pr.updated_at) })
  }
  return events
}

export function buildIssueTimeline(issue, comments = []) {
  const items = [
    ...buildIssueEvents(issue),
    ...comments.map((comment) => ({
      type: 'comment',
      id: comment.id,
      author: comment.author,
      body: comment.body,
      at: comment.created_at,
      meta: formatWhen(comment.created_at),
      kind: 'comment',
      icon: MessageSquare,
    })),
  ]
  return items.sort((a, b) => toMillis(a.at) - toMillis(b.at))
}

export function buildPRTimeline(pr) {
  return buildPREvents(pr).sort((a, b) => toMillis(a.at) - toMillis(b.at))
}
