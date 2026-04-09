import React from 'react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { GitPullRequest, ExternalLink } from 'lucide-react'
import StatusPill from '@/components/ui/status-pill'

function formatDate(value) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function PRDetailPanel({ prModal, setPrModal }) {
  const pr = prModal.pr
  const branchLabel = pr && pr.baseRefName === pr.headRefName
    ? pr.baseRefName
    : `${pr?.baseRefName} ← ${pr?.headRefName}`

  return (
    <Panel id="pr-detail" open={prModal.open} onClose={() => setPrModal({ open: false, pr: null, loading: false, error: null })}>
      <PanelHeader onClose={() => setPrModal({ open: false, pr: null, loading: false, error: null })}>
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

            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Summary</div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-neutral-800 dark:text-neutral-200">
                {pr.summary?.trim() || 'No summary'}
              </div>
            </div>
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
