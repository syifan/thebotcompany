import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import StatusPill from '@/components/ui/status-pill'
import { RefreshCw, Clock, User, UserCheck } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import ReactMarkdown from 'react-markdown'
import ScheduleDiagram, { parseScheduleBlock, stripAllMetaBlocks, MetaBlockBadges } from '@/components/ScheduleDiagram'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export default function IssueDetailPanel({
  issueModal,
  setIssueModal,
  isWriteMode,
  authFetch,
  projectApi,
  submitIssueComment,
  modKey,
}) {
  return (
    <Panel id="issue-detail" open={issueModal.open} onClose={() => setIssueModal({ ...issueModal, open: false })}>
      <PanelHeader onClose={() => setIssueModal({ ...issueModal, open: false })}>
        {issueModal.issue ? `#${issueModal.issue.id} ${issueModal.issue.title}` : 'Issue'}
      </PanelHeader>
      <PanelContent>
        {issueModal.loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : issueModal.issue ? (
          <div className="space-y-5">
            {/* Header meta row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <StatusPill variant={issueModal.issue.status === 'open' ? 'open' : 'closed'}>{issueModal.issue.status || 'open'}</StatusPill>
                {issueModal.issue.labels && issueModal.issue.labels.split(',').map(l => l.trim()).filter(Boolean).map(label => (
                  <StatusPill key={label} variant="meta">{label}</StatusPill>
                ))}
              </div>
              {isWriteMode && (
                <Button
                  variant={issueModal.issue.status === 'open' ? 'outline' : 'default'}
                  size="sm"
                  className={`text-xs shrink-0 ${issueModal.issue.status === 'open' ? 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950' : 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950'}`}
                  onClick={async () => {
                    const newStatus = issueModal.issue.status === 'open' ? 'closed' : 'open'
                    try {
                      await authFetch(projectApi(`/issues/${issueModal.issue.id}`), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus })
                      })
                      setIssueModal(prev => ({ ...prev, issue: { ...prev.issue, status: newStatus } }))
                    } catch {}
                  }}
                >{issueModal.issue.status === 'open' ? '✕ Close Issue' : '↻ Reopen Issue'}</Button>
              )}
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              {issueModal.issue.creator && (
                <>
                  <span className="text-neutral-400 dark:text-neutral-500">Created by</span>
                  <span className="flex items-center gap-1 text-neutral-700 dark:text-neutral-200"><User className="w-3 h-3" />{issueModal.issue.creator}</span>
                </>
              )}
              {issueModal.issue.assignee && (
                <>
                  <span className="text-neutral-400 dark:text-neutral-500">Assigned to</span>
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><UserCheck className="w-3 h-3" />{issueModal.issue.assignee}</span>
                </>
              )}
              <span className="text-neutral-400 dark:text-neutral-500">Created</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(issueModal.issue.created_at).toLocaleString()}</span>
              {issueModal.issue.closed_at && (
                <>
                  <span className="text-neutral-400 dark:text-neutral-500">Closed</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(issueModal.issue.closed_at).toLocaleString()}</span>
                </>
              )}
            </div>

            {/* Body */}
            {issueModal.issue.body && (
              <>
                <Separator />
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{issueModal.issue.body}</ReactMarkdown>
                </div>
              </>
            )}

            {/* Comments */}
            {issueModal.comments.length > 0 && (
              <>
                <Separator />
                <h3 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300 flex items-center gap-2">
                  <span>Comments</span>
                  <StatusPill variant="meta" className="font-normal normal-case">{issueModal.comments.length}</StatusPill>
                </h3>
                <div className="space-y-3">
                  {issueModal.comments.map((comment) => (
                    <div key={comment.id} className="border-b border-neutral-200 dark:border-neutral-700 pb-3 last:border-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar className="w-6 h-6">
                          <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-xs">
                            {(comment.author || '??').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{comment.author}</span>
                        <span className="text-xs text-neutral-400 dark:text-neutral-500 ml-auto">{new Date(comment.created_at).toLocaleString()}</span>
                      </div>
                      <div className="text-sm text-neutral-700 dark:text-neutral-300 prose prose-sm prose-neutral dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripAllMetaBlocks(comment.body)}</ReactMarkdown>
                        {parseScheduleBlock(comment.body) && (
                          <ScheduleDiagram schedule={parseScheduleBlock(comment.body)} />
                        )}
                        <MetaBlockBadges text={comment.body} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Add Comment */}
            {isWriteMode && <>
            <Separator />
            <div className="space-y-2">
              <textarea
                className="w-full text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400"
                rows={3}
                placeholder="Add a comment..."
                value={issueModal.newComment || ''}
                onChange={(e) => setIssueModal(prev => ({ ...prev, newComment: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submitIssueComment()
                  }
                }}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!issueModal.newComment?.trim() || issueModal.commenting}
                  onClick={submitIssueComment}
                >
                  {issueModal.commenting ? 'Posting...' : `Post (${modKey}+↵)`}
                </Button>
              </div>
            </div>
            </>}
          </div>
        ) : (
          <p className="text-neutral-400 dark:text-neutral-500 text-center py-8">Failed to load issue</p>
        )}
      </PanelContent>
    </Panel>
  )
}
