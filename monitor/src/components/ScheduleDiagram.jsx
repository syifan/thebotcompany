import { useState } from 'react'
import { Clock, Eye, EyeOff, Focus, ChevronDown } from 'lucide-react'

const visIcons = {
  full: { icon: Eye, label: 'Full', color: 'text-green-500' },
  focused: { icon: Focus, label: 'Focused', color: 'text-yellow-500' },
  blind: { icon: EyeOff, label: 'Blind', color: 'text-red-500' },
}

function ScheduleDiagram({ schedule }) {
  const [expanded, setExpanded] = useState(false)
  if (!schedule || !schedule.agents || Object.keys(schedule.agents).length === 0) return null

  const entries = Object.entries(schedule.agents)
  const topDelay = schedule.delay

  return (
    <div className="my-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-semibold text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
      >
        <span className="bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded">📋 Schedule ({entries.length} agent{entries.length > 1 ? 's' : ''})</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {expanded && (
        <div className="mt-2 ml-1 border-l-2 border-blue-200 dark:border-blue-800 pl-3 space-y-0">
          {/* Top-level delay */}
          {topDelay > 0 && (
            <div className="flex items-center gap-2 py-1.5 text-xs text-neutral-400 dark:text-neutral-500">
              <Clock className="w-3.5 h-3.5" />
              <span>Wait {topDelay}m after manager</span>
            </div>
          )}

          {entries.map(([name, value], i) => {
            const task = typeof value === 'string' ? value : value.task || ''
            const delay = typeof value === 'object' ? value.delay : null
            const vis = typeof value === 'object' ? value.visibility : 'full'
            const VisInfo = visIcons[vis] || visIcons.full
            const VisIcon = VisInfo.icon

            return (
              <div key={name}>
                {/* Agent card */}
                <div className="relative py-2">
                  {/* Connector dot */}
                  <div className="absolute -left-[17px] top-4 w-2.5 h-2.5 rounded-full bg-blue-400 dark:bg-blue-500 border-2 border-white dark:border-neutral-900" />
                  
                  <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-2.5 border border-neutral-200 dark:border-neutral-700">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{name}</span>
                      {vis !== 'full' && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-medium ${VisInfo.color}`}>
                          <VisIcon className="w-3 h-3" />
                          {VisInfo.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-3">{task}</p>
                  </div>
                </div>

                {/* Per-agent delay */}
                {delay > 0 && (
                  <div className="flex items-center gap-2 py-1 text-xs text-neutral-400 dark:text-neutral-500 ml-2">
                    <Clock className="w-3 h-3" />
                    <span>Wait {delay}m</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Parse SCHEDULE block from text
export function parseScheduleBlock(text) {
  if (!text) return null
  const match = text.match(/<!--\s*SCHEDULE\s*-->\s*(\{[\s\S]*?\})\s*<!--\s*\/SCHEDULE\s*-->/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

// Strip SCHEDULE block from text for clean markdown rendering
export function stripScheduleBlock(text) {
  if (!text) return text
  return text.replace(/<!--\s*SCHEDULE\s*-->\s*\{[\s\S]*?\}\s*<!--\s*\/SCHEDULE\s*-->/, '').trim()
}

export default ScheduleDiagram
