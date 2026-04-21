import React from 'react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { GitPullRequest, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import StatusPill from '@/components/ui/status-pill'
import { EntityTimeline, buildPRTimeline } from '@/components/ui/entity-event-list'

function formatDate(value) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function PRDetailPanel({ prModal, setPrModal, submitPRComment }) {
  const pr = prModal.pr
  const branchLabel = pr && pr.baseRefName === pr.headRefName
    ? pr.baseRefName
    : `${pr?.baseRefName} ← ${pr?.headRefName}`

  const closePanel = () => setPrModal({ open: false, pr: null, comments: [], newComment: '', commenting: false, loading: false, error: null })

  return (
    <Panel id="pr-detail" open={prModal.open} onClose={closePanel}>
      <PanelHeader onClose={closePanel}>
        {pr ? `#${pr.number} ${pr.title}` : 'PR'}
      </PanelHeader>
      <PanelContent>
        {prModal.loading && <div className="text-sm text-neutral-500">Loading PR details...</div>}
        {prModal.error && <div className="text-sm text-red-500">{prModal.error}</div>}

        {!prModal.loading && !prModal.error && pr && (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <GitPullRequest className="w-4 h-4 text-neutral-500" />
                <span className="text-xs text-neutral-500">PR #{pr.number}</span>
                {pr.status && <StatusPill variant={pr.status === 'open' ? 'open' : pr.status === 'merged' ? 'merged' : 'closed'}>{pr.status}</StatusPill>}
                {pr.test_status && <StatusPill variant="meta">Tests: {pr.test_status}</StatusPill>}
                {pr.issueIds?.map(id => (
                  <StatusPill key={id} variant="meta">#{id}</StatusPill>
                ))}
              </div>

              {pr.github_pr_url && (
                <a
                  href={pr.github_pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white"
                >
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  Open on GitHub
                </a>
              )}
            </div>

            <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-3 text-sm leading-5">
              <div className="text-neutral-500">Branch</div>
              <div className="font-medium break-all">{branchLabel}</div>

              <div className="text-neutral-500">Created</div>
              <div className="font-medium">{formatDate(pr.created_at)}</div>

              <div className="text-neutral-500">Updated</div>
              <div className="font-medium">{formatDate(pr.updated_at)}</div>
            </div>

            <EntityTimeline title="PR activity" items={buildPRTimeline(pr, prModal.comments || pr.comments || [])} />

            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Summary</div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-neutral-800 dark:text-neutral-200">
                {pr.summary?.trim() || 'No summary'}
              </div>
            </div>

            <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-800 pt-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Add comment</div>
              <textarea
                value={prModal.newComment || ''}
                onChange={(e) => setPrModal(prev => ({ ...prev, newComment: e.target.value }))}
                rows={4}
                placeholder="Add a PR comment"
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={submitPRComment} disabled={prModal.commenting || !prModal.newComment?.trim()}>
                  {prModal.commenting ? 'Posting...' : 'Post comment'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
