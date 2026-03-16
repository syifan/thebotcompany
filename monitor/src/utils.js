/**
 * Auto-detect AI provider from API key prefix.
 */
export function detectProvider(token) {
  if (!token) return null
  if (token.startsWith('sk-ant-')) return 'Anthropic'
  if (token.startsWith('sk-proj-') || token.startsWith('sk-')) return 'OpenAI'
  if (token.startsWith('AIzaSy')) return 'Google'
  return null
}

/**
 * Format a timestamp as a relative time string.
 */
export function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}
