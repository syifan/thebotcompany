import React from 'react'
import { Settings, Filter, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { getAgentTask } from '@/components/ScheduleDiagram'

export default function WorkerCard({
  agent,
  isManager = false,
  selectedProject,
  selectedAgent,
  openAgentModal,
  openAgentSettings,
  selectAgent,
  clearAgentFilter,
}) {
  const isActive = selectedProject?.currentAgent === agent.name
  const isSelected = selectedAgent === agent.name
  const runtime = isActive ? selectedProject?.currentAgentRuntime : null
  const schedule = selectedProject?.schedule
  const task = getAgentTask(schedule, agent.name)

  const formatRuntime = (seconds) => {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s}s`
  }

  return (
    <div className="p-2 rounded bg-neutral-50 dark:bg-neutral-900">
      {/* Row 1: Name + action buttons */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-800 dark:text-neutral-100 capitalize">
          {agent.name}
          {agent.role && <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400 ml-1.5">({agent.role})</span>}
          {agent.reportsTo && <span className="text-xs font-normal text-neutral-400 dark:text-neutral-500 ml-1.5">→ {agent.reportsTo}</span>}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => openAgentModal(agent.name)}
            className="p-1 rounded transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
            title="View agent details"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openAgentSettings(agent)}
            className="p-1 rounded transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
            title="Agent settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (isSelected) clearAgentFilter()
              else selectAgent(agent.name)
            }}
            className={`p-1 rounded transition-colors ${
              isSelected
                ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
            title="Filter comments by agent"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {task && <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5 italic">{task}</p>}
      {/* Pills */}
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {agent.model && <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded-full">{agent.model}</span>}
        {isActive && (
          <Badge variant="success" className="flex items-center gap-1">
            Active{runtime !== null && <span className="font-mono">{formatRuntime(runtime)}</span>}
          </Badge>
        )}
      </div>
      {/* Cost metrics */}
      {(agent.totalCost > 0 || agent.lastCallCost > 0) && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
          Last: ${(agent.lastCallCost || 0).toFixed(2)} · Avg: ${(agent.avgCallCost || 0).toFixed(2)} · 24h: ${(agent.last24hCost || 0).toFixed(2)} · Total: ${(agent.totalCost || 0).toFixed(2)}
        </p>
      )}
    </div>
  )
}
