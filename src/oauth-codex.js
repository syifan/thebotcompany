/**
 * OAuth Device Code Flow for OpenAI Codex (ChatGPT subscription auth).
 *
 * Uses the same Auth0 client as Codex CLI / Pi to obtain OAuth tokens
 * that grant access to the OpenAI Responses API via ChatGPT Plus/Pro.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const AUTH0_DOMAIN = 'auth0.openai.com';
const CLIENT_ID = 'DJvkhBbFSZ6JvLxAh0Ch975hUXbfMrJN';
const AUDIENCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access';

const TBC_HOME = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');

function authFilePath(projectId) {
  if (projectId) return path.join(TBC_HOME, `openai-codex-auth-${projectId}.json`);
  return path.join(TBC_HOME, 'openai-codex-auth.json');
}

// ---------------------------------------------------------------------------
// Low-level HTTPS POST helper (no external deps)
// ---------------------------------------------------------------------------

function post(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = https.request({
      hostname,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'TheBotCompany/1.4.0',
        'Accept': 'application/json',
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
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
// Device Code Flow
// ---------------------------------------------------------------------------

/**
 * Start the device code flow.
 * Returns { device_code, user_code, verification_uri, verification_uri_complete,
 *           expires_in, interval }.
 */
export async function startDeviceCodeFlow() {
  const { status, body } = await post(AUTH0_DOMAIN, '/oauth/device/code', {
    client_id: CLIENT_ID,
    audience: AUDIENCE,
    scope: SCOPE,
  });
  if (status !== 200) {
    throw new Error(`Device code request failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Poll for the token until the user authorises or the flow expires.
 * @param {string} deviceCode - from startDeviceCodeFlow()
 * @param {number} interval   - poll interval in seconds
 * @param {number} expiresIn  - timeout in seconds
 * @returns {Promise<Object>} token response { access_token, refresh_token, ... }
 */
export async function pollForToken(deviceCode, interval = 5, expiresIn = 900, projectId = null) {
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval * 1000));

    const { status, body } = await post(AUTH0_DOMAIN, '/oauth/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID,
      device_code: deviceCode,
    });

    if (status === 200 && body.access_token) {
      const tokens = {
        access_token: body.access_token,
        refresh_token: body.refresh_token || null,
        expires_at: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
      };
      saveTokens(tokens, projectId);
      return tokens;
    }

    // Expected transient errors during polling
    if (body.error === 'authorization_pending' || body.error === 'slow_down') {
      if (body.error === 'slow_down') interval = Math.min(interval + 1, 15);
      continue;
    }

    // Permanent error
    throw new Error(`Token exchange failed: ${body.error || JSON.stringify(body)}`);
  }

  throw new Error('Device code flow timed out');
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh the access token using the stored refresh token.
 * Updates the auth file on success. Throws on failure.
 */
export async function refreshAccessToken(refreshToken, projectId = null) {
  const { status, body } = await post(AUTH0_DOMAIN, '/oauth/token', {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  if (status !== 200 || !body.access_token) {
    throw new Error(`Token refresh failed (${status}): ${JSON.stringify(body)}`);
  }

  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token || refreshToken,
    expires_at: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
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
 * @param {string|null} projectId - optional project scope
 * @returns {Promise<string|null>}
 */
export async function getAccessToken(projectId = null) {
  // Try project-level first, then fall back to global
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
