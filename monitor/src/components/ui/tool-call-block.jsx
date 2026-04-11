import React, { useState } from 'react'
import { Loader2, ChevronDown, ChevronRight, Terminal, FileText, Pencil, Search, FolderSearch, Paperclip, CheckCircle2, AlertCircle, Globe } from 'lucide-react'

const TOOL_ICONS = {
  Bash: Terminal,
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Grep: Search,
  Glob: FolderSearch,
  WebFetch: Globe,
}

export default function ToolCallBlock({ name, input, output, summary, ok, exitCode }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = TOOL_ICONS[name] || Paperclip
  const hasOutput = output !== undefined && output !== null
  const isRunning = !hasOutput
  const outputText = typeof output === 'string' ? output.trim() : ''
  const explicitBashFailure = name === 'Bash' && !!outputText && (
    outputText.startsWith('Error:') ||
    outputText.startsWith('Blocked:') ||
    /\nExit code:\s*[1-9]\d*\b/.test(outputText) ||
    /^Exit code:\s*[1-9]\d*\b/.test(outputText)
  )
  const inferredError = explicitBashFailure || (name !== 'Bash' && outputText.startsWith('Error:'))
  const isError = ok === false || (typeof exitCode === 'number' && exitCode !== 0) || inferredError
  const StatusIcon = isRunning ? Loader2 : isError ? AlertCircle : CheckCircle2
  const statusIconClass = isRunning
    ? 'w-3.5 h-3.5 shrink-0 animate-spin text-neutral-400'
    : isError
      ? 'w-3.5 h-3.5 shrink-0 text-red-500'
      : 'w-3.5 h-3.5 shrink-0 text-emerald-500'
  const containerClass = isRunning
    ? 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50'
    : isError
      ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20'
      : 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20'

  return (
    <div className={`my-1.5 rounded border text-xs overflow-hidden ${containerClass}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Icon className="w-3 h-3 shrink-0 text-blue-500" />
        <span className="font-semibold text-blue-600 dark:text-blue-400">{name}</span>
        <span className="text-neutral-500 dark:text-neutral-400 truncate text-left flex-1">{summary || ''}</span>
        <StatusIcon className={statusIconClass} />
      </button>
      {expanded && (
        <div className="border-t border-neutral-200 dark:border-neutral-700">
          <div className="px-2 py-1.5 bg-neutral-100 dark:bg-neutral-800/50">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">Input</div>
            <pre className="text-[11px] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words overflow-x-auto">{JSON.stringify(input, null, 2)}</pre>
          </div>
          {hasOutput && (
            <div className="px-2 py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">Output</div>
              {typeof output === 'string' && output.length === 0 ? (
                <div className="text-[11px] italic text-neutral-500 dark:text-neutral-400">No output captured</div>
              ) : (
                <pre className="text-[11px] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words overflow-x-auto">{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
