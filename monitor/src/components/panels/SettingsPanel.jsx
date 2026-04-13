import React, { useState, useEffect } from 'react'
import { Sun, Moon, Monitor, Info, ChevronUp, ChevronDown, Trash2, Plus, X, ChevronRight, ArrowLeft } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import ProviderSelector, { PROVIDERS, ProviderBadge } from '@/components/ui/ProviderSelector'

import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/contexts/NotificationContext'
import { useToast } from '@/contexts/ToastContext'

// ---------------------------------------------------------------------------
// Add Credential Wizard
// ---------------------------------------------------------------------------

function formatCooldown(cooldownMs) {
  const ms = Math.max(0, Number(cooldownMs) || 0)
  if (!ms) return null
  const totalSeconds = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m left`
  if (minutes > 0) return `${minutes}m ${seconds}s left`
  return `${seconds}s left`
}

function CustomCredentialFields({
  token,
  setToken,
  baseUrl,
  setBaseUrl,
  apiStyle,
  setApiStyle,
  defaultModel,
  setDefaultModel,
  tierModels,
  setTierModels,
  tokenLabel = 'API Key',
  tokenPlaceholder = 'Paste your API key...',
}) {
  return (
    <div className="space-y-2">
      <input
        type="password"
        placeholder={tokenPlaceholder}
        value={token}
        onChange={e => setToken(e.target.value)}
        autoFocus
        className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
        aria-label={tokenLabel}
      />
      <input
        type="text"
        placeholder="Base URL (e.g. https://gateway.example.com/v1)"
        value={baseUrl}
        onChange={e => setBaseUrl(e.target.value)}
        className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
      />
      <select
        value={apiStyle}
        onChange={e => setApiStyle(e.target.value)}
        className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
      >
        <option value="openai">OpenAI-compatible</option>
        <option value="anthropic">Anthropic-compatible</option>
      </select>
      <input
        type="text"
        placeholder="Default model (required)"
        value={defaultModel}
        onChange={e => setDefaultModel(e.target.value)}
        className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
      />
      <div className="grid grid-cols-2 gap-2">
        {['high', 'mid', 'low', 'xlow'].map(tier => (
          <input
            key={tier}
            type="text"
            placeholder={`${tier.toUpperCase()} model (optional)`}
            value={tierModels[tier] || ''}
            onChange={e => setTierModels(prev => ({ ...prev, [tier]: e.target.value }))}
            className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
          />
        ))}
      </div>
    </div>
  )
}

function EditCustomCredentialCard({ credential, authFetch, onComplete, onCancel }) {
  const [label, setLabel] = useState(credential.label || '')
  const [token, setToken] = useState('')
  const [baseUrl, setBaseUrl] = useState(credential.customConfig?.baseUrl || '')
  const [apiStyle, setApiStyle] = useState(credential.customConfig?.apiStyle || 'openai')
  const [defaultModel, setDefaultModel] = useState(credential.customConfig?.defaultModel || '')
  const [tierModels, setTierModels] = useState({
    high: credential.customConfig?.tierModels?.high || '',
    mid: credential.customConfig?.tierModels?.mid || '',
    low: credential.customConfig?.tierModels?.low || '',
    xlow: credential.customConfig?.tierModels?.xlow || '',
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const customConfig = {
        apiStyle,
        baseUrl,
        defaultModel,
      }
      const trimmedTierModels = Object.fromEntries(
        Object.entries(tierModels).filter(([, value]) => value.trim())
      )
      if (Object.keys(trimmedTierModels).length > 0) {
        customConfig.tierModels = trimmedTierModels
      }
      const body = {
        label,
        customConfig,
      }
      if (token.trim()) body.token = token.trim()
      const res = await authFetch(`/api/keys/${credential.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        onComplete()
        return
      }
    } catch {}
    setSaving(false)
  }

  return (
    <div className="mb-4 border border-cyan-200 dark:border-cyan-800 rounded-lg p-3 bg-cyan-50/50 dark:bg-cyan-950/20">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Edit Custom Credential</h4>
        <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-2">
        <input
          type="text"
          placeholder="Credential label"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
        />
        <CustomCredentialFields
          token={token}
          setToken={setToken}
          baseUrl={baseUrl}
          setBaseUrl={setBaseUrl}
          apiStyle={apiStyle}
          setApiStyle={setApiStyle}
          defaultModel={defaultModel}
          setDefaultModel={setDefaultModel}
          tierModels={tierModels}
          setTierModels={setTierModels}
          tokenLabel="Replacement API Key"
          tokenPlaceholder="Replace API key (leave blank to keep current)"
        />
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleSave}
          disabled={saving || !label.trim() || !baseUrl.trim() || !defaultModel.trim()}
          className="flex-1 px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Custom Credential'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm font-medium border rounded-lg border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function AddCredentialWizard({ onComplete, onCancel, authFetch, excludeProviders }) {
  const [step, setStep] = useState('provider') // provider → method → action → oauth_callback → label
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [selectedMethod, setSelectedMethod] = useState(null) // 'api_key' | 'oauth'
  const [token, setToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiStyle, setApiStyle] = useState('openai')
  const [defaultModel, setDefaultModel] = useState('')
  const [tierModels, setTierModels] = useState({ high: '', mid: '', low: '', xlow: '' })
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)

  // OAuth flow state
  const [oauthState, setOauthState] = useState('idle') // idle → starting → waiting → paste → success → error
  const [authUrl, setAuthUrl] = useState(null)
  const [flowId, setFlowId] = useState(null)
  const [pasteUrl, setPasteUrl] = useState('')

  const providerDef = PROVIDERS.find(p => p.id === selectedProvider)

  // Step 1: Select provider
  if (step === 'provider') {
    return (
      <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step 1: Select Provider</h4>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>
        <ProviderSelector exclude={excludeProviders} onSelect={(p) => {
          setSelectedProvider(p.id)
          if (p.methods.length === 1) {
            setSelectedMethod(p.methods[0])
            setStep('action')
          } else {
            setStep('method')
          }
        }} />
      </div>
    )
  }

  // Step 2: Select method (only if provider supports multiple)
  if (step === 'method') {
    return (
      <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep('provider')} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><ArrowLeft className="w-4 h-4" /></button>
            <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step 2: {providerDef?.label} — Choose Method</h4>
          </div>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-2">
          {providerDef?.methods.includes('api_key') && (
            <button
              onClick={() => { setSelectedMethod('api_key'); setStep('action') }}
              className="w-full text-left px-4 py-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Paste API Key</div>
              <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Enter an API key from your provider dashboard</div>
            </button>
          )}
          {providerDef?.methods.includes('setup_token') && (
            <button
              onClick={() => { setSelectedMethod('setup_token'); setStep('action') }}
              className="w-full text-left px-4 py-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Paste Setup Token</div>
              <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Run <code className="bg-neutral-100 dark:bg-neutral-700 px-1 rounded">claude setup-token</code> in your terminal to get an OAuth token</div>
            </button>
          )}
          {providerDef?.methods.includes('oauth') && (
            <button
              onClick={() => { setSelectedMethod('oauth'); setStep('action') }}
              className="w-full text-left px-4 py-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Browser Sign-In (OAuth)</div>
              <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Sign in with your account — works remotely via redirect URL paste</div>
            </button>
          )}
        </div>
      </div>
    )
  }

  // Step 3: Action (paste key, setup token, or OAuth flow)
  if (step === 'action') {
    // Setup token (e.g., `claude setup-token`)
    if (selectedMethod === 'setup_token') {
      return (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setStep('method')} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><ArrowLeft className="w-4 h-4" /></button>
              <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step 3: {providerDef?.label} — Setup Token</h4>
            </div>
            <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-2 mb-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
            <p>1. Open a terminal on the machine where Claude Code is installed</p>
            <p>2. Run: <code className="bg-white dark:bg-neutral-700 px-1.5 py-0.5 rounded font-mono">claude setup-token</code></p>
            <p>3. Follow the prompts to authenticate with your Claude Pro/Max account</p>
            <p>4. Copy the generated token (starts with <code className="bg-white dark:bg-neutral-700 px-1 rounded">sk-ant-oat-</code>) and paste it below</p>
          </div>
          <input
            type="password"
            placeholder="Paste your setup token (sk-ant-oat-...)..."
            value={token}
            onChange={e => setToken(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200 mb-2"
          />
          <button
            onClick={() => { if (token) setStep('label') }}
            disabled={!token}
            className="w-full px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }

    // API key paste
    if (selectedMethod === 'api_key') {
      const isCustomProvider = selectedProvider === 'custom'
      const canContinue = isCustomProvider
        ? !!token.trim() && !!baseUrl.trim() && !!defaultModel.trim()
        : !!token
      return (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button onClick={() => providerDef?.methods.length > 1 ? setStep('method') : setStep('provider')} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><ArrowLeft className="w-4 h-4" /></button>
              <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step 3: {providerDef?.label} — Paste API Key</h4>
            </div>
            <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
          </div>
          {isCustomProvider ? (
            <CustomCredentialFields
              token={token}
              setToken={setToken}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              apiStyle={apiStyle}
              setApiStyle={setApiStyle}
              defaultModel={defaultModel}
              setDefaultModel={setDefaultModel}
              tierModels={tierModels}
              setTierModels={setTierModels}
            />
          ) : (
            <input
              type="password"
              placeholder="Paste your API key..."
              value={token}
              onChange={e => setToken(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200 mb-2"
            />
          )}
          <button
            onClick={() => { if (canContinue) setStep('label') }}
            disabled={!canContinue}
            className="w-full px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }

    // OAuth flow
    if (selectedMethod === 'oauth') {
      const startOAuth = async () => {
        setOauthState('starting')
        setPasteUrl('')
        try {
          // Open blank window synchronously for popup blocker avoidance
          const authWindow = window.open('about:blank', '_blank')
          const res = await authFetch('/api/oauth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: providerDef?.oauthProviderId || selectedProvider })
          })
          if (!res.ok) throw new Error('Failed to start login')
          const data = await res.json()
          setFlowId(data.flowId)
          setAuthUrl(data.authorization_url)
          setOauthState('waiting')
          setStep('oauth_callback')

          if (authWindow && data.authorization_url) {
            authWindow.location.href = data.authorization_url
          } else if (authWindow) {
            authWindow.close()
          }

          // Poll for completion
          const pollInterval = setInterval(async () => {
            try {
              const statusRes = await fetch(`/api/oauth/status?provider=${providerDef?.oauthProviderId || selectedProvider}`)
              const status = await statusRes.json()
              if (status.authenticated) {
                clearInterval(pollInterval)
                setOauthState('success')
              }
            } catch {}
          }, 3000)
          setTimeout(() => {
            clearInterval(pollInterval)
            setOauthState(prev => prev === 'success' ? prev : prev === 'waiting' ? 'paste' : prev)
          }, 30000)
        } catch {
          setOauthState('error')
        }
      }

      return (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button onClick={() => {
                setOauthState('idle')
                providerDef?.methods.length > 1 ? setStep('method') : setStep('provider')
              }} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><ArrowLeft className="w-4 h-4" /></button>
              <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step 3: {providerDef?.label} — Open Sign-In Page</h4>
            </div>
            <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
          </div>

          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-400 space-y-2">
              <p>What to expect:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>A browser tab will open to OpenAI sign-in.</li>
                <li>Sign in with the ChatGPT account that has the subscription.</li>
                <li>After approval, OpenAI will redirect to a <code className="bg-white dark:bg-neutral-700 px-1 rounded">http://localhost...</code> URL.</li>
                <li>If you are using TBC remotely, copy that full localhost URL, then paste it in the next step.</li>
              </ol>
              <p className="text-neutral-500 dark:text-neutral-500">Seeing a localhost page fail to load is expected. We only need the final URL.</p>
            </div>

            {oauthState === 'starting' ? (
              <p className="text-sm text-blue-500 animate-pulse">Starting sign-in...</p>
            ) : (
              <button
                onClick={startOAuth}
                className="w-full px-3 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Open Sign-In Page
              </button>
            )}

            {oauthState === 'error' && (
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-700 dark:text-red-300">Failed to start sign-in. Please try again.</p>
              </div>
            )}
          </div>
        </div>
      )
    }
  }

  if (step === 'oauth_callback') {
    const submitPasteUrl = async () => {
      if (!pasteUrl || !flowId) return
      setSaving(true)
      try {
        const res = await authFetch('/api/oauth/submit-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flowId, code: pasteUrl })
        })
        const data = await res.json()
        if (data.success) {
          setOauthState('success')
          setTimeout(() => setStep('label'), 300)
        } else {
          setOauthState('error')
        }
      } catch {
        setOauthState('error')
      }
      setSaving(false)
    }

    return (
      <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep('action')} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><ArrowLeft className="w-4 h-4" /></button>
            <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step 4: {providerDef?.label} — Paste Callback URL</h4>
          </div>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-300 mb-1">
              Finish sign-in in the browser, then paste the full redirect URL from the address bar here.
            </p>
            {authUrl && (
              <p className="text-xs text-blue-500 dark:text-blue-400">
                If no window opened, <a href={authUrl} target="_blank" rel="noopener noreferrer" className="underline">click here</a>.
              </p>
            )}
          </div>

          <div className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-400 space-y-2">
            <p><strong>Paste the final URL</strong> that starts with <code className="bg-white dark:bg-neutral-700 px-1 rounded">http://localhost</code>.</p>
            <p>If the localhost page shows an error, that's fine. Copy the URL anyway.</p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Paste redirect URL here..."
              value={pasteUrl}
              onChange={e => setPasteUrl(e.target.value)}
              autoFocus
              className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
            />
            <button
              onClick={submitPasteUrl}
              disabled={!pasteUrl || saving || !flowId}
              className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? 'Verifying...' : 'Submit'}
            </button>
          </div>

          {(oauthState === 'waiting' || oauthState === 'paste') && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Waiting for sign-in completion. You can either paste the callback URL now or wait for automatic detection.</p>
          )}

          {oauthState === 'success' && (
            <div className="space-y-2">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-700 dark:text-green-300">Sign-in successful. Continue when you're ready.</p>
              </div>
              <button
                onClick={() => setStep('label')}
                className="w-full px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Continue
              </button>
            </div>
          )}

          {oauthState === 'error' && (
            <div className="space-y-2">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-700 dark:text-red-300">Sign-in failed. Please check the pasted URL and try again.</p>
              </div>
              <button
                onClick={() => { setOauthState('waiting'); setPasteUrl('') }}
                className="w-full px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Retry Paste
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Step 4/5: Label + save
  if (step === 'label') {
    const handleSave = async () => {
      setSaving(true)
      try {
        if (selectedMethod === 'api_key' || selectedMethod === 'setup_token') {
          const body = {
            token,
            provider: selectedProvider,
            type: selectedMethod === 'setup_token' ? 'oauth' : 'api_key',
            label: label || providerDef?.label || selectedProvider,
          }
          if (selectedProvider === 'custom') {
            const trimmedTierModels = Object.fromEntries(
              Object.entries(tierModels).filter(([, value]) => value.trim())
            )
            body.customConfig = {
              apiStyle,
              baseUrl,
              defaultModel,
            }
            if (Object.keys(trimmedTierModels).length > 0) {
              body.customConfig.tierModels = trimmedTierModels
            }
          }
          const res = await authFetch('/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
          if (res.ok) {
            onComplete()
            return
          }
        } else if (selectedMethod === 'oauth') {
          // OAuth credentials were already saved by the server during the flow.
          // We need to add a key pool entry pointing to the OAuth credentials.
          const res = await authFetch('/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: providerDef?.oauthProviderId || selectedProvider,
              type: 'oauth',
              authFile: `oauth-${providerDef?.oauthProviderId || selectedProvider}.json`,
              label: label || `${providerDef?.label || selectedProvider} (OAuth)`,
            })
          })
          if (res.ok) {
            onComplete()
            return
          }
        }
      } catch {}
      setSaving(false)
    }

    return (
      <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(selectedMethod === 'oauth' ? 'oauth_callback' : 'action')} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><ArrowLeft className="w-4 h-4" /></button>
            <h4 className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase">Step {selectedMethod === 'oauth' ? '5' : '4'}: Name This Credential</h4>
          </div>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-2 mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          <ProviderBadge provider={selectedProvider} />
          <span className={`font-medium px-1.5 py-0.5 rounded ${
            selectedMethod === 'oauth'
              ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/30'
              : 'text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800'
          }`}>
            {selectedMethod === 'oauth' ? 'OAuth' : 'API Key'}
          </span>
        </div>
        <input
          type="text"
          placeholder={`Label (e.g., "${providerDef?.label} — Personal")`}
          value={label}
          onChange={e => setLabel(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200 mb-2"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          {saving ? 'Saving...' : 'Add Credential'}
        </button>
      </div>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Main Settings Panel
// ---------------------------------------------------------------------------

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
  const [, setNowTick] = useState(0)
  const [allowCustomProvider, setAllowCustomProvider] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [editingCustomKey, setEditingCustomKey] = useState(null)
  const [editingLabel, setEditingLabel] = useState(null)
  const [editLabelValue, setEditLabelValue] = useState('')

  const fetchKeys = () => {
    fetch('/api/keys').then(r => r.json()).then(d => {
      setKeys(d.keys || [])
      if (d.allowCustomProvider !== undefined) setAllowCustomProvider(d.allowCustomProvider)
    }).catch(() => {})
  }

  useEffect(() => { fetchKeys() }, [])

  useEffect(() => {
    const hasCooldown = keys.some(key => (key.cooldownMs || 0) > 0)
    if (!hasCooldown) return
    const id = window.setInterval(() => setNowTick(tick => tick + 1), 1000)
    return () => window.clearInterval(id)
  }, [keys])

  const handleRemoveKey = async (id) => {
    try {
      const res = await authFetch(`/api/keys/${id}`, { method: 'DELETE' })
      if (res.ok) {
        const d = await res.json()
        setKeys(d.keys || [])
        showToast('Credential removed')
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
            Keys are tried in order during agent runs. Supports API keys and OAuth sign-in.
          </p>

          {/* Add credential button / wizard */}
          {showWizard ? (
            <div className="mb-4">
              <AddCredentialWizard
                authFetch={authFetch}
                excludeProviders={!allowCustomProvider ? ['custom'] : []}
                onComplete={() => {
                  setShowWizard(false)
                  fetchKeys()
                  showToast('Credential added')
                }}
                onCancel={() => setShowWizard(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowWizard(true)}
              className="w-full mb-4 px-3 py-2 text-sm font-medium border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg text-neutral-500 dark:text-neutral-400 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add Credential
            </button>
          )}

          {editingCustomKey && (
            <EditCustomCredentialCard
              credential={editingCustomKey}
              authFetch={authFetch}
              onComplete={() => {
                setEditingCustomKey(null)
                fetchKeys()
                showToast('Custom credential updated')
              }}
              onCancel={() => setEditingCustomKey(null)}
            />
          )}

          {/* Credential list */}
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
                      <span className="text-xs text-amber-500">rate limited{key.cooldownMs ? `, ${formatCooldown(key.cooldownMs)}` : ''}</span>
                    )}
                  </div>
                  {key.provider === 'custom' && key.customConfig && (
                    <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                      {key.customConfig.apiStyle} · {key.customConfig.baseUrl} · {key.customConfig.defaultModel}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {key.provider === 'custom' && (
                    <button
                      onClick={() => setEditingCustomKey(key)}
                      className="px-2 py-0.5 text-xs rounded text-cyan-700 hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
                    >
                      Edit
                    </button>
                  )}
                  <button onClick={() => handleReorder(key.id, 'up')} disabled={idx === 0} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30" title="Move up"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleReorder(key.id, 'down')} disabled={idx === keys.length - 1} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-30" title="Move down"><ChevronDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleToggleEnabled(key.id, !key.enabled)} className={`px-2 py-0.5 text-xs rounded ${key.enabled ? 'text-amber-600 hover:text-amber-700 dark:text-amber-400' : 'text-green-600 hover:text-green-700 dark:text-green-400'}`}>{key.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => handleRemoveKey(key.id)} className="p-1 text-red-400 hover:text-red-600 dark:hover:text-red-300" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            {keys.length === 0 && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 py-2">No credentials configured. Click "Add Credential" above to get started.</p>
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  )
}
