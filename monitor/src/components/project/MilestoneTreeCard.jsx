import React, { useMemo, useState } from 'react'
import { GitBranch, ChevronRight, ChevronDown } from 'lucide-react'
import DashboardWidget from '@/components/ui/DashboardWidget'
import StatusPill from '@/components/ui/status-pill'

function milestoneSortValue(id = '') {
  return String(id)
    .replace(/^M/i, '')
    .split('.')
    .map((part) => Number(part) || 0)
}

function compareMilestonesAsc(a, b) {
  const aa = milestoneSortValue(a?.milestone_id)
  const bb = milestoneSortValue(b?.milestone_id)
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (aa[i] || 0) - (bb[i] || 0)
    if (diff !== 0) return diff
  }
  return String(a?.milestone_id || '').localeCompare(String(b?.milestone_id || ''))
}

function compareMilestonesDesc(a, b) {
  return compareMilestonesAsc(b, a)
}

function buildTree(milestones = []) {
  const byId = new Map()
  const roots = []
  milestones.forEach((m) => byId.set(m.milestone_id, { ...m, children: [] }))
  byId.forEach((node) => {
    const parentId = node.parent_milestone_id
    const parent = parentId ? byId.get(parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  const sortNode = (node) => {
    node.children.sort(compareMilestonesDesc)
    node.children.forEach(sortNode)
  }
  roots.sort(compareMilestonesDesc)
  roots.forEach(sortNode)
  return roots
}

function statusVariant(node) {
  if (node.status === 'completed') return 'success'
  if (node.status === 'failed') return 'danger'
  if (node.status === 'active') return 'warning'
  return 'meta'
}

function TreeNode({ node, currentMilestoneId, onMilestoneClick, onPrClick, depth = 0 }) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children?.length > 0
  const isCurrent = currentMilestoneId && node.milestone_id === currentMilestoneId

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onMilestoneClick?.(node.milestone_id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onMilestoneClick?.(node.milestone_id)
          }
        }}
        className={`block w-full rounded-lg border px-1.5 py-2 text-left cursor-pointer ${isCurrent ? 'border-blue-300/70 dark:border-blue-700/70' : 'border-neutral-200 dark:border-neutral-800'}`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="font-mono text-xs text-neutral-600 dark:text-neutral-300">{node.milestone_id}</span>
                {node.status && node.status !== 'active' && !isCurrent && <StatusPill variant={statusVariant(node)}>{node.status}</StatusPill>}
                {node.phase && <StatusPill variant="meta">{node.phase}</StatusPill>}
                {node.linked_pr_id && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onPrClick?.(node.linked_pr_id)
                    }}
                    className="inline-flex"
                  >
                    <StatusPill variant="meta">PR #{node.linked_pr_id}</StatusPill>
                  </button>
                )}
              </div>
              {hasChildren && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpen((v) => !v)
                  }}
                  className="inline-flex shrink-0 items-center justify-center rounded border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  aria-label={open ? 'Collapse milestone' : 'Expand milestone'}
                  title={open ? 'Collapse' : 'Expand'}
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
            <div className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-100 break-words">
              {node.title || node.description || node.milestone_id}
            </div>
          </div>
        </div>
      </div>
      {hasChildren && open && (
        <div className="ml-4 space-y-2 border-l border-neutral-200 pl-2.5 dark:border-neutral-800">
          {node.children.map((child) => (
            <TreeNode key={child.milestone_id} node={child} currentMilestoneId={currentMilestoneId} onMilestoneClick={onMilestoneClick} onPrClick={onPrClick} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function MilestoneTreeCard({ milestones = [], currentMilestoneId = null, onMilestoneClick, onPrClick }) {
  const tree = useMemo(() => buildTree(milestones), [milestones])

  return (
    <DashboardWidget icon={GitBranch} title={`Milestones (${milestones.length})`}>
      {tree.length === 0 ? (
        <div className="text-sm text-neutral-500">No milestone records yet.</div>
      ) : (
        <div className="space-y-3">
          {tree.map((node) => (
            <TreeNode key={node.milestone_id} node={node} currentMilestoneId={currentMilestoneId} onMilestoneClick={onMilestoneClick} onPrClick={onPrClick} />
          ))}
        </div>
      )}
    </DashboardWidget>
  )
}
