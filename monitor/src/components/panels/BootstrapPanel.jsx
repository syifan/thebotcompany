import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'

export default function BootstrapPanel({
  bootstrapModal,
  setBootstrapModal,
  executeBootstrap,
}) {
  return (
    <Panel id="bootstrap" open={bootstrapModal.open} onClose={() => setBootstrapModal(prev => ({ ...prev, open: false }))}>
      <PanelHeader onClose={() => setBootstrapModal(prev => ({ ...prev, open: false }))}>
        Bootstrap Workspace
      </PanelHeader>
      <PanelContent>
        {bootstrapModal.loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : bootstrapModal.preview && !bootstrapModal.preview.available ? (
          <div className="space-y-4">
            <div className="p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-700 dark:text-yellow-300 text-sm">
              {bootstrapModal.preview.reason || 'Bootstrap is not available for this project.'}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setBootstrapModal(prev => ({ ...prev, open: false }))}>Close</Button>
            </div>
          </div>
        ) : bootstrapModal.preview ? (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Bootstrap wipes project data and resets the project cycle so agents start fresh.
            </p>

            <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded">
              <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">What will be lost</p>
              <ul className="text-sm text-red-700 dark:text-red-300 space-y-1 list-disc list-inside">
                <li>Project data will be reset — agent notes, reports, uploaded files, and run history will be deleted</li>
                <li>The cycle count will be reset to 1</li>
              </ul>
            </div>

            <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">What will happen</p>
              <ul className="text-sm text-green-700 dark:text-green-300 space-y-1 list-disc list-inside">
                <li>Phase resets to Athena (strategy)</li>
                <li>Agents will start fresh — managers will re-hire workers and plan from scratch</li>
              </ul>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded">
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300 mb-1">What will be kept</p>
              <ul className="text-sm text-neutral-500 dark:text-neutral-400 space-y-1 list-disc list-inside">
                <li>Project configuration (config.yaml) is preserved</li>
                <li>All repository files, PRs, and issues remain untouched</li>
                <li>Database (issues, comments) is preserved</li>
              </ul>
            </div>

            {/* Remove knowledge/roadmap.md — toggle switch */}
            <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded">
              <div>
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Remove knowledge/roadmap.md</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {bootstrapModal.preview.hasRoadmap ? 'Delete private knowledge file' : 'No knowledge/roadmap.md found, will be skipped'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bootstrapModal.removeRoadmap}
                onClick={() => setBootstrapModal(prev => ({ ...prev, removeRoadmap: !prev.removeRoadmap }))}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${bootstrapModal.removeRoadmap ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${bootstrapModal.removeRoadmap ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* knowledge/spec.md — segmented control */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded space-y-3">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">knowledge/spec.md</p>
              <div className="flex rounded-lg bg-neutral-200 dark:bg-neutral-700 p-0.5">
                {[{ value: 'keep', label: 'Keep' }, { value: 'edit', label: 'Edit' }, { value: 'new', label: 'Rewrite' }].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setBootstrapModal(prev => ({
                      ...prev,
                      specMode: opt.value,
                      ...(opt.value === 'edit' ? { specContent: prev.specContent || prev.preview?.specContent || '' } : {})
                    }))}
                    className={`flex-1 text-sm font-medium py-1.5 px-3 rounded-md transition-all duration-150 ${
                      bootstrapModal.specMode === opt.value
                        ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm'
                        : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {bootstrapModal.specMode === 'edit' && (
                <textarea
                  className="w-full h-48 p-2 text-sm font-mono border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                  value={bootstrapModal.specContent}
                  onChange={e => setBootstrapModal(prev => ({ ...prev, specContent: e.target.value }))}
                  placeholder="Edit your spec.md content..."
                />
              )}

              {bootstrapModal.specMode === 'new' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">What to build</label>
                    <textarea
                      className="w-full h-24 p-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                      value={bootstrapModal.whatToBuild}
                      onChange={e => setBootstrapModal(prev => ({ ...prev, whatToBuild: e.target.value }))}
                      placeholder="Describe what this project should build..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Success criteria</label>
                    <textarea
                      className="w-full h-24 p-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                      value={bootstrapModal.successCriteria}
                      onChange={e => setBootstrapModal(prev => ({ ...prev, successCriteria: e.target.value }))}
                      placeholder="How will we know the project is done?"
                    />
                  </div>
                </div>
              )}
            </div>

            {bootstrapModal.error && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
                {bootstrapModal.error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBootstrapModal(prev => ({ ...prev, open: false }))}>Cancel</Button>
              <Button
                onClick={executeBootstrap}
                disabled={bootstrapModal.executing}
                variant="destructive"
              >
                {bootstrapModal.executing ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Bootstrapping...</>
                ) : (
                  'Confirm Bootstrap'
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {bootstrapModal.error && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
                {bootstrapModal.error}
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setBootstrapModal(prev => ({ ...prev, open: false }))}>Close</Button>
            </div>
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
