import React from 'react'
import { Sun, Moon, Monitor, Info } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { detectProvider } from '@/utils'

export default function SettingsPanel({
  settingsOpen,
  onClose,
  theme,
  setTheme,
  notificationsEnabled,
  toggleNotifications,
  detailedNotifs,
  setDetailedNotifs,
  setShowApiKeyHelp,
  globalTokenInput,
  setGlobalTokenInput,
  tokenSaving,
  setTokenSaving,
  setHasGlobalToken,
  setGlobalTokenType,
  setProviderTokens,
  setGlobalTokenPreview,
  setToast,
  providerTokens,
  codexLoginState,
  setCodexLoginState,
  authFetch,
}) {
  const notifSupported = typeof window !== 'undefined' && 'Notification' in window
  const notifPermission = notifSupported ? Notification.permission : 'default'

  const handleSaveToken = async () => {
    setTokenSaving(true)
    try {
      const res = await authFetch('/api/settings/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: globalTokenInput })
      })
      if (res.ok) {
        const d = await res.json()
        setHasGlobalToken(d.hasGlobalToken)
        setGlobalTokenType(d.tokenType || null)
        setProviderTokens(d.providers || {})
        fetch('/api/settings').then(r => r.json()).then(s => {
          setGlobalTokenPreview(s.globalTokenPreview || null)
          setGlobalTokenType(s.tokenType || null)
          setProviderTokens(s.providers || {})
        }).catch(() => {})
        setGlobalTokenInput('')
        setToast(`${detectProvider(globalTokenInput) || 'API'} key saved`)
      }
    } catch {}
    setTokenSaving(false)
  }

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
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-3">Paste any API key — provider is auto-detected from the key prefix.</p>
          <div className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                placeholder="Paste API key (Anthropic, OpenAI, or Google)..."
                value={globalTokenInput}
                onChange={e => setGlobalTokenInput(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
              />
              {globalTokenInput && detectProvider(globalTokenInput) && (
                <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">✓ {detectProvider(globalTokenInput)}</span>
              )}
              {globalTokenInput && !detectProvider(globalTokenInput) && (
                <span className="text-xs text-amber-500 whitespace-nowrap">? Unknown</span>
              )}
              <button
                onClick={handleSaveToken}
                disabled={tokenSaving || !globalTokenInput}
                className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {tokenSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
            {/* Show configured providers */}
            <div className="mt-3 space-y-1.5">
              {[
                { key: 'anthropic', label: 'Anthropic', color: 'text-orange-600 dark:text-orange-400' },
                { key: 'openai', label: 'OpenAI', color: 'text-green-600 dark:text-green-400' },
                { key: 'google', label: 'Google', color: 'text-blue-600 dark:text-blue-400' },
              ].map(({ key, label, color }) => {
                const info = providerTokens[key]
                return (
                  <div key={key} className="flex items-center justify-between text-xs py-1">
                    <span className={info?.hasToken ? color : 'text-neutral-400 dark:text-neutral-500'}>
                      {info?.hasToken ? '✓' : '○'} {label} {info?.preview ? `(${info.preview})` : ''}
                    </span>
                    {info?.hasToken && (
                      <button
                        onClick={async () => {
                          setTokenSaving(true)
                          try {
                            const res = await authFetch('/api/settings/token', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ token: '', provider: key })
                            })
                            if (res.ok) {
                              const d = await res.json()
                              setProviderTokens(d.providers || {})
                              setHasGlobalToken(d.hasGlobalToken)
                              setToast(`${label} key removed`)
                            }
                          } catch {}
                          setTokenSaving(false)
                        }}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )
              })}
              {/* OpenAI Codex (ChatGPT OAuth) */}
              <div className="flex items-center justify-between text-xs py-1">
                <span className={codexLoginState === 'success' ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}>
                  {codexLoginState === 'success' ? '✓' : '○'} OpenAI Codex (ChatGPT)
                </span>
                {codexLoginState === 'success' ? (
                  <button
                    onClick={async () => {
                      await authFetch('/api/openai-codex/logout', { method: 'POST' })
                      setCodexLoginState(null)
                      setToast('ChatGPT account disconnected')
                    }}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Disconnect
                  </button>
                ) : codexLoginState === 'waiting' ? (
                  <span className="text-xs text-blue-500 animate-pulse">Waiting for sign-in...</span>
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
                              setToast('ChatGPT account connected')
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
                    className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                  >
                    {codexLoginState === 'polling' ? 'Starting...' : codexLoginState === 'error' ? 'Retry Login' : 'Login'}
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
        </div>
      </PanelContent>
    </Panel>
  )
}
