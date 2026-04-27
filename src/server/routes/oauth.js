import { waitForFlow } from '../../oauth.js';
import { readJson, sendJson } from '../http.js';

export async function handleOAuthRoutes(req, res, url, ctx) {
  const {
    requireWrite,
    listOAuthProviders,
    startOAuthLogin,
    submitManualCode,
    checkOAuthStatus,
    clearOAuthCredentials,
  } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/oauth/providers') {
    sendJson(res, 200, listOAuthProviders());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/oauth/login') {
    if (!requireWrite(req, res)) return true;
    try {
      const { provider: providerId, project: projectId } = await readJson(req);
      if (!providerId) throw new Error('provider is required');
      const flow = await startOAuthLogin(providerId, projectId || null);
      sendJson(res, 200, { authorization_url: flow.authorization_url, flowId: flow.flowId });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/oauth/submit-code') {
    if (!requireWrite(req, res)) return true;
    try {
      const { flowId, code } = await readJson(req);
      if (!flowId || !code) throw new Error('flowId and code are required');
      submitManualCode(flowId, code);
      const completed = await waitForFlow(flowId, 10000);
      sendJson(res, 200, { success: true, completed });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/oauth/status') {
    const providerId = url.searchParams.get('provider');
    const projectId = url.searchParams.get('project') || null;
    if (!providerId) {
      sendJson(res, 400, { error: 'provider param required' });
      return true;
    }
    const status = await checkOAuthStatus(providerId, projectId);
    sendJson(res, 200, status);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/oauth/logout') {
    if (!requireWrite(req, res)) return true;
    try {
      const { provider: providerId, project: projectId } = await readJson(req);
      if (!providerId) throw new Error('provider is required');
      clearOAuthCredentials(providerId, projectId || null);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/openai-codex/login') {
    if (!requireWrite(req, res)) return true;
    const projectId = url.searchParams.get('project') || null;
    try {
      const flow = await startOAuthLogin('openai-codex', projectId);
      sendJson(res, 200, { authorization_url: flow.authorization_url, flowId: flow.flowId });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/openai-codex/status') {
    const projectId = url.searchParams.get('project') || null;
    const status = await checkOAuthStatus('openai-codex', projectId);
    sendJson(res, 200, status);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/openai-codex/logout') {
    if (!requireWrite(req, res)) return true;
    const projectId = url.searchParams.get('project') || null;
    clearOAuthCredentials('openai-codex', projectId);
    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}
