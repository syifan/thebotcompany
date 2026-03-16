import React, { useState, useEffect } from 'react'
import { Sun, Moon, Monitor, Info, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'

import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/contexts/NotificationContext'
import { useToast } from '@/contexts/ToastContext'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (API Key)' },
  { value: 'anthropic-oauth', label: 'Anthropic (OAuth Token)', type: 'oauth', provider: 'anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'openai-codex', label: 'OpenAI Codex' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'amazon-bedrock', label: 'Amazon Bedrock' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'github-copilot', label: 'GitHub Copilot' },
  { value: 'google-vertex', label: 'Google Vertex' },
  { value: 'groq', label: 'Groq' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'kimi-coding', label: 'Kimi Coding' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'xai', label: 'xAI' },
]

const PROVIDER_COLORS = {
  anthropic: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
  openai: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
  google: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30',
  minimax: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30',
  'openai-codex': 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30',
}

function ProviderBadge({ provider }) {
  const label = provider === 'openai-codex' ? 'Codex' : (provider || 'Unknown')
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${PROVIDER_COLORS[provider] || 'text-neutral-500 bg-neutral-100 dark:bg-neutral-800'}`}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  )
}

export default function SettingsPanel({
  settingsOpen,
  onClose,
  theme,
  setTheme,
  setShowApiKeyHelp,
}) {
  const { authFetch } = useAuth()
  const { notificationsEnabled, toggleNotifications, detailedNotifs, setDetailedNotifs } = useNotifications()
  const { showToast } = useToast()

  const [keys, setKeys] = useState([])
  const [newToken, setNewToken] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newProvider, setNewProvider] = useState('')
  const [saving, setSaving] = useState(false)
  const [codexLoginState, setCodexLoginState] = useState(null)
  const [editingLabel, setEditingLabel] = useState(null)
  const [editLabelValue, setEditLabelValue] = useState('')

  const fetchKeys = () => {
    fetch('/api/keys').then(r => r.json()).then(d => {
      setKeys(d.keys || [])
    }).catch(() => {})
  }

  useEffect(() => {
    fetchKeys()
    fetch('/api/openai-codex/status').then(r => r.json()).then(d => {
      if (d.authenticated) setCodexLoginState('success')
    }).catch(() => {})
  }, [])

  const handleAddKey = async () => {
    if (!newToken || !newProvider) return
    setSaving(true)
    try {
      const providerDef = PROVIDERS.find(p => p.value === newProvider)
      const actualProvider = providerDef?.provider || newProvider
      const keyType = providerDef?.type || 'api_key'
      const res = await authFetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: newToken,
          provider: actualProvider,
          type: keyType,
          label: newLabel || providerDef?.label || newProvider,
        })
      })
      if (res.ok) {
        const d = await res.json()
        setKeys(d.keys || [])
        setNewToken('')
        setNewLabel('')
        setNewProvider('')
        showToast(`${providerDef?.label || newProvider} key added`)
      }
    } catch {}
    setSaving(false)
  }

  const handleRemoveKey = async (id) => {
    try {
      const res = await authFetch(`/api/keys/${id}`, { method: 'DELETE' })
      if (res.ok) {
        const d = await res.json()
        setKeys(d.keys || [])
        showToast('Key removed')
      }
    } catch {}
  }

  const handleToggleEnabled = async (id, enabled) => {
    try {
      const res = await authFetch(`/api/keys/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
      if (res.ok) {
        const d = await res.json()
        setKeys(d.keys || [])
      }
    } catch {}
  }

  const handleReorder = async (id, direction) => {
    const idx = keys.findIndex(k => k.id === id)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= keys.length) return
    const newOrder = [...keys]
    const tmp = newOrder[idx]
    newOrder[idx] = newOrder[swapIdx]
    newOrder[swapIdx] = tmp
    const orderedIds = newOrder.map(k => k.id)
    setKeys(newOrder)
    try {
      const res = await authFetch('/api/keys/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds })
      })
      if (res.ok) {
        const d = await res.json()
        setKeys(d.keys || [])
      }
    } catch {}
  }

  const handleSaveLabel = async (id) => {
    try {
      const res = await authFetch(`/api/keys/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabelValue })
      })
      if (res.ok) {
        const d = await res.json()
        setKeys(d.keys || [])
      }
    } catch {}
    setEditingLabel(null)
  }

  const notifSupported = typeof window !== 'undefined' && 'Notification' in window
  const notifPermission = notifSupported ? Notification.permission : 'default'

  return (
    <Panel id="settings" open={settingsOpen} onClose={onClose}>
      <PanelHeader onClose={onClose}>Settings</PanelHeader>
      <PanelContent>
        <div className="pb-5">
          <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Display</h3>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Theme</span>
            <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-700 rounded-lg p-0.5">
              <button
                onClick={() => setTheme('light')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${theme === 'light' ? 'bg-white dark:bg-neutral-600 shadow text-neutral-800 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
              >
                <Sun className="w-3.5 h-3.5 inline mr-1" />Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${theme === 'dark' ? 'bg-white dark:bg-neutral-600 shadow text-neutral-800 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
              >
                <Moon className="w-3.5 h-3.5 inline mr-1" />Dark
              </button>
              <button
                onClick={() => setTheme('system')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${theme === 'system' ? 'bg-white dark:bg-neutral-600 shadow text-neutral-800 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
              >
                <Monitor className="w-3.5 h-3.5 inline mr-1" />System
              </button>
            </div>
          </div>
        </div>
        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5 pb-5">
          <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Notifications</h3>
          <div className="flex items-center justify-between py-2">
            <div>
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Push Notifications</span>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                {!notifSupported ? 'Not supported in this browser' :
                 notifPermission === 'denied' ? 'Blocked by browser — enable in settings' :
                 'Get notified about milestones, verifications, and errors'}
              </p>
            </div>
            <button
              onClick={toggleNotifications}
              className={`relative w-11 h-6 rounded-full transition-colors ${notificationsEnabled ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notificationsEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between py-2 mt-1">
            <div>
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Detailed Notifications</span>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                Push notification for every agent response
              </p>
            </div>
            <button
              onClick={() => {
                const next = !detailedNotifs
                setDetailedNotifs(next)
                localStorage.setItem('tbc_detailed_notifs', String(next))
              }}
              className={`relative w-11 h-6 rounded-full transition-colors ${detailedNotifs ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${detailedNotifs ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
        {/* Credentials Section */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Credentials</h3>
            <button
              onClick={() => setShowApiKeyHelp(true)}
              className="text-neutral-400 hover:text-blue-500 dark:text-neutral-500 dark:hover:text-blue-400 transition-colors"
              title="How to get API keys"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-3">
            Add API keys or OAuth tokens. Keys are tried in order during agent runs.
          </p>

          {/* Add credential form */}
          <div className="space-y-2 mb-4">
            <input
              type="password"
              placeholder="Paste API key or OAuth token..."
              value={newToken}
              onChange={e => {
                setNewToken(e.target.value)
                if (!newProvider) {
                  const v = e.target.value
                  if (v.startsWith('sk-ant-oat')) setNewProvider('anthropic-oauth')
                  else if (v.startsWith('sk-ant-')) setNewProvider('anthropic')
                  else if (v.startsWith('sk-proj-') || v.startsWith('sk-')) setNewProvider('openai')
                  else if (v.startsWith('AIzaSy')) setNewProvider('google')
                }
              }}
              className="w-full px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
            />
            <div className="flex items-center gap-2">
              <select
                value={newProvider}
                onChange={e => setNewProvider(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
              >
                <option value="">Select provider...</option>
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
              />
            </div>
            <button
              onClick={handleAddKey}
              disabled={saving || !newToken || !newProvider}
              className="w-full px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>

          {/* Credential list — all keys (API + OAuth tokens) */}
          <div className="space-y-1">
            {keys.map((key, idx) => (
              <div
                key={key.id}
                className={`flex items-center gap-2 p-2 rounded-lg border ${
                  key.enabled
                    ? key.rateLimited
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20'
                      : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50'
                    : 'border-neutral-200 dark:border-neutral-700 bg-neutral-100/50 dark:bg-neutral-900/50 opacity-60'
                }`}
              >
                <span className="text-xs text-neutral-400 dark:text-neutral-500 w-4 text-right shrink-0">{idx + 1}.</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  !key.enabled ? 'bg-neutral-300 dark:bg-neutral-600' :
                  key.rateLimited ? 'bg-amber-400 animate-pulse' :
                  'bg-green-400'
                }`} />
                <div className="flex-1 min-w-0">
                  {editingLabel === key.id ? (
                    <input
                      type="text"
                      value={editLabelValue}
                      onChange={e => setEditLabelValue(e.target.value)}
                      onBlur={() => handleSaveLabel(key.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveLabel(key.id); if (e.key === 'Escape') setEditingLabel(null); }}
                      autoFocus
                      className="text-xs font-medium w-full px-1 py-0.5 bg-white dark:bg-neutral-700 border border-blue-400 rounded"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingLabel(key.id); setEditLabelValue(key.label); }}
                      className="text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-blue-500 dark:hover:text-blue-400 truncate block text-left"
                      title="Click to edit label"
                    >
                      {key.label}
                    </button>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <ProviderBadge provider={key.provider} />
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      key.type === 'oauth'
                        ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/30'
                        : 'text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800'
                    }`}>
                      {key.type === 'oauth' ? 'OAuth' : 'API Key'}
                    </span>
                    <code className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{key.preview}</code>
                    {key.rateLimited && (
                      <span className="text-xs text-amber-500">rate limited</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => handleReorder(key.id, 'up')} disabled={idx === 0} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30" title="Move up"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleReorder(key.id, 'down')} disabled={idx === keys.length - 1} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30" title="Move down"><ChevronDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleToggleEnabled(key.id, !key.enabled)} className={`px-2 py-0.5 text-xs rounded ${key.enabled ? 'text-amber-600 hover:text-amber-700 dark:text-amber-400' : 'text-green-600 hover:text-green-700 dark:text-green-400'}`}>{key.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => handleRemoveKey(key.id)} className="p-1 text-red-400 hover:text-red-600 dark:hover:text-red-300" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            {keys.length === 0 && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 py-2">No credentials configured. Add one above.</p>
            )}
          </div>

          {/* OpenAI Codex (ChatGPT) browser-based OAuth login */}
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-700/50">
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-2">
              Or connect via browser sign-in:
            </p>
            <div className="flex items-center justify-between p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
              <div>
                <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">OpenAI Codex (ChatGPT)</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <ProviderBadge provider="openai-codex" />
                  <span className={`text-xs ${codexLoginState === 'success' ? 'text-green-500' : 'text-neutral-400 dark:text-neutral-500'}`}>
                    {codexLoginState === 'success' ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              </div>
              {codexLoginState === 'success' ? (
                <button
                  onClick={async () => {
                    await authFetch('/api/openai-codex/logout', { method: 'POST' })
                    setCodexLoginState(null)
                    showToast('ChatGPT account disconnected')
                    fetchKeys()
                  }}
                  className="px-2 py-1 text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  Disconnect
                </button>
              ) : codexLoginState === 'waiting' ? (
                <span className="text-xs text-blue-500 animate-pulse px-2">Waiting for sign-in...</span>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      setCodexLoginState('polling')
                      const res = await authFetch('/api/openai-codex/login', { method: 'POST' })
                      if (!res.ok) throw new Error('Failed')
                      const data = await res.json()
                      setCodexLoginState('waiting')
                      window.open(data.authorization_url, '_blank')
                      const pollInterval = setInterval(async () => {
                        try {
                          const statusRes = await fetch('/api/openai-codex/status')
                          const status = await statusRes.json()
                          if (status.authenticated) {
                            clearInterval(pollInterval)
                            setCodexLoginState('success')
                            showToast('ChatGPT account connected')
                            fetchKeys()
                          }
                        } catch {}
                      }, 3000)
                      setTimeout(() => {
                        clearInterval(pollInterval)
                        setCodexLoginState(prev => prev === 'success' ? prev : 'error')
                      }, 300000)
                    } catch {
                      setCodexLoginState('error')
                    }
                  }}
                  disabled={codexLoginState === 'polling'}
                  className="px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  {codexLoginState === 'polling' ? 'Starting...' : codexLoginState === 'error' ? 'Retry' : 'Connect'}
                </button>
              )}
            </div>
            {codexLoginState === 'waiting' && (
              <div className="mt-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs">
                <p className="text-blue-700 dark:text-blue-300">Complete sign-in in the browser tab that just opened.</p>
              </div>
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  )
}
