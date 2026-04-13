import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'

export default function ProjectSettingsPanel({
  selectedProject,
  projectSettingsOpen,
  setProjectSettingsOpen,
  setProjSetting,
  notifUseGlobal,
  projNotifSettings,
  setShowApiKeyHelp,
  authFetch,
  projectApi,
  setToast,
  isWriteMode,
  config,
  setSelectedProject,
  fetchProjectData,
  fetchGlobalStatus,
  removeProject,
}) {
  const [keys, setKeys] = useState([])
  const [keySelection, setKeySelection] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!selectedProject) return
    // Fetch key pool and project key selection
    fetch('/api/keys').then(r => r.json()).then(d => setKeys(d.keys || [])).catch(() => {})
    fetch(projectApi('/config')).then(r => r.json()).then(d => {
      setKeySelection(d.keySelection || null)
    }).catch(() => {})
  }, [selectedProject?.id])

  if (!selectedProject) return null

  const selectedKeyId = keySelection?.keyId || null
  const fallbackEnabled = keySelection?.fallback !== false
  const defaultKey = keys.find(k => k.enabled)
  const selectedKey = selectedKeyId ? keys.find(k => k.id === selectedKeyId) : null
  // Detect stale pinned key (disabled or deleted)
  const pinnedKeyStale = selectedKeyId && (!selectedKey || !selectedKey.enabled)
  const effectiveKey = (selectedKey && selectedKey.enabled) ? selectedKey : defaultKey
  const hasModelOverrides = (models = {}) => !!(models.high || models.mid || models.low || models.xlow)

  const clearModelOverrides = async () => {
    const res = await authFetch(projectApi('/models'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: {} })
    })
    if (!res.ok) return false
    const d = await res.json()
    if (d.config) setSelectedProject(prev => ({ ...prev, config: d.config }))
    return true
  }

  const handleKeyChange = async (keyId) => {
    setSaving(true)
    try {
      const res = await authFetch(projectApi('/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId: keyId || null,
          fallback: fallbackEnabled,
        })
      })
      if (res.ok) {
        const d = await res.json()
        setKeySelection(d.keySelection || null)
        if (!keyId) {
          await clearModelOverrides()
          setToast('Using global default, model overrides cleared')
        } else {
          setToast('Key selection updated')
        }
      }
    } catch {}
    setSaving(false)
  }

  const handleFallbackChange = async (fallback) => {
    setSaving(true)
    try {
      const res = await authFetch(projectApi('/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId: selectedKeyId,
          fallback,
        })
      })
      if (res.ok) {
        const d = await res.json()
        setKeySelection(d.keySelection || null)
      }
    } catch {}
    setSaving(false)
  }

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

        {/* API Key Selection */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">API Key</h3>
            <button
              onClick={() => setShowApiKeyHelp(true)}
              className="text-neutral-400 hover:text-blue-500 dark:text-neutral-500 dark:hover:text-blue-400 transition-colors"
              title="How to get API keys"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Key selector */}
            <select
              value={selectedKeyId || ''}
              onChange={e => handleKeyChange(e.target.value || null)}
              disabled={saving}
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 ${pinnedKeyStale ? 'border-red-400 dark:border-red-600' : 'border-neutral-300 dark:border-neutral-600'}`}
            >
              <option value="">
                Use global default{defaultKey ? ` ("${defaultKey.label}")` : ''}
              </option>
              {pinnedKeyStale && (
                <option value={selectedKeyId} disabled>
                  ⚠️ {selectedKey ? selectedKey.label : selectedKeyId.slice(0, 8)} — disabled / unavailable
                </option>
              )}
              {keys.filter(k => k.enabled).map(k => (
                <option key={k.id} value={k.id}>
                  {k.label} — {k.provider} ({k.preview})
                </option>
              ))}
            </select>

            {pinnedKeyStale && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <span className="text-xs text-red-600 dark:text-red-400">
                  ⚠️ Selected key is {selectedKey ? 'disabled' : 'missing'}. Agents cannot run. Select a different key or switch to global default.
                </span>
              </div>
            )}

            {/* Effective key display */}
            {!pinnedKeyStale && effectiveKey && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700">
                <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  Using: <span className="font-medium text-neutral-800 dark:text-neutral-200">{effectiveKey.label}</span>
                  {' '}({effectiveKey.provider})
                </span>
              </div>
            )}

            {/* Fallback option — only show when a specific key is selected */}
            {selectedKeyId && (
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">Allow fallback</span>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                    Use other keys if this one hits rate limits
                  </p>
                </div>
                <button
                  onClick={() => handleFallbackChange(!fallbackEnabled)}
                  disabled={saving}
                  className={`relative w-11 h-6 rounded-full transition-colors ${fallbackEnabled ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${fallbackEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            )}

            {keys.length === 0 && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                No API keys configured. Add keys in global Settings.
              </p>
            )}
          </div>
        </div>

        {/* Model Overrides */}
        {isWriteMode && (() => {
          const canOverride = selectedKeyId && !fallbackEnabled && !pinnedKeyStale;
          const currentModels = selectedProject?.config?.models || {};
          const hasOverrides = !!(currentModels.high || currentModels.mid || currentModels.low || currentModels.xlow);
          const keyProvider = selectedKey?.provider || 'anthropic';
          const providerTiers = keyProvider === 'custom'
            ? (config?.tiers || {})
            : (config?.allTiers?.[keyProvider] || {});
          const availableModels = keyProvider === 'custom'
            ? []
            : (config?.availableModels?.[keyProvider] || []);

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
              <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Model Overrides</h3>
              {canOverride && (
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
                      for (const tier of ['high', 'mid', 'low', 'xlow']) {
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
              )}
            </div>
            {!canOverride ? (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                To override models, select a specific API key above and disable fallback. This locks the project to one provider so models can be customized.
              </p>
            ) : hasOverrides ? (
              <div className="space-y-2">
                {['high', 'mid', 'low', 'xlow'].map(tier => (
                  <div key={tier} className="flex items-center gap-2">
                    <span className={`text-xs font-bold w-10 shrink-0 ${tier === 'high' ? 'text-purple-500' : tier === 'mid' ? 'text-blue-500' : tier === 'xlow' ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-400'}`}>{tier.toUpperCase()}</span>
                    {keyProvider === 'custom' ? (
                      <input
                        type="text"
                        value={currentModels[tier] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const models = { ...currentModels };
                          if (val) models[tier] = val; else delete models[tier];
                          setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models } } : prev);
                          saveModels(models);
                        }}
                        placeholder={`Default (${providerTiers[tier]?.model || '—'})`}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                      />
                    ) : (
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
                        <option value="">Default ({providerTiers[tier]?.model || '—'}{providerTiers[tier]?.reasoningEffort ? ` (${providerTiers[tier].reasoningEffort})` : ''})</option>
                        {availableModels.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {keyProvider === 'custom'
                  ? 'Using the selected custom credential defaults. Enable to enter models per tier manually.'
                  : `Using ${keyProvider} defaults. Enable to customize models per tier.`}
              </p>
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
                    if (!confirm('This will delete all project data, agent skills, and history. Really delete?')) return
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
