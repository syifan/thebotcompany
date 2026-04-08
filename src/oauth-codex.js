/**
 * OAuth PKCE Authorization Code Flow for OpenAI Codex (ChatGPT subscription auth).
 *
 * Uses the same OAuth client as Codex CLI / Pi to obtain OAuth tokens
 * that grant access to the OpenAI Responses API via ChatGPT Plus/Pro.
 *
 * Flow: PKCE auth code → localhost callback → token exchange → auto-refresh
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import crypto from 'crypto';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

const TBC_HOME = process.env.TBC_HOME || path.join(os.homedir(), '.thebotcompany');

function authFilePath(projectId) {
  if (projectId) return path.join(TBC_HOME, `openai-codex-auth-${projectId.replace(/\//g, '_')}.json`);
  return path.join(TBC_HOME, 'openai-codex-auth.json');
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// JWT decode (extract accountId)
// ---------------------------------------------------------------------------

function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getAccountId(accessToken) {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH];
  return auth?.chatgpt_account_id || null;
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

export function loadTokens(projectId) {
  try {
    const raw = fs.readFileSync(authFilePath(projectId), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveTokens(tokens, projectId) {
  const fp = authFilePath(projectId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(projectId) {
  try { fs.unlinkSync(authFilePath(projectId)); } catch {}
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

async function exchangeAuthorizationCode(code, verifier) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token) {
    throw new Error('Token response missing required fields');
  }

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    account_id: getAccountId(json.access_token),
  };
}

// ---------------------------------------------------------------------------
// OAuth Authorization Flow (PKCE + localhost callback)
// ---------------------------------------------------------------------------

// Active flows keyed by projectId (or '__global__')
const _activeFlows = new Map();

/**
 * Start the OAuth authorization flow.
 * Returns { authorization_url, state } — the UI should open the URL in a browser.
 * The server listens on localhost:1455 for the callback.
 */
export async function startAuthorizationFlow(projectId = null) {
  const flowKey = projectId || '__global__';

  // Clean up any existing flow
  if (_activeFlows.has(flowKey)) {
    const old = _activeFlows.get(flowKey);
    try { old.server.close(); } catch {}
    _activeFlows.delete(flowKey);
  }

  const { verifier, challenge } = await generatePKCE();
  const state = base64url(crypto.randomBytes(16));

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'thebotcompany');

  // Start local callback server
  const callbackPromise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '', 'http://localhost');
        if (reqUrl.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        if (reqUrl.searchParams.get('state') !== state) {
          res.statusCode = 400;
          res.end('State mismatch');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.end('Missing authorization code');
          return;
        }

        // Send success page to browser
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><body><p>Authentication successful! You can close this tab.</p></body></html>');

        // Exchange code for tokens
        try {
          const tokens = await exchangeAuthorizationCode(code, verifier);
          saveTokens(tokens, projectId);
          resolve(tokens);
        } catch (err) {
          reject(err);
        }

        // Clean up
        setTimeout(() => {
          try { server.close(); } catch {}
          _activeFlows.delete(flowKey);
        }, 1000);
      } catch (err) {
        res.statusCode = 500;
        res.end('Internal error');
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      _activeFlows.set(flowKey, { server, verifier, state, resolve, reject });
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start callback server on port ${CALLBACK_PORT}: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      try { server.close(); } catch {}
      _activeFlows.delete(flowKey);
      reject(new Error('Authorization flow timed out'));
    }, 300_000);
  });

  // Don't await — the flow completes asynchronously when the user signs in
  callbackPromise.catch(() => {});

  return {
    authorization_url: url.toString(),
    state,
    _callbackPromise: callbackPromise,
  };
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(refreshToken, projectId = null) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token) {
    throw new Error('Token refresh response missing fields');
  }

  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    account_id: getAccountId(json.access_token),
  };
  saveTokens(tokens, projectId);
  return tokens;
}

// ---------------------------------------------------------------------------
// Get a valid access token (auto-refresh if needed)
// ---------------------------------------------------------------------------

/**
 * Returns a current access token, refreshing if expired.
 * Checks project-level tokens first, then falls back to global.
 */
export async function getAccessToken(projectId = null) {
  const scopes = projectId ? [projectId, null] : [null];

  for (const scope of scopes) {
    const tokens = loadTokens(scope);
    if (!tokens?.access_token) continue;

    // Refresh if token expires within 60 seconds
    if (tokens.expires_at && Date.now() > tokens.expires_at - 60_000) {
      if (!tokens.refresh_token) continue;
      try {
        const refreshed = await refreshAccessToken(tokens.refresh_token, scope);
        return refreshed.access_token;
      } catch {
        continue;
      }
    }

    return tokens.access_token;
  }

  return null;
}
