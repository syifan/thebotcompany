import React, { useState } from 'react'
import { AlertTriangle, User, UserCheck, MessageSquare, ArrowUp, ArrowDown } from 'lucide-react'
import DashboardWidget from '@/components/ui/DashboardWidget'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import SegmentedControl from '@/components/ui/segmented-control'
import StatusPill from '@/components/ui/status-pill'

export default function HumanInterventionCard({
  issues,
  openIssueModal,
  setCreateIssueModal,
  isWriteMode,
}) {
  const [filter, setFilter] = useState('open')

  // Human intervention issues: created by human OR assigned to human
  const humanIssues = issues.filter(i =>
    i.creator === 'human' || i.assignee === 'human' || i.creator === 'chat'
  )
  const filtered = filter === 'all' ? humanIssues : humanIssues.filter(i => i.status === filter)
  const openCount = humanIssues.filter(i => i.status === 'open').length

  // Split into: from human (human created) and to human (assigned to human)
  const fromHuman = filtered.filter(i => i.creator === 'human' || i.creator === 'chat')
  const toHuman = filtered.filter(i => i.assignee === 'human' && i.creator !== 'human' && i.creator !== 'chat')

  return (
    <DashboardWidget
      icon={AlertTriangle}
      title="Intervention"
      badge={openCount > 0 && (
        <StatusPill variant="danger">
          {openCount}
        </StatusPill>
      )}
      headerExtra={
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
      }
      footer={isWriteMode && (
        <>
          <Separator className="mx-6 mb-2 shrink-0" />
          <div className="px-6 pb-6 shrink-0">
            <Button
              onClick={() => setCreateIssueModal({ open: true, title: '', body: '', creating: false, error: null })}
              size="sm"
              className="w-full dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-100"
            >
              New Intervention
            </Button>
          </div>
        </>
      )}
    >
        <div className="space-y-3">
          {/* Needs your attention — agents asking for help */}
          {toHuman.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ArrowDown className="w-3 h-3 text-red-500" />
                <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Needs Your Attention</span>
              </div>
              {toHuman.map(issue => (
                <IssueRow key={issue.id} issue={issue} openIssueModal={openIssueModal} />
              ))}
            </div>
          )}

          {/* Your requests — human asking agents */}
          {fromHuman.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ArrowUp className="w-3 h-3 text-blue-500" />
                <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Your Requests</span>
              </div>
              {fromHuman.map(issue => (
                <IssueRow key={issue.id} issue={issue} openIssueModal={openIssueModal} />
              ))}
            </div>
          )}

          {filtered.length === 0 && (
            <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-4">
              No {filter === 'all' ? '' : filter} human intervention issues
            </p>
          )}
        </div>

    </DashboardWidget>
  )
}

function IssueRow({ issue, openIssueModal }) {
  return (
    <div
      onClick={() => openIssueModal(issue.id)}
      className="block p-2 bg-neutral-50 dark:bg-neutral-900 rounded cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors mb-1"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">#{issue.id}</span>
        <StatusPill variant={issue.status === 'open' ? 'open' : 'closed'}>
          {issue.status || 'open'}
        </StatusPill>
        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{issue.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {issue.creator && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />{issue.creator}
          </span>
        )}
        {issue.assignee && (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <UserCheck className="w-3 h-3" />{issue.assignee}
          </span>
        )}
        {issue.comment_count > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />{issue.comment_count}
          </span>
        )}
      </div>
    </div>
  )
}
