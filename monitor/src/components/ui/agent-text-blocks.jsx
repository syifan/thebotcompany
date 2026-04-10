import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallBlock from '@/components/ui/tool-call-block'

function Timestamp({ value }) {
  if (!value) return null
  return <div className="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1">{value}</div>
}

export function ThinkingBlock({ children, timestamp }) {
  if (!children || !String(children).trim()) return null
  return (
    <div>
      <Timestamp value={timestamp} />
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 px-3 py-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  )
}

export function ResponseBlock({ content, timestamp }) {
  if (!content || !String(content).trim()) return null
  return (
    <div>
      <Timestamp value={timestamp} />
      <div className="rounded-2xl rounded-bl-sm bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}

function parseMaybeJson(value) {
  if (!value) return null
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function buildChatAssistantBlocks(message) {
  const toolCalls = parseMaybeJson(message?.tool_calls) || []
  const blocks = toolCalls.map((tc) => ({
    type: 'tool',
    id: tc.id,
    name: tc.name,
    input: tc.input,
    output: tc.output,
    summary: tc.summary,
    ok: tc.ok,
    exitCode: tc.exitCode,
  }))

  if (message?.content && String(message.content).trim()) {
    blocks.push({ type: 'response', content: message.content })
  }

  return blocks
}

export function buildLiveLogBlocks(log = []) {
  const blocks = []
  const toolIndexById = new Map()

  for (const entry of log) {
    const timestamp = entry?.time ? new Date(entry.time).toLocaleTimeString() : null

    if (entry?.type === 'tool_call') {
      const block = {
        type: 'tool',
        id: entry.id,
        name: entry.name,
        input: entry.input,
        summary: entry.name === 'Bash' ? entry.input?.command : '',
        timestamp,
        ok: entry.ok,
        exitCode: entry.exitCode,
      }
      blocks.push(block)
      if (entry.id) toolIndexById.set(entry.id, blocks.length - 1)
      continue
    }

    if (entry?.type === 'tool_result') {
      const idx = entry.id ? toolIndexById.get(entry.id) : undefined
      if (idx !== undefined) {
        blocks[idx] = { ...blocks[idx], output: entry.output ?? '', ok: entry.ok, exitCode: entry.exitCode }
      } else {
        blocks.push({
          type: 'tool',
          id: entry.id,
          name: entry.name || 'Tool',
          input: entry.input || {},
          summary: entry.name === 'Bash' ? entry.input?.command : '',
          output: entry.output ?? '',
          ok: entry.ok,
          exitCode: entry.exitCode,
          timestamp,
        })
      }
      continue
    }

    if (entry?.type === 'thinking') {
      if (entry.content?.trim()) blocks.push({ type: 'thinking', content: entry.content, timestamp })
      continue
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type !== 'tool') continue
    const hasLaterBlock = i < blocks.length - 1
    if (hasLaterBlock && block.output === undefined) {
      block.output = ''
    }
  }

  return blocks
}

export function buildReportBlocks(text) {
  if (!text || !String(text).trim()) return []
  return [{ type: 'response', content: text }]
}

export function AgentContentBlocks({ blocks = [], showTimestamps = true }) {
  const visibleBlocks = blocks.filter((block) => block?.type === 'tool' || block?.content?.trim())
  if (visibleBlocks.length === 0) return null

  return (
    <div className="space-y-1">
      {visibleBlocks.map((block, index) => {
        if (block.type === 'thinking') {
          return <ThinkingBlock key={block.id || index} timestamp={showTimestamps ? block.timestamp : null}>{block.content}</ThinkingBlock>
        }
        if (block.type === 'tool') {
          return (
            <div key={block.id || index}>
              {showTimestamps ? <Timestamp value={block.timestamp} /> : null}
              <ToolCallBlock name={block.name} input={block.input} output={block.output} summary={block.summary} ok={block.ok} exitCode={block.exitCode} />
            </div>
          )
        }
        return <ResponseBlock key={block.id || index} content={block.content} timestamp={showTimestamps ? block.timestamp : null} />
      })}
    </div>
  )
}
