import React from 'react'
import { CircleDot, User, UserCheck, MessageSquare } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export default function IssuesSidebar({
  issues,
  issueFilter,
  setIssueFilter,
  openIssueModal,
  setCreateIssueModal,
  isWriteMode,
}) {
  const filteredIssues = issueFilter === 'all' ? issues : issues.filter(i => i.status === issueFilter)

  return (
    <Card className="flex flex-col h-[500px]">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2"><CircleDot className="w-4 h-4" />Issues ({filteredIssues.length})</CardTitle>
        <div className="flex gap-1 mt-1">
          {['open', 'closed', 'all'].map(f => (
            <button key={f} onClick={() => setIssueFilter(f)}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${issueFilter === f ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden">
        <div className="space-y-2 flex-1 overflow-y-auto">
          {filteredIssues.map((issue) => (
            <div key={issue.id}
              onClick={() => openIssueModal(issue.id)}
              className="block p-2 bg-neutral-50 dark:bg-neutral-900 rounded cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">#{issue.id}</span>
                <Badge variant={issue.status === 'open' ? 'success' : issue.status === 'closed' ? 'secondary' : 'default'} className="text-[10px] px-1.5 py-0">
                  {issue.status || 'open'}
                </Badge>
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
          {issues.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No issues</p>}
        </div>
        <Separator className="my-3 shrink-0" />
        {isWriteMode && <div className="shrink-0">
          <Button 
            onClick={() => setCreateIssueModal({ open: true, title: '', body: '', creating: false, error: null })}
            className="w-full dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-100"
          >
            Human Intervention (Create Issue)
          </Button>
        </div>}
      </CardContent>
    </Card>
  )
}
