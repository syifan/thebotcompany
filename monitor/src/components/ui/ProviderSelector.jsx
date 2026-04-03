import React from 'react'

// Provider definitions: what methods each provider supports
export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', methods: ['api_key', 'oauth', 'setup_token'] },
  { id: 'openai', label: 'OpenAI', methods: ['api_key', 'oauth'], oauthProviderId: 'openai-codex' },
  { id: 'google', label: 'Google (Gemini)', methods: ['api_key', 'oauth'] },
  { id: 'custom', label: 'Custom', methods: ['api_key'] },
  { id: 'github-copilot', label: 'GitHub Copilot', methods: ['oauth'] },
  { id: 'minimax', label: 'MiniMax', methods: ['api_key'] },
  { id: 'amazon-bedrock', label: 'Amazon Bedrock', methods: ['api_key'] },
  { id: 'azure-openai-responses', label: 'Azure OpenAI', methods: ['api_key'] },
  { id: 'cerebras', label: 'Cerebras', methods: ['api_key'] },
  { id: 'google-vertex', label: 'Google Vertex', methods: ['api_key'] },
  { id: 'groq', label: 'Groq', methods: ['api_key'] },
  { id: 'huggingface', label: 'Hugging Face', methods: ['api_key'] },
  { id: 'kimi-coding', label: 'Kimi Coding', methods: ['api_key'] },
  { id: 'mistral', label: 'Mistral', methods: ['api_key'] },
  { id: 'openrouter', label: 'OpenRouter', methods: ['api_key'] },
  { id: 'xai', label: 'xAI', methods: ['api_key'] },
]

export const PROVIDER_COLORS = {
  anthropic: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
  openai: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
  google: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30',
  custom: 'text-cyan-700 dark:text-cyan-300 bg-cyan-100 dark:bg-cyan-900/30',
  minimax: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30',
  'openai-codex': 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30',
  'github-copilot': 'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800/50',
}

export function ProviderBadge({ provider }) {
  const def = PROVIDERS.find(p => p.id === provider)
  const label = def?.label || provider || 'Unknown'
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${PROVIDER_COLORS[provider] || 'text-neutral-500 bg-neutral-100 dark:bg-neutral-800'}`}>
      {label}
    </span>
  )
}

/**
 * Grid of provider buttons for selecting a provider.
 *
 * @param {Object} props
 * @param {(provider: { id: string, label: string, methods: string[] }) => void} props.onSelect
 * @param {string[]} [props.filterMethods] - Only show providers that support these methods (e.g., ['oauth'])
 */
export default function ProviderSelector({ onSelect, filterMethods, exclude }) {
  let filtered = filterMethods
    ? PROVIDERS.filter(p => filterMethods.some(m => p.methods.includes(m)))
    : PROVIDERS
  if (exclude) filtered = filtered.filter(p => !exclude.includes(p.id))

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {filtered.map(p => (
        <button
          key={p.id}
          onClick={() => onSelect(p)}
          className="text-left px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-neutral-700 dark:text-neutral-300"
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
