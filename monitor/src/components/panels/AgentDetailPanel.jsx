import React from 'react'
import { Badge } from '@/components/ui/badge'
import StatusPill from '@/components/ui/status-pill'
import { RefreshCw } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function AgentDetailPanel({ agentModal, setAgentModal }) {
  return (
    <Panel id="agent-detail" open={agentModal.open} onClose={() => setAgentModal({ ...agentModal, open: false })}>
      <PanelHeader onClose={() => setAgentModal({ ...agentModal, open: false })}>
        <span className="capitalize">{agentModal.agent}</span>
        {agentModal.data?.isManager && <StatusPill variant="meta" className="ml-2">Manager</StatusPill>}
      </PanelHeader>
      <PanelContent>
        {agentModal.loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : agentModal.data ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-neutral-600 dark:text-neutral-300">Model</h3>
              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-sm rounded">{agentModal.data.model || 'inherited'}</span>
            </div>
            {/* Tabs: Skill | Workspace */}
            <div className="flex border-b border-neutral-200 dark:border-neutral-700">
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${agentModal.tab === 'skill' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                onClick={() => setAgentModal(prev => ({ ...prev, tab: 'skill' }))}
              >Skill</button>
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${agentModal.tab === 'files' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                onClick={() => setAgentModal(prev => ({ ...prev, tab: 'files' }))}
              >Files</button>
            </div>
            {agentModal.tab === 'skill' ? (
            <div className="space-y-3">
              {/* Agent Skill - shown first and open by default */}
              <details open>
                <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300">Agent Skill — {agentModal.agent}.md</summary>
                <div className="text-sm prose prose-sm dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.skill}</ReactMarkdown>
                </div>
              </details>
              {/* Role Rules - collapsed by default */}
              {agentModal.data.roleRules && (
              <details>
                <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300">{agentModal.data.isManager ? 'Manager' : 'Worker'} Rules — {agentModal.data.isManager ? 'manager' : 'worker'}.md</summary>
                <div className="text-sm prose prose-sm dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.roleRules}</ReactMarkdown>
                </div>
              </details>
              )}
              {/* Shared Rules - collapsed by default */}
              {agentModal.data.everyone && (
              <details>
                <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300">Shared Rules — everyone.md</summary>
                <div className="text-sm prose prose-sm dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.everyone}</ReactMarkdown>
                </div>
              </details>
              )}
            </div>
            ) : (
            <div className="space-y-3">
              {agentModal.data.agentFiles?.length > 0 ? (
                agentModal.data.agentFiles.map((file, i) => (
                  <details key={file.name} open={i === 0}>
                    <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center justify-between">
                      <span>{file.name}</span>
                      <span className="text-[10px] font-normal normal-case">{new Date(file.modified).toLocaleString()}</span>
                    </summary>
                    {file.content && (
                      <div className="text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3 [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:border-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
                      </div>
                    )}
                  </details>
                ))
              ) : (
                <p className="text-neutral-400 dark:text-neutral-500 italic py-4 text-center">No agent files</p>
              )}
            </div>
            )}
          </div>
        ) : (
          <p className="text-neutral-400 dark:text-neutral-500 text-center py-8">Failed to load agent details</p>
        )}
      </PanelContent>
    </Panel>
  )
}
