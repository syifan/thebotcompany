import { sendJson } from '../http.js';

export async function handleModelRoutes(req, res, url) {
  if (req.method !== 'GET' || url.pathname !== '/api/models') return false;

  const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
  if (!token) {
    sendJson(res, 400, { error: 'No auth token configured' });
    return true;
  }

  try {
    const isOAuth = token.startsWith('sk-ant-oat');
    const headers = { 'anthropic-version': '2023-06-01' };
    if (isOAuth) {
      headers.Authorization = `Bearer ${token}`;
      headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
    } else {
      headers['x-api-key'] = token;
    }
    const resp = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers });
    if (!resp.ok) {
      const details = await resp.text();
      sendJson(res, resp.status, { error: `Anthropic API error: ${resp.status}`, details });
      return true;
    }
    sendJson(res, 200, await resp.json());
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
  return true;
}
