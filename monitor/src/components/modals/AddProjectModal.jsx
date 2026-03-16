import React from 'react'
import { RefreshCw, ArrowLeft } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

export default function AddProjectModal({
  addProjectModal,
  setAddProjectModal,
  resetAddProjectModal,
  cloneProject,
  cloneSelectedRepo,
  createNewRepo,
  fetchReposForOrg,
  finalizeAddProject,
}) {
  return (
    <Modal open={addProjectModal.step !== null} onClose={resetAddProjectModal}>
      <ModalHeader onClose={resetAddProjectModal}>
        Add Project
      </ModalHeader>
      <ModalContent>
        {addProjectModal.error && (
          <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm mb-4">
            {addProjectModal.error}
          </div>
        )}

        {/* Step: URL Input */}
        {(addProjectModal.step === 'url' || addProjectModal.step === 'cloning') && (
          <div className="space-y-4">
            {/* Toggle: Existing vs New */}
            <div className="flex rounded-md overflow-hidden border border-neutral-300 dark:border-neutral-600">
              <button
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${addProjectModal.repoMode === 'existing' ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'bg-white text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                onMouseDown={(e) => { e.preventDefault(); setAddProjectModal(prev => ({ ...prev, repoMode: 'existing', selectedRepo: '' })); }}
              >Import Existing</button>
              <button
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${addProjectModal.repoMode === 'new' ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'bg-white text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                onMouseDown={(e) => { e.preventDefault(); setAddProjectModal(prev => ({ ...prev, repoMode: 'new', selectedRepo: '' })); }}
              >Create New</button>
            </div>

            {addProjectModal.repoMode === 'new' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Owner</label>
                  {addProjectModal.orgsLoading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-neutral-500"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</div>
                  ) : (
                    <select
                      className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                      value={addProjectModal.selectedOrg}
                      onChange={(e) => setAddProjectModal(prev => ({ ...prev, selectedOrg: e.target.value }))}
                    >
                      {addProjectModal.orgs.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Repository Name</label>
                  <input
                    type="text"
                    placeholder="my-project"
                    className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                    value={addProjectModal.newRepoName}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, newRepoName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Description <span className="text-neutral-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    placeholder="A brief description"
                    className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                    value={addProjectModal.newRepoDescription}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, newRepoDescription: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="newRepoPrivate"
                    checked={addProjectModal.newRepoPrivate}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, newRepoPrivate: e.target.checked }))}
                  />
                  <label htmlFor="newRepoPrivate" className="text-sm text-neutral-700 dark:text-neutral-300">Private repository</label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={resetAddProjectModal}>Cancel</Button>
                  <Button onClick={createNewRepo} disabled={!addProjectModal.newRepoName.trim() || addProjectModal.creatingRepo}>
                    {addProjectModal.creatingRepo ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Next'}
                  </Button>
                </div>
              </>
            ) : addProjectModal.inputMode === 'dropdown' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Organization / User</label>
                  {addProjectModal.orgsLoading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-neutral-500"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</div>
                  ) : (
                    <select
                      className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                      value={addProjectModal.selectedOrg}
                      onChange={(e) => {
                        const org = e.target.value
                        setAddProjectModal(prev => ({ ...prev, selectedOrg: org }))
                        if (org) fetchReposForOrg(org)
                      }}
                      disabled={addProjectModal.step === 'cloning'}
                    >
                      <option value="">Select...</option>
                      {addProjectModal.orgs.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
                {addProjectModal.selectedOrg && (
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Repository</label>
                    {addProjectModal.reposLoading ? (
                      <div className="flex items-center gap-2 py-2 text-sm text-neutral-500"><RefreshCw className="w-4 h-4 animate-spin" /> Loading repos...</div>
                    ) : (
                      <select
                        className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        value={addProjectModal.selectedRepo}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, selectedRepo: e.target.value }))}
                        disabled={addProjectModal.step === 'cloning'}
                      >
                        <option value="">Select a repository...</option>
                        {addProjectModal.repos.map(r => (
                          <option key={r.name} value={r.name}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Or <button className="underline hover:text-neutral-700 dark:hover:text-neutral-300" onClick={() => setAddProjectModal(prev => ({ ...prev, inputMode: 'url' }))}>enter a URL manually</button>
                </p>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">GitHub Repository URL</label>
                  <input
                    type="text"
                    placeholder="https://github.com/username/reponame"
                    className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                    value={addProjectModal.githubUrl}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, githubUrl: e.target.value, error: null }))}
                    disabled={addProjectModal.step === 'cloning'}
                    onKeyDown={(e) => { if (e.key === 'Enter') cloneProject() }}
                  />
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Or <button className="underline hover:text-neutral-700 dark:hover:text-neutral-300" onClick={() => setAddProjectModal(prev => ({ ...prev, inputMode: 'dropdown' }))}>select from your repos</button>
                </p>
              </>
            )}
            {addProjectModal.repoMode === 'existing' && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetAddProjectModal}>Cancel</Button>
                <Button
                  onClick={addProjectModal.inputMode === 'dropdown' ? cloneSelectedRepo : cloneProject}
                  disabled={addProjectModal.step === 'cloning' || (addProjectModal.inputMode === 'dropdown' ? !addProjectModal.selectedRepo : !addProjectModal.githubUrl.trim())}
                >
                  {addProjectModal.step === 'cloning' ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Cloning...</>
                  ) : (
                    'Next'
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step: Spec */}
        {addProjectModal.step === 'spec' && (
          <div className="space-y-4">
            <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded text-green-700 dark:text-green-300 text-sm">
              Repository cloned: <span className="font-mono font-bold">{addProjectModal.projectId}</span>
            </div>

            {addProjectModal.hasSpec ? (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">spec.md already exists</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">This project already has a specification file.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="updateSpec"
                    checked={addProjectModal.updateSpec}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, updateSpec: e.target.checked }))}
                  />
                  <label htmlFor="updateSpec" className="text-sm text-neutral-700 dark:text-neutral-300">Update the spec</label>
                </div>
                {addProjectModal.updateSpec && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">What do you want to build?</label>
                      <textarea
                        className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        placeholder="Describe what you want to build..."
                        value={addProjectModal.whatToBuild}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, whatToBuild: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">How do you consider the project is success?</label>
                      <textarea
                        className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        placeholder="Define the success criteria..."
                        value={addProjectModal.successCriteria}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, successCriteria: e.target.value }))}
                      />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  No spec.md found. Describe your project so the AI agents know what to work on.
                </p>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">What do you want to build?</label>
                  <textarea
                    className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                    placeholder="Describe what you want to build..."
                    value={addProjectModal.whatToBuild}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, whatToBuild: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">How do you consider the project is success?</label>
                  <textarea
                    className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                    placeholder="Define the success criteria..."
                    value={addProjectModal.successCriteria}
                    onChange={(e) => setAddProjectModal(prev => ({ ...prev, successCriteria: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'url', error: null }))}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'budget', error: null }))}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step: Budget */}
        {addProjectModal.step === 'budget' && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Set a daily budget to control API spending. The orchestrator will pace cycles to stay within budget.
            </p>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Daily Budget (USD)</label>
              <div className="flex items-center gap-3">
                <span className="text-lg font-mono text-neutral-800 dark:text-neutral-200">$</span>
                <input
                  type="number"
                  min="0"
                  step="20"
                  className="w-32 px-3 py-2 border rounded-md text-lg font-mono dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-200"
                  value={addProjectModal.budgetPer24h}
                  onChange={(e) => setAddProjectModal(prev => ({ ...prev, budgetPer24h: e.target.value }))}
                />
                <span className="text-sm text-neutral-500 dark:text-neutral-400">per 24 hours</span>
              </div>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">
                Set to 0 for unlimited. Recommended: $20-100/day depending on agent count and model.
              </p>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'spec', error: null }))}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'confirm', error: null }))}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step: Confirm */}
        {addProjectModal.step === 'confirm' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Review before creating:</p>
            <div className="space-y-2 p-3 bg-neutral-50 dark:bg-neutral-900 rounded border border-neutral-200 dark:border-neutral-700">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">Repository</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200">{addProjectModal.projectId}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">Spec</span>
                <span className="text-neutral-800 dark:text-neutral-200">
                  {addProjectModal.hasSpec && !addProjectModal.updateSpec ? 'Existing (unchanged)' : addProjectModal.whatToBuild ? 'Will be created' : 'None'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">Daily Budget</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200">
                  {parseFloat(addProjectModal.budgetPer24h) > 0 ? `$${addProjectModal.budgetPer24h}/day` : 'Unlimited'}
                </span>
              </div>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-blue-700 dark:text-blue-300 text-sm">
              A fresh workspace will be created and the orchestrator will start running agents.
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'budget', error: null }))}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button onClick={finalizeAddProject}>
                Create Project
              </Button>
            </div>
          </div>
        )}

        {/* Step: Adding */}
        {addProjectModal.step === 'adding' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Adding project...</p>
          </div>
        )}
      </ModalContent>
    </Modal>
  )
}
