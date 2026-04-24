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

function compareMilestones(a, b) {
  const aa = milestoneSortValue(a?.milestone_id)
  const bb = milestoneSortValue(b?.milestone_id)
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (aa[i] || 0) - (bb[i] || 0)
    if (diff !== 0) return diff
  }
  return String(a?.milestone_id || '').localeCompare(String(b?.milestone_id || ''))
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
    node.children.sort(compareMilestones)
    node.children.forEach(sortNode)
  }
  roots.sort(compareMilestones)
  roots.forEach(sortNode)
  return roots
}

function statusVariant(node) {
  if (node.status === 'completed') return 'success'
  if (node.status === 'failed') return 'danger'
  if (node.status === 'active') return 'warning'
  return 'meta'
}

function TreeNode({ node, currentMilestoneId, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children?.length > 0
  const isCurrent = currentMilestoneId && node.milestone_id === currentMilestoneId
  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2 ${isCurrent ? 'border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/20' : 'border-neutral-200 dark:border-neutral-800'}`}>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => hasChildren && setOpen((v) => !v)}
            className={`mt-0.5 shrink-0 ${hasChildren ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            aria-label={open ? 'Collapse milestone' : 'Expand milestone'}
          >
            {open ? <ChevronDown className="w-4 h-4 text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-500" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-neutral-600 dark:text-neutral-300">{node.milestone_id}</span>
              {node.status && <StatusPill variant={statusVariant(node)}>{node.status}</StatusPill>}
              {node.phase && <StatusPill variant="meta">{node.phase}</StatusPill>}
              {typeof node.cycles_budget === 'number' && node.cycles_budget > 0 && (
                <StatusPill variant="meta">{node.cycles_used || 0}/{node.cycles_budget} cycles</StatusPill>
              )}
              {node.linked_pr_id && <StatusPill variant="meta">PR #{node.linked_pr_id}</StatusPill>}
              {isCurrent && <StatusPill variant="info">current</StatusPill>}
            </div>
            <div className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-100 break-words">
              {node.title || node.description || node.milestone_id}
            </div>
          </div>
        </div>
      </div>
      {hasChildren && open && (
        <div className="ml-6 space-y-2 border-l border-neutral-200 dark:border-neutral-800 pl-3">
          {node.children.map((child) => (
            <TreeNode key={child.milestone_id} node={child} currentMilestoneId={currentMilestoneId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function MilestoneTreeCard({ milestones = [], currentMilestoneId = null }) {
  const tree = useMemo(() => buildTree(milestones), [milestones])
  return (
    <DashboardWidget icon={GitBranch} title={`Milestones (${milestones.length})`}>
      {tree.length === 0 ? (
        <div className="text-sm text-neutral-500">No milestone records yet.</div>
      ) : (
        <div className="space-y-3">
          {tree.map((node) => (
            <TreeNode key={node.milestone_id} node={node} currentMilestoneId={currentMilestoneId} />
          ))}
        </div>
      )}
    </DashboardWidget>
  )
}
