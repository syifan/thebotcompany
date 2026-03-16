import React from 'react'
import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { detectProvider } from '@/utils'

export default function ProjectSettingsPanel({
  selectedProject,
  projectSettingsOpen,
  setProjectSettingsOpen,
  setProjSetting,
  notifUseGlobal,
  projNotifSettings,
  setShowApiKeyHelp,
  hasProjectToken,
  projectTokenPreview,
  projectTokenProviderLabel,
  projectTokenSaving,
  setProjectTokenSaving,
  authFetch,
  projectApi,
  setHasProjectToken,
  setProjectTokenPreview,
  setProjectTokenProviderLabel,
  setToast,
  projectTokenInput,
  setProjectTokenInput,
  projectTokenProvider,
  setProjectTokenProvider,
  projectCodexLoginState,
  setProjectCodexLoginState,
  codexLoginState,
  isWriteMode,
  config,
  setSelectedProject,
  fetchProjectData,
  fetchGlobalStatus,
  removeProject,
  hasGlobalToken,
  globalTokenPreview,
}) {
  if (!selectedProject) return null

  return (
    <Panel id="project-settings" open={projectSettingsOpen} onClose={() => setProjectSettingsOpen(false)}>
      <PanelHeader onClose={() => setProjectSettingsOpen(false)}>Project Settings</PanelHeader>
      <PanelContent>
        {/* Notifications section */}
        <div className="pb-5">
          <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Notifications</h3>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Use Global Setting</span>
            <button
              onClick={() => setProjSetting('notifs', { useGlobal: !notifUseGlobal })}
              className={`relative w-11 h-6 rounded-full transition-colors ${notifUseGlobal ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifUseGlobal ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className={notifUseGlobal ? 'opacity-40 pointer-events-none' : ''}>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Push Notifications</span>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Milestones, verifications, and errors</p>
              </div>
              <button
                onClick={() => setProjSetting('notifs', { push: !(projNotifSettings.push !== false) })}
                className={`relative w-11 h-6 rounded-full transition-colors ${projNotifSettings.push !== false ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${projNotifSettings.push !== false ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Detailed Notifications</span>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Push on every agent response</p>
              </div>
              <button
                onClick={() => setProjSetting('notifs', { detailed: !projNotifSettings.detailed })}
                className={`relative w-11 h-6 rounded-full transition-colors ${projNotifSettings.detailed ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${projNotifSettings.detailed ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Models section */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Models</h3>
            <button
              onClick={() => setShowApiKeyHelp(true)}
              className="text-neutral-400 hover:text-blue-500 dark:text-neutral-500 dark:hover:text-blue-400 transition-colors"
              title="How to get API keys"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
          <div className="py-2 space-y-3">
            {/* Current key status */}
            {hasProjectToken ? (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 shrink-0">
                    {projectTokenProviderLabel ? projectTokenProviderLabel.charAt(0).toUpperCase() + projectTokenProviderLabel.slice(1) : detectProvider(projectTokenPreview) || 'API Key'}
                  </span>
                  <code className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{projectTokenPreview}</code>
                </div>
                <button
                  onClick={async () => {
                    setProjectTokenSaving(true)
                    try {
                      const res = await authFetch(projectApi('/token'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: '' })
                      })
                      if (res.ok) {
                        setHasProjectToken(false)
                        setProjectTokenPreview(null)
                        setProjectTokenProviderLabel(null)
                        setToast('Project token removed')
                      }
                    } catch {}
                    setProjectTokenSaving(false)
                  }}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {hasGlobalToken ? `Using global token (${globalTokenPreview})` : 'No token configured'}
              </p>
            )}
            {/* Input for new key */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select
                  value={projectTokenProvider}
                  onChange={e => setProjectTokenProvider(e.target.value)}
                  className="w-full sm:w-40 shrink-0 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
                >
                  <option value="">Provider...</option>
                  <option value="anthropic">Anthropic (API Key)</option>
                  <option value="anthropic-oauth">Anthropic (OAuth)</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google (Gemini)</option>
                  <option value="minimax">MiniMax</option>
                </select>
                <input
                  type="password"
                  placeholder={hasProjectToken ? 'Replace with new key...' : 'Paste API key...'}
                  value={projectTokenInput}
                  onChange={e => setProjectTokenInput(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
                />
                <button
                  onClick={async () => {
                    if (!projectTokenProvider || !projectTokenInput) return
                    setProjectTokenSaving(true)
                    try {
                      const providerValue = projectTokenProvider === 'anthropic-oauth' ? 'anthropic' : projectTokenProvider
                      const res = await authFetch(projectApi('/token'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: projectTokenInput, provider: providerValue })
                      })
                      if (res.ok) {
                        const d = await res.json()
                        setHasProjectToken(d.hasProjectToken)
                        setProjectTokenPreview(d.hasProjectToken ? projectTokenInput.slice(0, 4) + '****' + projectTokenInput.slice(-4) : null)
                        setProjectTokenProviderLabel(providerValue)
                        setProjectTokenInput('')
                        setProjectTokenProvider('')
                        setToast(`${providerValue.charAt(0).toUpperCase() + providerValue.slice(1)} key saved`)
                      }
                    } catch {}
                    setProjectTokenSaving(false)
                  }}
                  disabled={projectTokenSaving || !projectTokenProvider || !projectTokenInput}
                  className="px-3 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 shrink-0"
                >
                  {projectTokenSaving ? '...' : 'Save'}
                </button>
              </div>
            </div>
            {/* OpenAI Codex (ChatGPT OAuth) — per-project */}
            <div className="flex items-center justify-between text-xs py-1 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-700/50">
              <span className={projectCodexLoginState === 'success' ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}>
                {projectCodexLoginState === 'success' ? '✓' : '○'} OpenAI Codex (ChatGPT)
              </span>
              {projectCodexLoginState === 'success' ? (
                <button
                  onClick={async () => {
                    await authFetch(`/api/openai-codex/logout?project=${encodeURIComponent(selectedProject.id)}`, { method: 'POST' })
                    setProjectCodexLoginState(null)
                    setToast('Project ChatGPT account disconnected')
                  }}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Disconnect
                </button>
              ) : projectCodexLoginState === 'waiting' ? (
                <span className="text-xs text-blue-500 animate-pulse">Waiting for sign-in...</span>
              ) : (
                <button
                  onClick={async () => {
                    if (!selectedProject?.id) return
                    try {
                      setProjectCodexLoginState('polling')
                      const res = await authFetch(`/api/openai-codex/login?project=${encodeURIComponent(selectedProject.id)}`, { method: 'POST' })
                      if (!res.ok) throw new Error('Failed')
                      const data = await res.json()
                      setProjectCodexLoginState('waiting')
                      window.open(data.authorization_url, '_blank')
                      const pollInterval = setInterval(async () => {
                        try {
                          const statusRes = await fetch(`/api/openai-codex/status?project=${encodeURIComponent(selectedProject.id)}`)
                          const status = await statusRes.json()
                          if (status.authenticated) {
                            clearInterval(pollInterval)
                            setProjectCodexLoginState('success')
                            setToast('Project ChatGPT account connected')
                          }
                        } catch {}
                      }, 3000)
                      setTimeout(() => {
                        clearInterval(pollInterval)
                        setProjectCodexLoginState(prev => prev === 'success' ? prev : null)
                      }, 300000)
                    } catch {
                      setProjectCodexLoginState(null)
                    }
                  }}
                  disabled={projectCodexLoginState === 'polling'}
                  className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                >
                  {projectCodexLoginState === 'polling' ? 'Starting...' : 'Login'}
                </button>
              )}
            </div>
            {projectCodexLoginState === 'waiting' && (
              <div className="mt-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs">
                <p className="text-blue-700 dark:text-blue-300">Complete sign-in in the browser tab that just opened.</p>
              </div>
            )}
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">
              {codexLoginState === 'success' && projectCodexLoginState !== 'success' ? 'Using global ChatGPT login' : ''}
            </p>
          </div>
        </div>

        {/* Model Tiers */}
        {isWriteMode && (() => {
          const currentModels = selectedProject?.config?.models || {};
          const hasOverrides = !!(currentModels.high || currentModels.mid || currentModels.low);
          const provider = config?.provider || 'anthropic';
          const providerTiers = config?.tiers || {};
          const providerModels = [...new Set(Object.values(providerTiers).map(t => t.model).filter(Boolean))];
          const allTiers = config?.allTiers || {};
          const allModels = [...new Set(Object.values(allTiers).flatMap(p => Object.values(p).map(t => t.model)).filter(Boolean))];

          const saveModels = async (models) => {
            try {
              await authFetch(projectApi('/models'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ models })
              });
              await fetchProjectData();
            } catch {}
          };

          return (
          <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5 mt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Manual Model Selection</h3>
              <button
                type="button"
                role="switch"
                aria-checked={hasOverrides}
                onClick={() => {
                  if (hasOverrides) {
                    setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models: {} } } : prev);
                    saveModels({}).then(() => setToast('Model overrides disabled'));
                  } else {
                    const defaults = {};
                    for (const tier of ['high', 'mid', 'low']) {
                      if (providerTiers[tier]) defaults[tier] = providerTiers[tier].model;
                    }
                    setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models: defaults } } : prev);
                    saveModels(defaults).then(() => setToast('Model overrides enabled'));
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${hasOverrides ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${hasOverrides ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {hasOverrides ? (
              <div className="space-y-2">
                {['high', 'mid', 'low'].map(tier => (
                  <div key={tier} className="flex items-center gap-2">
                    <span className={`text-xs font-bold w-10 shrink-0 ${tier === 'high' ? 'text-purple-500' : tier === 'mid' ? 'text-blue-500' : 'text-neutral-400'}`}>{tier.toUpperCase()}</span>
                    <select
                      value={currentModels[tier] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const models = { ...currentModels };
                        if (val) models[tier] = val; else delete models[tier];
                        setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models } } : prev);
                        saveModels(models);
                      }}
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                    >
                      <option value="">Default ({providerTiers[tier]?.model || '—'})</option>
                      {providerModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {allModels.filter(m => !providerModels.includes(m)).length > 0 && (
                        <optgroup label="Other providers">
                          {allModels.filter(m => !providerModels.includes(m)).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">Using global defaults ({provider}). Enable to customize per tier.</p>
            )}
          </div>
          );
        })()}

        {/* Danger Zone */}
        {isWriteMode && (
          <div className="border-t border-red-200 dark:border-red-900 pt-5 mt-5">
            <h3 className="text-sm font-semibold text-red-500 dark:text-red-400 uppercase tracking-wider mb-3">Danger Zone</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {selectedProject?.archived ? 'Unarchive Project' : 'Archive Project'}
                  </span>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                    {selectedProject?.archived ? 'Restore this project to the active dashboard' : 'Hide from dashboard. Data is preserved.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const action = selectedProject?.archived ? 'unarchive' : 'archive'
                    try {
                      await authFetch(projectApi(`/${action}`), { method: 'POST' })
                      await fetchGlobalStatus()
                      await fetchProjectData()
                      setToast(action === 'archive' ? 'Project archived' : 'Project unarchived')
                    } catch {}
                  }}
                >
                  {selectedProject?.archived ? 'Unarchive' : 'Archive'}
                </Button>
              </div>
              <div className="flex items-center justify-between p-3 border border-red-200 dark:border-red-800 rounded-lg bg-red-50/50 dark:bg-red-950/20">
                <div>
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">Delete Project</span>
                  <p className="text-xs text-red-400 dark:text-red-500 mt-0.5">Permanently remove this project and all data</p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`Are you sure you want to permanently delete "${selectedProject?.id}"? This cannot be undone.`)) return
                    if (!confirm('This will delete all workspace data, agent skills, and history. Really delete?')) return
                    try {
                      await removeProject(selectedProject.id)
                      setProjectSettingsOpen(false)
                    } catch {}
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
