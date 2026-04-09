import React from 'react'
import { CircleDot, User, UserCheck, MessageSquare } from 'lucide-react'
import DashboardWidget from '@/components/ui/DashboardWidget'
import SegmentedControl from '@/components/ui/segmented-control'
import StatusPill from '@/components/ui/status-pill'

export default function IssuesSidebar({
  issues,
  issueFilter,
  setIssueFilter,
  openIssueModal,
}) {
  // Only non-human issues: neither creator nor assignee is human
  const agentIssues = issues.filter(i =>
    i.creator !== 'human' && i.creator !== 'chat' && i.assignee !== 'human'
  )
  const filteredIssues = issueFilter === 'all' ? agentIssues : agentIssues.filter(i => i.status === issueFilter)

  return (
    <DashboardWidget
      icon={CircleDot}
      title={`Agent Issues (${filteredIssues.length})`}
      headerExtra={
        <SegmentedControl
          value={issueFilter}
          onChange={setIssueFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
      }
    >
        <div className="space-y-2 flex-1 overflow-y-auto">
          {filteredIssues.map((issue) => (
            <div key={issue.id}
              onClick={() => openIssueModal(issue.id)}
              className="block p-2 bg-neutral-50 dark:bg-neutral-900 rounded cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">#{issue.id}</span>
                <StatusPill variant={issue.status === 'open' ? 'open' : 'closed'}>
                  {issue.status || 'open'}
                </StatusPill>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{issue.title}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {issue.creator && <span className="flex items-center gap-1"><User className="w-3 h-3" />{issue.creator}</span>}
                {issue.assignee && <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><UserCheck className="w-3 h-3" />{issue.assignee}</span>}
                {issue.comment_count > 0 && <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{issue.comment_count}</span>}
                {issue.labels && <span className="text-purple-500 dark:text-purple-400">{issue.labels}</span>}
              </div>
            </div>
          ))}
          {filteredIssues.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No agent issues</p>}
        </div>
    </DashboardWidget>
  )
}
