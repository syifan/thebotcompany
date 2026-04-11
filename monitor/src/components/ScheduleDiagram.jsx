import { useState } from 'react'
import { Clock, Eye, EyeOff, Focus, ChevronDown, ArrowDown } from 'lucide-react'

const visConfig = {
  full: { icon: Eye, label: 'Full', color: '#10b981' },
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

// Normalize schedule to _steps array format
function normalizeStep(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null
  if (step.delay !== undefined) {
    return Object.keys(step).length === 1 && typeof step.delay === 'number'
      ? { delay: step.delay }
      : null
  }
  if (typeof step.agent !== 'string' || !step.agent.trim()) return null
  const { agent, ...rest } = step
  if (!Object.prototype.hasOwnProperty.call(rest, 'prompt')) return null
  return { [agent]: rest }
}

function normalizeSteps(schedule) {
  if (!schedule) return []
  const rawSteps = Array.isArray(schedule)
    ? schedule
    : Array.isArray(schedule._steps)
      ? schedule._steps
      : null
  if (!rawSteps) return []
  const steps = rawSteps.map(normalizeStep)
  return steps.every(Boolean) ? steps : []
}

// Extract agent entries (name + value) from steps, skipping delays
export function getAgentEntries(schedule) {
  const steps = normalizeSteps(schedule)
  const entries = []
  for (const step of steps) {
    const keys = Object.keys(step)
    if (keys.length === 1 && keys[0] === 'delay') continue
    for (const key of keys) {
      if (key !== 'delay') entries.push([key, step[key]])
    }
  }
  return entries
}

// Find a specific agent's task from schedule
export function getAgentTask(schedule, agentName) {
  const entries = getAgentEntries(schedule)
  const entry = entries.find(([name]) => name.toLowerCase() === agentName.toLowerCase())
  if (!entry) return null
  const value = entry[1]
  return typeof value === 'string' ? value : value?.task || null
}

function ScheduleBody({ schedule }) {
  const dark = isDark()
  const steps = normalizeSteps(schedule)
  let agentIndex = 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((step, i) => {
        const keys = Object.keys(step)

        // Delay step
        if (keys.length === 1 && keys[0] === 'delay') {
          return (
            <div key={`delay-${i}`} style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: dark ? '#737373' : '#a3a3a3',
                background: dark ? '#262626' : '#f5f5f5',
                padding: '3px 10px', borderRadius: 12,
              }}>
                <Clock style={{ width: 12, height: 12 }} /> {step.delay}m delay
              </span>
            </div>
          )
        }

        // Agent step
        const name = keys.find(k => k !== 'delay')
        if (!name) return null
        const value = step[name]
        const task = typeof value === 'string' ? value : value.task || ''
        const vis = typeof value === 'object' ? value.visibility : null
        const visInfo = visConfig[vis || 'full']
        const VisIcon = visInfo?.icon
        const color = colors[agentIndex % colors.length]
        agentIndex++

        return (
          <div key={name}>
            {i > 0 && keys[0] !== 'delay' && (
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
          </div>
        )
      })}
    </div>
  )
}

function ScheduleDiagram({ schedule }) {
  const entries = getAgentEntries(schedule)
  if (entries.length === 0) return null

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
  const match = text.match(/<!--\s*SCHEDULE\s*-->\s*([\[{][\s\S]*?[\]}])\s*<!--\s*\/SCHEDULE\s*-->/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1])
    if (!Array.isArray(raw)) return null
    const steps = raw.map(normalizeStep)
    if (!steps.every(Boolean)) return null
    return { _steps: steps }
  } catch { return null }
}

export function stripScheduleBlock(text) {
  if (!text) return text
  return text.replace(/<!--\s*SCHEDULE\s*-->\s*[\[{][\s\S]*?[\]}]\s*<!--\s*\/SCHEDULE\s*-->/, '').trim()
}

export function parseTimingBlock(text) {
  if (!text) return null
  const match = text.match(/^>\s*⏱\s*Started:\s*(.+?)\s*\|\s*Ended:\s*(.+?)\s*\|\s*Duration:\s*(.+)$/m)
  if (!match) return null
  return { started: match[1].trim(), ended: match[2].trim(), duration: match[3].trim() }
}

export function stripAllMetaBlocks(text) {
  if (!text) return text
  return text
    .replace(/^>\s*⏱\s*Started:.*$/m, '')
    .replace(/<!--\s*SCHEDULE\s*-->[\s\S]*?<!--\s*\/SCHEDULE\s*-->/g, '')
    .replace(/<!--\s*(MILESTONE|VERIFY_FAIL|PROJECT_COMPLETE|EXAM_PASS|EXAM_FAIL)\s*-->[\s\S]*?<!--\s*\/\1\s*-->/g, '')
    .replace(/<!--\s*(CLAIM_COMPLETE|VERIFY_PASS|VERIFY_FAIL|EXAM_PASS|EXAM_FAIL)\s*-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseMilestoneBlock(text) {
  if (!text) return null
  const match = text.match(/<!--\s*MILESTONE\s*-->\s*([\s\S]*?)\s*<!--\s*\/MILESTONE\s*-->/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

export function parseProjectComplete(text) {
  if (!text) return null
  const match = text.match(/<!--\s*PROJECT_COMPLETE\s*-->\s*([\s\S]*?)\s*<!--\s*\/PROJECT_COMPLETE\s*-->/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

export function parseExamPass(text) {
  if (!text) return null
  const match = text.match(/<!--\s*EXAM_PASS\s*-->\s*([\s\S]*?)\s*<!--\s*\/EXAM_PASS\s*-->/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return { message: match[1].trim() } }
}

export function parseDirectives(text) {
  if (!text) return { list: [], verifyFailFeedback: null, examFailFeedback: null }
  const list = []
  if (/<!--\s*CLAIM_COMPLETE\s*-->/.test(text)) list.push('claim_complete')
  if (/<!--\s*VERIFY_PASS\s*-->/.test(text)) list.push('verify_pass')
  if (/<!--\s*EXAM_PASS\s*-->/.test(text)) list.push('exam_pass')
  let verifyFailFeedback = null
  let examFailFeedback = null
  const vfMatch = text.match(/<!--\s*VERIFY_FAIL\s*-->\s*([\s\S]*?)\s*<!--\s*\/VERIFY_FAIL\s*-->/)
  if (vfMatch) {
    list.push('verify_fail')
    try { verifyFailFeedback = JSON.parse(vfMatch[1]).feedback } catch { verifyFailFeedback = vfMatch[1].trim() }
  } else if (/<!--\s*VERIFY_FAIL\s*-->/.test(text)) {
    list.push('verify_fail')
  }
  const efMatch = text.match(/<!--\s*EXAM_FAIL\s*-->\s*([\s\S]*?)\s*<!--\s*\/EXAM_FAIL\s*-->/)
  if (efMatch) {
    list.push('exam_fail')
    try {
      const parsed = JSON.parse(efMatch[1])
      examFailFeedback = parsed.feedback || parsed.summary || efMatch[1].trim()
    } catch {
      examFailFeedback = efMatch[1].trim()
    }
  } else if (/<!--\s*EXAM_FAIL\s*-->/.test(text)) {
    list.push('exam_fail')
  }
  return { list, verifyFailFeedback, examFailFeedback }
}

export function MetaBlockBadges({ text }) {
  const milestone = parseMilestoneBlock(text)
  const projectComplete = parseProjectComplete(text)
  const examPass = parseExamPass(text)
  const { list: directives, verifyFailFeedback, examFailFeedback } = parseDirectives(text)

  if (!milestone && !projectComplete && !examPass && directives.length === 0) return null

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
      {directives.includes('exam_pass') && (
        <MetaCard label="⚖️ Themis Approved" color="#10b981">
          {examPass?.message && (
            <div style={{ whiteSpace: 'pre-wrap' }}>{examPass.message}</div>
          )}
        </MetaCard>
      )}
      {directives.includes('exam_fail') && (
        <MetaCard label="⚖️ Themis Rejected" color="#ef4444">
          {examFailFeedback && (
            <div style={{ whiteSpace: 'pre-wrap' }}>{examFailFeedback}</div>
          )}
        </MetaCard>
      )}
      {projectComplete && (
        <MetaCard
          label={projectComplete.success ? '🏁 Project Complete' : '🛑 Project Ended'}
          color={projectComplete.success ? '#10b981' : '#ef4444'}
        >
          {projectComplete.message && (
            <div style={{ whiteSpace: 'pre-wrap' }}>{projectComplete.message}</div>
          )}
        </MetaCard>
      )}
    </div>
  )
}

export default ScheduleDiagram
