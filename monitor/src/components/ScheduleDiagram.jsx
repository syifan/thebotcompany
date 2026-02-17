import { useState } from 'react'
import { Clock, EyeOff, Focus, ChevronDown, ArrowDown } from 'lucide-react'

const visConfig = {
  focused: { icon: Focus, label: 'Focused', color: '#eab308' },
  blind: { icon: EyeOff, label: 'Blind', color: '#ef4444' },
}

const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f97316', '#ec4899', '#06b6d4']

const isDark = () => document.documentElement.classList.contains('dark')

// Reusable collapsible card: header with chevron flush right, expandable body
function MetaCard({ label, color, defaultOpen = false, children }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const dark = isDark()
  const hasBody = !!children

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      background: dark ? '#1e1e1e' : '#ffffff',
      border: `1px solid ${dark ? `${color}50` : `${color}35`}`,
    }}>
      <button
        onClick={() => hasBody && setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', width: '100%',
          background: 'none', border: 'none',
          cursor: hasBody ? 'pointer' : 'default',
          borderBottom: expanded && hasBody ? `1px solid ${dark ? `${color}30` : `${color}20`}` : 'none',
        }}>
        <span style={{ fontSize: 12, fontWeight: 600, color, flex: 1, textAlign: 'left' }}>{label}</span>
        {hasBody && <ChevronDown style={{ width: 12, height: 12, color, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />}
      </button>
      {expanded && hasBody && (
        <div style={{
          padding: '8px 12px',
          fontSize: 13, lineHeight: 1.5,
          color: dark ? '#a3a3a3' : '#525252',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function ScheduleBody({ schedule }) {
  const dark = isDark()
  const entries = Object.entries(schedule.agents)
  const topDelay = schedule.delay

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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
              display: 'flex', borderRadius: 8, overflow: 'hidden',
              background: dark ? '#262626' : '#f9fafb',
              border: `1px solid ${dark ? '#404040' : '#e5e5e5'}`,
            }}>
              <div style={{ width: 4, background: color, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: '#fff',
                  }}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: dark ? '#f5f5f5' : '#171717', textTransform: 'capitalize' }}>
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
                <p style={{ fontSize: 12, lineHeight: 1.5, color: dark ? '#a3a3a3' : '#525252', margin: 0 }}>
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
  )
}

function ScheduleDiagram({ schedule }) {
  if (!schedule || !schedule.agents || Object.keys(schedule.agents).length === 0) return null
  const entries = Object.entries(schedule.agents)

  return (
    <div className="my-4 not-prose">
      <MetaCard label={`📋 Schedule · ${entries.length} agent${entries.length > 1 ? 's' : ''}`} color="#3b82f6">
        <ScheduleBody schedule={schedule} />
      </MetaCard>
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
  const milestone = parseMilestoneBlock(text)
  const { list: directives, verifyFailFeedback } = parseDirectives(text)

  if (!milestone && directives.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      {milestone && (
        <MetaCard
          label={`🎯 Milestone: ${milestone.title || milestone.description?.slice(0, 60)} · ${milestone.cycles} cycles`}
          color="#8b5cf6"
        >
          {milestone.description && (
            <div style={{ whiteSpace: 'pre-wrap' }}>{milestone.description}</div>
          )}
        </MetaCard>
      )}
      {directives.includes('claim_complete') && (
        <MetaCard label="📦 Claimed Complete" color="#3b82f6" />
      )}
      {directives.includes('verify_pass') && (
        <MetaCard label="✅ Verification Passed" color="#10b981" />
      )}
      {directives.includes('verify_fail') && (
        <MetaCard label="❌ Verification Failed" color="#ef4444">
          {verifyFailFeedback && (
            <div style={{ whiteSpace: 'pre-wrap' }}>{verifyFailFeedback}</div>
          )}
        </MetaCard>
      )}
    </div>
  )
}

export default ScheduleDiagram
