/**
 * OAuth credential management using pi-ai's OAuth providers.
 *
 * Supports: Anthropic, OpenAI Codex, GitHub Copilot, Gemini CLI, Antigravity
 * Each provider supports both browser callback AND manual redirect URL paste.
 *
 * Credentials stored in: ~/.thebotcompany/oauth-{providerId}.json
 */

import fs from 'fs';
import path from 'path';
import {
  getOAuthProvider,
  getOAuthProviders,
} from '@mariozechner/pi-ai/oauth';

const TBC_HOME = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

function credPath(providerId, projectId) {
  const suffix = projectId ? `-${projectId.replace(/\//g, '_')}` : '';
  return path.join(TBC_HOME, `oauth-${providerId}${suffix}.json`);
}

export function loadCredentials(providerId, projectId = null) {
  // Also check the alternate path for openai-codex
  const paths = [credPath(providerId, projectId)];
  if (providerId === 'openai-codex') {
    const altSuffix = projectId ? `-${projectId.replace(/\//g, '_')}` : '';
    paths.push(path.join(TBC_HOME, `openai-codex-auth${altSuffix}.json`));
  }

  for (const fp of paths) {
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      // Normalize older credential format (access_token → access)
      if (raw.access_token && !raw.access) {
        return {
          access: raw.access_token,
          refresh: raw.refresh_token,
          expires: raw.expires_at || (raw.expires_in ? Date.now() + raw.expires_in * 1000 : 0),
          accountId: raw.account_id,
        };
      }
      return raw;
    } catch {}
  }
  return null;
}

export function saveCredentials(providerId, credentials, projectId = null) {
  const fp = credPath(providerId, projectId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function clearCredentials(providerId, projectId = null) {
  try { fs.unlinkSync(credPath(providerId, projectId)); } catch {}
  // Also clean the alternate path
  if (providerId === 'openai-codex') {
    const altSuffix = projectId ? `-${projectId.replace(/\//g, '_')}` : '';
    try { fs.unlinkSync(path.join(TBC_HOME, `openai-codex-auth${altSuffix}.json`)); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Active login flows — keyed by providerId (or providerId:projectId)
// ---------------------------------------------------------------------------

const _activeFlows = new Map();

/**
 * Start an OAuth login flow for a provider.
 * Returns { authorization_url, flowId } — UI should open the URL.
 * The flow accepts manual code paste via submitManualCode().
 */
export async function startOAuthLogin(providerId, projectId = null) {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown OAuth provider: ${providerId}`);
  }

  const flowKey = projectId ? `${providerId}:${projectId}` : providerId;

  // Cancel any existing flow
  if (_activeFlows.has(flowKey)) {
    const old = _activeFlows.get(flowKey);
    old.cancel();
    _activeFlows.delete(flowKey);
  }

  let authUrl = null;
  let resolveManualCode = null;
  let rejectManualCode = null;

  const manualCodePromise = new Promise((resolve, reject) => {
    resolveManualCode = resolve;
    rejectManualCode = reject;
  });

  const loginPromise = provider.login({
    onAuth: (info) => {
      authUrl = typeof info === 'string' ? info : info.url;
    },
    onPrompt: async (prompt) => {
      // This is the fallback prompt — wait for manual code via API
      return manualCodePromise;
    },
    onProgress: () => {},
    onManualCodeInput: () => manualCodePromise,
  });

  // Wait a tick for onAuth to be called
  await new Promise(r => setTimeout(r, 200));

  const flow = {
    loginPromise,
    resolveManualCode,
    cancel: () => {
      rejectManualCode?.(new Error('Flow cancelled'));
      _activeFlows.delete(flowKey);
    },
  };
  _activeFlows.set(flowKey, flow);

  // Handle completion
  loginPromise
    .then(credentials => {
      saveCredentials(providerId, credentials, projectId);
      _activeFlows.delete(flowKey);
    })
    .catch(() => {
      _activeFlows.delete(flowKey);
    });

  // Timeout after 5 minutes
  setTimeout(() => {
    if (_activeFlows.has(flowKey)) {
      flow.cancel();
    }
  }, 300_000);

  return {
    authorization_url: authUrl,
    flowId: flowKey,
  };
}

/**
 * Submit manual code/redirect URL for an active OAuth flow.
 */
export function submitManualCode(flowId, code) {
  const flow = _activeFlows.get(flowId);
  if (!flow) {
    throw new Error('No active login flow found. Start a new login.');
  }
  flow.resolveManualCode(code);
}

/**
 * Check if an OAuth flow completed successfully.
 */
export async function checkOAuthStatus(providerId, projectId = null) {
  const creds = loadCredentials(providerId, projectId);
  return {
    authenticated: !!creds?.access,
    expires: creds?.expires || null,
    hasRefreshToken: !!creds?.refresh,
  };
}

/**
 * Wait for an active flow to complete (with timeout).
 */
export async function waitForFlow(flowId, timeoutMs = 5000) {
  const flow = _activeFlows.get(flowId);
  if (!flow) return false;
  try {
    await Promise.race([
      flow.loginPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token resolution (used by key-pool)
// ---------------------------------------------------------------------------

/**
 * Get a valid access token for a provider, auto-refreshing if expired.
 * @returns {Promise<string|null>} access token or null
 */
export async function getAccessToken(providerId, projectId = null) {
  const scopes = projectId ? [projectId, null] : [null];

  for (const scope of scopes) {
    const creds = loadCredentials(providerId, scope);
    if (!creds?.access) continue;

    // Check if token needs refresh (within 60s of expiry)
    if (creds.expires && Date.now() > creds.expires - 60_000) {
      if (!creds.refresh) continue;
      const provider = getOAuthProvider(providerId);
      if (!provider) continue;
      try {
        const refreshed = await provider.refreshToken(creds);
        saveCredentials(providerId, refreshed, scope);
        return refreshed.access;
      } catch {
        continue;
      }
    }

    return creds.access;
  }

  return null;
}

// ---------------------------------------------------------------------------
// List available OAuth providers
// ---------------------------------------------------------------------------

export function listOAuthProviders() {
  return getOAuthProviders().map(p => ({
    id: p.id,
    name: p.name,
    usesCallbackServer: p.usesCallbackServer || false,
  }));
}
