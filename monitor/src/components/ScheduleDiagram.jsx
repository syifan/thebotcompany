import { useState } from 'react'
import { Clock, EyeOff, Focus, ChevronDown, ArrowDown } from 'lucide-react'

const visConfig = {
  focused: { icon: Focus, label: 'Focused', color: '#eab308' },
  blind: { icon: EyeOff, label: 'Blind', color: '#ef4444' },
}

const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f97316', '#ec4899', '#06b6d4']

const isDark = () => document.documentElement.classList.contains('dark')

function ScheduleDiagram({ schedule }) {
  const [expanded, setExpanded] = useState(false)
  if (!schedule || !schedule.agents || Object.keys(schedule.agents).length === 0) return null

  const entries = Object.entries(schedule.agents)
  const topDelay = schedule.delay
  const dark = isDark()

  return (
    <div className="my-4 not-prose">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-medium transition-colors"
        style={{ color: '#3b82f6' }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: dark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.08)',
          padding: '5px 12px', borderRadius: '20px',
          border: '1px solid rgba(59,130,246,0.2)',
        }}>
          📋 Schedule · {entries.length} agent{entries.length > 1 ? 's' : ''}
        </span>
        <ChevronDown style={{ width: 14, height: 14, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
      </button>
      
      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {topDelay > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: dark ? '#737373' : '#a3a3a3',
                background: dark ? '#262626' : '#f5f5f5',
                padding: '3px 10px', borderRadius: 12,
              }}>
                <Clock style={{ width: 12, height: 12 }} /> {topDelay}m delay
              </span>
            </div>
          )}

          {entries.map(([name, value], i) => {
            const task = typeof value === 'string' ? value : value.task || ''
            const delay = typeof value === 'object' ? value.delay : null
            const vis = typeof value === 'object' ? value.visibility : null
            const visInfo = vis && vis !== 'full' ? visConfig[vis] : null
            const VisIcon = visInfo?.icon
            const color = colors[i % colors.length]

            return (
              <div key={name}>
                {i > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                    <ArrowDown style={{ width: 16, height: 16, color: dark ? '#525252' : '#d4d4d4' }} />
                  </div>
                )}

                <div style={{
                  display: 'flex',
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: dark ? '#1e1e1e' : '#ffffff',
                  border: `1px solid ${dark ? '#404040' : '#e5e5e5'}`,
                  boxShadow: dark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                  {/* Color accent */}
                  <div style={{ width: 4, background: color, flexShrink: 0 }} />
                  
                  {/* Content */}
                  <div style={{ flex: 1, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: '#fff',
                      }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: dark ? '#f5f5f5' : '#171717', textTransform: 'capitalize' }}>
                        {name}
                      </span>
                      {visInfo && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          fontSize: 10, fontWeight: 500, color: visInfo.color,
                          background: `${visInfo.color}15`, padding: '2px 8px', borderRadius: 10,
                          border: `1px solid ${visInfo.color}30`,
                        }}>
                          <VisIcon style={{ width: 10, height: 10 }} />
                          {visInfo.label}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: dark ? '#a3a3a3' : '#525252', margin: 0 }}>
                      {task}
                    </p>
                  </div>
                </div>

                {delay > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, color: dark ? '#737373' : '#a3a3a3',
                      background: dark ? '#262626' : '#f5f5f5',
                      padding: '3px 10px', borderRadius: 12,
                    }}>
                      <Clock style={{ width: 12, height: 12 }} /> {delay}m delay
                    </span>
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

// Strip ALL meta blocks (SCHEDULE, MILESTONE, CLAIM_COMPLETE, VERIFY_PASS, VERIFY_FAIL)
export function stripAllMetaBlocks(text) {
  if (!text) return text
  return text
    .replace(/<!--\s*(SCHEDULE|MILESTONE|VERIFY_FAIL)\s*-->[\s\S]*?<!--\s*\/\1\s*-->/g, '')
    .replace(/<!--\s*(CLAIM_COMPLETE|VERIFY_PASS|VERIFY_FAIL)\s*-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseMilestoneBlock(text) {
  if (!text) return null
  const match = text.match(/<!--\s*MILESTONE\s*-->\s*([\s\S]*?)\s*<!--\s*\/MILESTONE\s*-->/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

export function parseDirectives(text) {
  if (!text) return { list: [], verifyFailFeedback: null }
  const list = []
  if (/<!--\s*CLAIM_COMPLETE\s*-->/.test(text)) list.push('claim_complete')
  if (/<!--\s*VERIFY_PASS\s*-->/.test(text)) list.push('verify_pass')
  let verifyFailFeedback = null
  const vfMatch = text.match(/<!--\s*VERIFY_FAIL\s*-->\s*([\s\S]*?)\s*<!--\s*\/VERIFY_FAIL\s*-->/)
  if (vfMatch) {
    list.push('verify_fail')
    try { verifyFailFeedback = JSON.parse(vfMatch[1]).feedback } catch { verifyFailFeedback = vfMatch[1].trim() }
  } else if (/<!--\s*VERIFY_FAIL\s*-->/.test(text)) {
    list.push('verify_fail')
  }
  return { list, verifyFailFeedback }
}

export function MetaBlockBadges({ text }) {
  const [msExpanded, setMsExpanded] = useState(false)
  const [vfExpanded, setVfExpanded] = useState(false)
  const milestone = parseMilestoneBlock(text)
  const { list: directives, verifyFailFeedback } = parseDirectives(text)
  const dark = isDark()

  if (!milestone && directives.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      {milestone && (
        <div>
          <button
            onClick={() => setMsExpanded(!msExpanded)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: 600,
              color: '#8b5cf6',
              background: dark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.08)',
              padding: '4px 12px', borderRadius: 16,
              border: '1px solid rgba(139,92,246,0.25)',
              cursor: 'pointer',
            }}>
            🎯 Milestone: {milestone.title || milestone.description?.slice(0, 60)} · {milestone.cycles} cycles
            <ChevronDown style={{ width: 12, height: 12, transition: 'transform 0.2s', transform: msExpanded ? 'rotate(180deg)' : 'none' }} />
          </button>
          {msExpanded && milestone.description && (
            <div style={{
              marginTop: 6, marginLeft: 8, padding: '8px 12px',
              fontSize: 13, lineHeight: 1.5,
              color: dark ? '#a3a3a3' : '#525252',
              background: dark ? '#1e1e1e' : '#faf5ff',
              borderRadius: 8,
              border: `1px solid ${dark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)'}`,
              whiteSpace: 'pre-wrap',
            }}>
              {milestone.description}
            </div>
          )}
        </div>
      )}
      {directives.includes('claim_complete') && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600, color: '#3b82f6',
          background: dark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.08)',
          padding: '4px 12px', borderRadius: 16,
          border: '1px solid rgba(59,130,246,0.25)',
        }}>
          📦 Claimed Complete
        </span>
      )}
      {directives.includes('verify_pass') && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600, color: '#10b981',
          background: dark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.08)',
          padding: '4px 12px', borderRadius: 16,
          border: '1px solid rgba(16,185,129,0.25)',
        }}>
          ✅ Verification Passed
        </span>
      )}
      {directives.includes('verify_fail') && (
        <div>
          <button
            onClick={() => verifyFailFeedback && setVfExpanded(!vfExpanded)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: 600, color: '#ef4444',
              background: dark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)',
              padding: '4px 12px', borderRadius: 16,
              border: '1px solid rgba(239,68,68,0.25)',
              cursor: verifyFailFeedback ? 'pointer' : 'default',
            }}>
            ❌ Verification Failed
            {verifyFailFeedback && <ChevronDown style={{ width: 12, height: 12, transition: 'transform 0.2s', transform: vfExpanded ? 'rotate(180deg)' : 'none' }} />}
          </button>
          {vfExpanded && verifyFailFeedback && (
            <div style={{
              marginTop: 6, marginLeft: 8, padding: '8px 12px',
              fontSize: 13, lineHeight: 1.5,
              color: dark ? '#a3a3a3' : '#525252',
              background: dark ? '#1e1e1e' : '#fef2f2',
              borderRadius: 8,
              border: `1px solid ${dark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}`,
              whiteSpace: 'pre-wrap',
            }}>
              {verifyFailFeedback}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ScheduleDiagram
