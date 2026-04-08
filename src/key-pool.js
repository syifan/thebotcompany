/**
 * Key Pool — centralized API key management with labels, ordering,
 * enable/disable, rate-limit-aware rotation, and per-project selection.
 *
 * Storage: ~/.thebotcompany/key-pool.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { normalizeCustomConfig } from './providers/custom-config.js';

const TBC_HOME = process.env.TBC_HOME || path.join(os.homedir(), '.thebotcompany');
const POOL_PATH = path.join(TBC_HOME, 'key-pool.json');

// ---------------------------------------------------------------------------
// In-memory rate limit tracking
// ---------------------------------------------------------------------------

/** @type {Map<string, number>} keyId → cooldown-until timestamp */
const _rateLimits = new Map();

export function markRateLimited(keyId, cooldownMs = 5 * 60_000) {
  _rateLimits.set(keyId, Date.now() + cooldownMs);
}

export function isRateLimited(keyId) {
  const until = _rateLimits.get(keyId);
  if (!until) return false;
  if (Date.now() >= until) {
    _rateLimits.delete(keyId);
    return false;
  }
  return true;
}

export function getRateLimitCooldown(keyId) {
  const until = _rateLimits.get(keyId);
  if (!until || Date.now() >= until) return 0;
  return until - Date.now();
}

// ---------------------------------------------------------------------------
// Pool persistence
// ---------------------------------------------------------------------------

export function loadKeyPool() {
  try {
    const raw = fs.readFileSync(POOL_PATH, 'utf-8');
    const pool = JSON.parse(raw);
    if (!Array.isArray(pool.keys)) pool.keys = [];
    return pool;
  } catch {
    return { keys: [] };
  }
}

export function saveKeyPool(pool) {
  fs.mkdirSync(TBC_HOME, { recursive: true });
  const tmp = POOL_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(pool, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, POOL_PATH);
}

// ---------------------------------------------------------------------------
// Provider auto-detection (shared with server.js)
// ---------------------------------------------------------------------------

export function detectTokenProvider(token) {
  if (!token) return null;
  if (token.startsWith('sk-ant-')) return 'anthropic';
  if (token.startsWith('sk-proj-') || token.startsWith('sk-')) return 'openai';
  if (token.startsWith('AIzaSy')) return 'google';
  return null;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

function generateId() {
  return crypto.randomUUID();
}

export function addKey({ label, token, provider, type, customConfig }) {
  const pool = loadKeyPool();
  const detectedProvider = provider || detectTokenProvider(token) || 'unknown';
  const detectedType = type || (token && token.startsWith('sk-ant-oat') ? 'oauth' : 'api_key');
  const maxOrder = pool.keys.reduce((m, k) => Math.max(m, k.order ?? 0), -1);
  const entry = {
    id: generateId(),
    label: label || `${detectedProvider} key`,
    provider: detectedProvider,
    type: detectedType,
    token,
    enabled: true,
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
  };
  if (detectedProvider === 'custom') {
    entry.customConfig = normalizeCustomConfig(customConfig);
  }
  pool.keys.push(entry);
  saveKeyPool(pool);
  return entry;
}

export function addOAuthKey({ label, provider, authFile }) {
  const pool = loadKeyPool();
  const maxOrder = pool.keys.reduce((m, k) => Math.max(m, k.order ?? 0), -1);
  const entry = {
    id: generateId(),
    label: label || `${provider} (OAuth)`,
    provider,
    type: 'oauth',
    authFile,
    enabled: true,
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
  };
  pool.keys.push(entry);
  saveKeyPool(pool);
  return entry;
}

export function removeKey(id) {
  const pool = loadKeyPool();
  pool.keys = pool.keys.filter(k => k.id !== id);
  saveKeyPool(pool);
}

export function updateKey(id, patch) {
  const pool = loadKeyPool();
  const key = pool.keys.find(k => k.id === id);
  if (!key) return null;
  if (patch.label !== undefined) key.label = patch.label;
  if (patch.token !== undefined) key.token = patch.token;
  if (patch.enabled !== undefined) key.enabled = patch.enabled;
  if (patch.order !== undefined) key.order = patch.order;
  if (patch.customConfig !== undefined) {
    if (key.provider !== 'custom') {
      throw new Error('customConfig can only be set for custom provider keys');
    }
    key.customConfig = normalizeCustomConfig(patch.customConfig);
  }
  saveKeyPool(pool);
  return key;
}

export function reorderKeys(orderedIds) {
  const pool = loadKeyPool();
  for (let i = 0; i < orderedIds.length; i++) {
    const key = pool.keys.find(k => k.id === orderedIds[i]);
    if (key) key.order = i;
  }
  pool.keys.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  saveKeyPool(pool);
}

// ---------------------------------------------------------------------------
// Safe pool (tokens masked) for API responses
// ---------------------------------------------------------------------------

function maskToken(token) {
  if (!token || token.length < 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

export function getKeyPoolSafe() {
  const pool = loadKeyPool();
  return {
    keys: pool.keys
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(k => ({
        id: k.id,
        label: k.label,
        provider: k.provider,
        type: k.type,
        preview: k.type === 'oauth' ? '(OAuth)' : maskToken(k.token),
        enabled: k.enabled,
        order: k.order,
        rateLimited: isRateLimited(k.id),
        cooldownMs: getRateLimitCooldown(k.id),
        createdAt: k.createdAt,
        customConfig: k.provider === 'custom' ? k.customConfig : undefined,
      })),
  };
}

// ---------------------------------------------------------------------------
// Key resolution for agent runs
// ---------------------------------------------------------------------------

/**
 * Resolve the API key to use for a project.
 *
 * @param {object} projectConfig - Project config from config.yaml
 * @param {string|null} providerHint - Detected provider from model/env
 * @param {function|null} getOAuthToken - Async fn to get OAuth access token: (authFile) => token
 * @returns {Promise<{token: string, provider: string, keyId: string}|null>}
 */
export async function resolveKeyForProject(projectConfig, providerHint, getOAuthToken) {
  const pool = loadKeyPool();
  const sorted = pool.keys
    .filter(k => k.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const keySelection = projectConfig?.keySelection;

  // If project references a specific key from the pool, try it first
  if (keySelection?.keyId) {
    const selected = sorted.find(k => k.id === keySelection.keyId);
    if (selected && !isRateLimited(selected.id)) {
      const token = await resolveToken(selected, getOAuthToken);
      if (token) {
        return {
          token,
          provider: selected.provider,
          keyId: selected.id,
          type: selected.type || 'api_key',
          customConfig: selected.provider === 'custom' ? selected.customConfig : undefined,
        };
      }
    }
    // If fallback is disabled, return null (project waits)
    if (keySelection.fallback === false) return null;
  }

  // Use global pool order — prefer keys matching provider hint, then any available
  const candidates = sorted.filter(k => !isRateLimited(k.id) && !(keySelection?.keyId && k.id === keySelection.keyId));

  // First pass: prefer keys matching the provider hint
  if (providerHint) {
    for (const key of candidates) {
      if (key.provider !== providerHint) continue;
      const token = await resolveToken(key, getOAuthToken);
      if (token) {
        return {
          token,
          provider: key.provider,
          keyId: key.id,
          type: key.type || 'api_key',
          customConfig: key.provider === 'custom' ? key.customConfig : undefined,
        };
      }
    }
  }

  // Second pass: any available key (cross-provider fallback)
  for (const key of candidates) {
    const token = await resolveToken(key, getOAuthToken);
    if (token) {
      return {
        token,
        provider: key.provider,
        keyId: key.id,
        type: key.type || 'api_key',
        customConfig: key.provider === 'custom' ? key.customConfig : undefined,
      };
    }
  }

  return null;
}

async function resolveToken(key, getOAuthToken) {
  // Browser-login OAuth (e.g. Codex) — uses authFile, no stored token
  if (key.type === 'oauth' && key.authFile && getOAuthToken) {
    return await getOAuthToken(key.authFile, key.provider);
  }
  // Pasted tokens (API keys and OAuth tokens like sk-ant-oat-...)
  return key.token || null;
}

// ---------------------------------------------------------------------------
// Migration from .env + codex auth files + project setupTokens
// ---------------------------------------------------------------------------

export function migrateFromEnv(projectRunners) {
  const pool = loadKeyPool();
  if (pool._migrated) return;

  const envKeys = [
    { envVar: 'ANTHROPIC_AUTH_TOKEN', provider: 'anthropic', label: 'Anthropic (OAuth)' },
    { envVar: 'ANTHROPIC_API_KEY', provider: 'anthropic', label: 'Anthropic' },
    { envVar: 'OPENAI_API_KEY', provider: 'openai', label: 'OpenAI' },
    { envVar: 'GEMINI_API_KEY', provider: 'google', label: 'Google (Gemini)' },
    { envVar: 'GOOGLE_API_KEY', provider: 'google', label: 'Google' },
    { envVar: 'MINIMAX_API_KEY', provider: 'minimax', label: 'MiniMax' },
  ];

  const seen = new Set();
  let order = 0;

  for (const { envVar, provider, label } of envKeys) {
    const val = process.env[envVar];
    if (!val || seen.has(val)) continue;
    seen.add(val);
    pool.keys.push({
      id: generateId(),
      label,
      provider,
      type: 'api_key',
      token: val,
      enabled: true,
      order: order++,
      createdAt: new Date().toISOString(),
    });
  }

  // Migrate global Codex OAuth
  const codexAuthPath = path.join(TBC_HOME, 'openai-codex-auth.json');
  if (fs.existsSync(codexAuthPath)) {
    try {
      const codexData = JSON.parse(fs.readFileSync(codexAuthPath, 'utf-8'));
      if (codexData.access_token) {
        pool.keys.push({
          id: generateId(),
          label: 'ChatGPT (OAuth)',
          provider: 'openai-codex',
          type: 'oauth',
          authFile: 'openai-codex-auth.json',
          enabled: true,
          order: order++,
          createdAt: new Date().toISOString(),
        });
      }
    } catch {}
  }

  // Migrate per-project setupTokens
  if (projectRunners) {
    for (const [projectId, runner] of projectRunners) {
      try {
        const config = runner.loadConfig();
        if (config.setupToken && !seen.has(config.setupToken)) {
          seen.add(config.setupToken);
          const provider = config.setupTokenProvider || detectTokenProvider(config.setupToken) || 'unknown';
          const keyId = generateId();
          pool.keys.push({
            id: keyId,
            label: `${provider} (from ${projectId})`,
            provider,
            type: 'api_key',
            token: config.setupToken,
            enabled: true,
            order: order++,
            createdAt: new Date().toISOString(),
          });
          // Update project config to use keySelection
          try {
            const configPath = runner.configPath;
            const existing = fs.existsSync(configPath) ? yaml.load(fs.readFileSync(configPath, 'utf-8')) || {} : {};
            delete existing.setupToken;
            delete existing.setupTokenProvider;
            existing.keySelection = { keyId, fallback: true };
            fs.writeFileSync(configPath, yaml.dump(existing));
          } catch {}
        } else if (config.setupToken && seen.has(config.setupToken)) {
          // Token already in pool — find its ID and set keySelection
          const existingKey = pool.keys.find(k => k.token === config.setupToken);
          if (existingKey) {
            try {
              const configPath = runner.configPath;
              const existing = fs.existsSync(configPath) ? yaml.load(fs.readFileSync(configPath, 'utf-8')) || {} : {};
              delete existing.setupToken;
              delete existing.setupTokenProvider;
              existing.keySelection = { keyId: existingKey.id, fallback: true };
              fs.writeFileSync(configPath, yaml.dump(existing));
            } catch {}
          }
        }
      } catch {}
    }
  }

  pool._migrated = true;
  saveKeyPool(pool);
}
