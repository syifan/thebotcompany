import React from 'react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { Flag, GitBranch, GitPullRequest } from 'lucide-react'
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

export default function MilestoneDetailPanel({ milestoneModal, setMilestoneModal, onOpenPR }) {
  const milestone = milestoneModal.milestone

  return (
    <Panel id="milestone-detail" open={milestoneModal.open} onClose={() => setMilestoneModal({ open: false, milestone: null, requestedId: null })}>
      <PanelHeader onClose={() => setMilestoneModal({ open: false, milestone: null, requestedId: null })}>
        {milestone ? `${milestone.milestone_id} ${milestone.title || ''}`.trim() : 'Milestone'}
      </PanelHeader>
      <PanelContent>
        {!milestone && <div className="text-sm text-neutral-500">Loading milestone details...</div>}

        {milestone && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Flag className="w-4 h-4 text-neutral-500" />
              <span className="text-xs text-neutral-500">{milestone.milestone_id}</span>
              {milestone.status && <StatusPill variant={milestone.status === 'completed' ? 'success' : milestone.status === 'failed' ? 'danger' : milestone.status === 'active' ? 'warning' : 'meta'}>{milestone.status}</StatusPill>}
              {milestone.phase && <StatusPill variant="meta">{milestone.phase}</StatusPill>}
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Title</div>
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {milestone.title || milestone.description || milestone.milestone_id}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Description</div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-neutral-800 dark:text-neutral-200">
                {milestone.description?.trim() || 'No description'}
              </div>
            </div>

            <div className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-3 text-sm leading-5">
              <div className="text-neutral-500">Created</div>
              <div className="font-medium">{formatDate(milestone.created_at)}</div>

              {milestone.completed_at && (
                <>
                  <div className="text-neutral-500">Completed</div>
                  <div className="font-medium">{formatDate(milestone.completed_at)}</div>
                </>
              )}

              {milestone.parent_milestone_id && (
                <>
                  <div className="text-neutral-500">Parent</div>
                  <div className="font-medium">{milestone.parent_milestone_id}</div>
                </>
              )}

              {milestone.branch_name && (
                <>
                  <div className="text-neutral-500">Branch</div>
                  <div className="font-medium break-all inline-flex items-center gap-2"><GitBranch className="w-4 h-4 text-neutral-500" />{milestone.branch_name}</div>
                </>
              )}
            </div>

            {milestone.linked_pr_id && (
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Linked PR</div>
                <button
                  type="button"
                  onClick={() => onOpenPR?.(milestone.linked_pr_id)}
                  className="inline-flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  <GitPullRequest className="w-4 h-4" />
                  PR #{milestone.linked_pr_id}
                </button>
              </div>
            )}

            {milestone.failure_reason && (
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Failure reason</div>
                <div className="whitespace-pre-wrap text-sm leading-6 text-red-700 dark:text-red-300">
                  {milestone.failure_reason}
                </div>
              </div>
            )}
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
