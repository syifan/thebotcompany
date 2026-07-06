import React, { useState, useEffect, useCallback } from 'react'
import { Hammer, ChevronDown, ChevronRight } from 'lucide-react'
import DashboardWidget from '@/components/ui/DashboardWidget'
import StatusPill from '@/components/ui/status-pill'

const STATUS_VARIANT = {
  running: 'open',
  succeeded: 'merged',
  failed: 'closed',
  timeout: 'closed',
  killed: 'closed',
}

function runtimeLabel(job) {
  const end = job.finished_at ? Date.parse(job.finished_at) : Date.now()
  const minutes = Math.max(0, Math.round((end - Date.parse(job.created_at)) / 60000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function JobRow({ job, projectId }) {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/jobs/${encodeURIComponent(job.name)}/log?lines=30`)
      .then(res => res.json())
      .then(data => { if (!cancelled) setLog(data.log || '(no log)') })
      .catch(() => { if (!cancelled) setLog('(failed to load log)') })
    return () => { cancelled = true }
  }, [open, projectId, job.name, job.status])

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="block p-2 bg-neutral-50 dark:bg-neutral-900 rounded">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left cursor-pointer"
      >
        <Chevron className="w-3 h-3 text-neutral-400 shrink-0" />
        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{job.name}</span>
        <StatusPill variant={STATUS_VARIANT[job.status] || 'meta'}>{job.status}</StatusPill>
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 ml-5 text-xs text-neutral-500 dark:text-neutral-400">
        <span>{runtimeLabel(job)}</span>
        {job.exit_code !== null && job.exit_code !== undefined && <span>exit {job.exit_code}</span>}
        {job.submitted_by && <span>by {job.submitted_by}</span>}
        <span>timeout {job.timeout_min}m</span>
      </div>
      {open && (
        <div className="mt-2 ml-5">
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 break-all">$ {job.command}</div>
          <pre className="text-[11px] leading-4 p-2 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
            {log ?? 'Loading log…'}
          </pre>
        </div>
      )}
    </div>
  )
}

export default function JobsCard({ selectedProject }) {
  const [jobs, setJobs] = useState([])
  const projectId = selectedProject?.id

  const refresh = useCallback(() => {
    if (!projectId) return
    fetch(`/api/projects/${projectId}/jobs`)
      .then(res => res.json())
      .then(data => setJobs(Array.isArray(data.jobs) ? data.jobs : []))
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 15000)
    return () => clearInterval(interval)
  }, [refresh])

  const runningCount = jobs.filter(job => job.status === 'running').length

  return (
    <DashboardWidget
      icon={Hammer}
      title={`Jobs (${jobs.length})`}
      badge={runningCount > 0 && (
        <StatusPill variant="open">{runningCount} running</StatusPill>
      )}
    >
      <div className="space-y-2">
        {jobs.map(job => (
          <JobRow key={job.name} job={job} projectId={projectId} />
        ))}
        {jobs.length === 0 && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">
            No offline jobs. Agents submit them with <code>tbc-job submit</code>.
          </p>
        )}
      </div>
    </DashboardWidget>
  )
}
