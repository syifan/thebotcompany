import { useState } from 'react'
import { Clock, Eye, EyeOff, Focus, ChevronDown, User, ArrowDown } from 'lucide-react'

const visConfig = {
  full: { icon: Eye, label: 'Full', bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20' },
  focused: { icon: Focus, label: 'Focused', bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/20' },
  blind: { icon: EyeOff, label: 'Blind', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20' },
}

const agentColors = [
  'from-blue-500 to-blue-600',
  'from-purple-500 to-purple-600',
  'from-emerald-500 to-emerald-600',
  'from-orange-500 to-orange-600',
  'from-pink-500 to-pink-600',
  'from-cyan-500 to-cyan-600',
]

const isDark = () => document.documentElement.classList.contains('dark')

function ScheduleDiagram({ schedule }) {
  const [expanded, setExpanded] = useState(false)
  if (!schedule || !schedule.agents || Object.keys(schedule.agents).length === 0) return null

  const entries = Object.entries(schedule.agents)
  const topDelay = schedule.delay

  return (
    <div className="my-3 not-prose">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-medium text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
      >
        <span className="inline-flex items-center gap-1.5 bg-blue-500/10 dark:bg-blue-500/15 px-2.5 py-1 rounded-full border border-blue-500/20">
          📋 Schedule · {entries.length} agent{entries.length > 1 ? 's' : ''}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {expanded && (
        <div className="mt-3 space-y-2">
          {/* Top-level delay */}
          {topDelay > 0 && (
            <div className="flex items-center justify-center gap-1.5 py-1">
              <div className="flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                <Clock className="w-3 h-3" />
                {topDelay}m delay
              </div>
            </div>
          )}

          {/* Agent cards in a flow */}
          <div className="flex flex-col items-stretch gap-0">
            {entries.map(([name, value], i) => {
              const task = typeof value === 'string' ? value : value.task || ''
              const delay = typeof value === 'object' ? value.delay : null
              const vis = typeof value === 'object' ? value.visibility : null
              const visInfo = vis && vis !== 'full' ? visConfig[vis] : null
              const VisIcon = visInfo?.icon
              const color = agentColors[i % agentColors.length]

              return (
                <div key={name}>
                  {/* Arrow connector */}
                  {i > 0 && (
                    <div className="flex items-center justify-center py-0.5">
                      <ArrowDown className="w-4 h-4 text-neutral-300 dark:text-neutral-600" />
                    </div>
                  )}

                  {/* Agent card */}
                  <div className="flex items-stretch gap-0 rounded-lg overflow-hidden" style={{ background: isDark() ? '#262626' : '#fafafa', border: `1px solid ${isDark() ? '#404040' : '#e5e5e5'}` }}>
                    {/* Color accent bar */}
                    <div className={`w-1 bg-gradient-to-b ${color} shrink-0`} />
                    
                    <div className="flex-1 p-2.5 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
                          <User className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{name}</span>
                        {visInfo && (
                          <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${visInfo.bg} ${visInfo.text} border ${visInfo.border}`}>
                            <VisIcon className="w-2.5 h-2.5" />
                            {visInfo.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">{task}</p>
                    </div>
                  </div>

                  {/* Per-agent delay */}
                  {delay > 0 && (
                    <div className="flex items-center justify-center py-0.5">
                      <div className="flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        {delay}m delay
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function parseScheduleBlock(text) {
  if (!text) return null
  const match = text.match(/<!--\s*SCHEDULE\s*-->\s*(\{[\s\S]*?\})\s*<!--\s*\/SCHEDULE\s*-->/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

export function stripScheduleBlock(text) {
  if (!text) return text
  return text.replace(/<!--\s*SCHEDULE\s*-->\s*\{[\s\S]*?\}\s*<!--\s*\/SCHEDULE\s*-->/, '').trim()
}

export default ScheduleDiagram
