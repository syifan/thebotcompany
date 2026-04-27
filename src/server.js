#!/usr/bin/env node
/**
 * TheBotCompany - Multi-project AI Agent Orchestrator
 * 
 * Central service that manages multiple repo-based agent projects.
 * Includes API server, monitor endpoints, and static file serving.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getModels as getPiModels } from './providers/index.js';
import { buildCustomTierMap, resolveProviderRuntime } from './providers/custom-config.js';
import { startOAuthLogin, submitManualCode, checkOAuthStatus, getAccessToken as getOAuthAccessToken, clearCredentials as clearOAuthCredentials, listOAuthProviders, loadCredentials as loadOAuthCredentials } from './oauth.js';
import {
  loadKeyPool, addKey, addOAuthKey, removeKey, updateKey, reorderKeys,
  getKeyPoolSafe, migrateFromEnv,
  detectTokenProvider as detectTokenProviderFromPool,
} from './key-pool.js';
import { LocalOrchestrator } from './orchestrator/LocalOrchestrator.js';
import { createProjectRunnerClass } from './orchestrator/ProjectRunner.js';
import { createAuth } from './server/auth.js';
import { serveStatic } from './server/static.js';
import { handleRealtimeRoutes } from './server/routes/realtime.js';
import { handleGlobalRoutes } from './server/routes/global.js';
import { handleKeyRoutes } from './server/routes/keys.js';
import { handleOAuthRoutes } from './server/routes/oauth.js';
import { handleSettingsRoutes } from './server/routes/settings.js';
import { handleModelRoutes } from './server/routes/models.js';
import { handleGithubRoutes } from './server/routes/github.js';
import { handleProjectRegistryRoutes } from './server/routes/projects.js';
import { handleProjectStatusRoutes } from './server/routes/project/status.js';
import { handleProjectConfigRoutes } from './server/routes/project/config.js';
import { handleProjectActivityRoutes } from './server/routes/project/activity.js';
import { handleProjectIssueRoutes } from './server/routes/project/issues.js';
import { handleProjectActionRoutes } from './server/routes/project/actions.js';
import { handleProjectReportRoutes } from './server/routes/project/reports.js';
import { handleProjectRepoRoutes } from './server/routes/project/repo.js';
import { handleProjectChatRoutes } from './server/routes/project/chats.js';
import webpush from 'web-push';
import { config as loadDotenv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Load .env from TBC_HOME (~/.thebotcompany/.env)
const TBC_HOME_EARLY = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');
loadDotenv({ path: path.join(TBC_HOME_EARLY, '.env') });
const TBC_HOME = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');
const MONITOR_DIST = path.join(ROOT, 'monitor', 'dist');

function maskToken(token) {
  if (!token || token.length < 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

function detectTokenProvider(token) {
  if (!token) return null;
  if (token.startsWith('sk-ant-')) return 'anthropic';
  if (token.startsWith('sk-proj-') || token.startsWith('sk-')) return 'openai';
  if (token.startsWith('AIzaSy')) return 'google';
  // MiniMax keys cannot be reliably auto-detected by prefix.
  // Use explicit provider field in project token settings.
  return 'unknown';
}

// Parse retry cooldown from rate-limit error messages
function parseSummarizeCooldown(message) {
  if (!message) return 5 * 60_000;
  const minMatch = message.match(/~?(\d+)\s*min/i);
  if (minMatch) return parseInt(minMatch[1]) * 60_000;
  const hourMatch = message.match(/(\d+)\s*h(?:ours?)?/i);
  if (hourMatch) return parseInt(hourMatch[1]) * 3600_000;
  const secMatch = message.match(/(\d+)\s*s(?:ec(?:onds?)?)?/i);
  if (secMatch) return parseInt(secMatch[1]) * 1000;
  return 5 * 60_000;
}

// Model tier system — maps abstract tiers to provider-specific models
const MODEL_TIERS = {
  anthropic: {
    high:  { model: 'claude-opus-4-7', reasoningEffort: 'high' },
    mid:   { model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
    low:   { model: 'claude-sonnet-4-6' },
    xlow:  { model: 'claude-haiku-4-5-20251001' },
  },
  openai: {
    high:  { model: 'gpt-5.5', reasoningEffort: 'xhigh' },
    mid:   { model: 'gpt-5.5', reasoningEffort: 'high' },
    low:   { model: 'gpt-5.5', reasoningEffort: 'medium' },
    xlow:  { model: 'gpt-4.1-mini' },
  },
  google: {
    high:  { model: 'gemini-3.1-pro-preview', reasoningEffort: 'high' },
    mid:   { model: 'gemini-3.1-pro-preview', reasoningEffort: 'medium' },
    low:   { model: 'gemini-3-flash-preview' },
    xlow:  { model: 'gemini-3-flash-preview' },
  },
  minimax: {
    high:  { model: 'minimax/MiniMax-M2.5' },
    mid:   { model: 'minimax/MiniMax-M2.5' },
    low:   { model: 'minimax/MiniMax-M2.5' },
    xlow:  { model: 'minimax/MiniMax-M2.5' },
  },
  'openai-codex': {
    high:  { model: 'openai-codex/gpt-5.5', reasoningEffort: 'xhigh' },
    mid:   { model: 'openai-codex/gpt-5.5', reasoningEffort: 'high' },
    low:   { model: 'openai-codex/gpt-5.5', reasoningEffort: 'medium' },
    xlow:  { model: 'openai-codex/gpt-5.5', reasoningEffort: 'low' },
  },
};

function inferProviderFromModel(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('openai-codex/')) return 'openai-codex';
  if (raw.startsWith('openai/')) return 'openai';
  if (raw.startsWith('anthropic/')) return 'anthropic';
  if (raw.startsWith('google/') || raw.startsWith('gemini/')) return 'google';
  if (raw.startsWith('minimax/')) return 'minimax';
  if (raw.startsWith('claude-')) return 'anthropic';
  if (raw.startsWith('gpt-') || raw.startsWith('o1') || raw.startsWith('o3') || raw.startsWith('o4')) return 'openai';
  if (raw.startsWith('gemini-')) return 'google';
  return null;
}

function resolveModelTier(tierOrModel, provider, projectModels) {
  const tier = (tierOrModel || '').toLowerCase().trim();
  // Project-level model overrides take priority only when compatible with the
  // currently selected provider.
  if (projectModels && projectModels[tier]) {
    const override = projectModels[tier];
    const overrideModel = override.includes('@') ? override.split('@', 2)[0] : override;
    const overrideProvider = inferProviderFromModel(overrideModel);
    if (!overrideProvider || overrideProvider === provider) {
      // Support "model@effort" format (e.g. "gpt-5.5@xhigh")
      if (override.includes('@')) {
        const [model, reasoningEffort] = override.split('@', 2);
        return { model, reasoningEffort };
      }
      return { model: override };
    }
  }
  const tiers = MODEL_TIERS[provider];
  if (tiers && tiers[tier]) {
    return tiers[tier];
  }
  // Not a tier — treat as explicit model name
  return { model: tierOrModel };
}

function getProviderRuntimeSelection({ provider, modelTier, keyResult, projectModels }) {
  return resolveProviderRuntime({
    provider,
    modelTier,
    keyResult,
    projectModels,
    resolveModelTier,
  });
}

function parseExplicitModelSelection(model) {
  const value = typeof model === 'string' ? model.trim() : '';
  if (!value) return { model: null, reasoningEffort: null };
  if (value.includes('@')) {
    const [selectedModel, reasoningEffort] = value.split('@', 2);
    return {
      model: selectedModel || null,
      reasoningEffort: reasoningEffort || null,
    };
  }
  return { model: value, reasoningEffort: null };
}

function formatStoredChatErrorMessage({ error, statusCode, source, cooldownMs }) {
  if (source === 'local_cooldown') {
    return `This key is currently rate limited by TBC${cooldownMs ? ` for about ${Math.ceil(cooldownMs / 60_000)}m` : ''}.`;
  }
  if (source === 'provider_429' || statusCode === 429) {
    return `Provider returned a 429/rate-limit error.${error ? `\n\n${error}` : ''}`;
  }
  if ((statusCode || 0) >= 500) {
    return `Server error (${statusCode}).${error ? `\n\n${error}` : ''}`;
  }
  return error || 'Failed to send message.';
}

function detectProviderFromToken(token) {
  if (!token) return 'anthropic';
  const p = detectTokenProvider(token);
  return (p === 'unknown' || !p) ? 'anthropic' : p;
}

// Strip meta directive blocks from agent responses (keep human-readable text only)
function stripMetaBlocks(text) {
  if (!text) return text;
  return text
    .replace(/<!--\s*(SCHEDULE|MILESTONE|CLAIM_COMPLETE|VERIFY_PASS|VERIFY_FAIL|EXAM_PASS|EXAM_FAIL)\s*-->[\s\S]*?<!--\s*\/\1\s*-->/g, '')
    .replace(/<!--\s*(CLAIM_COMPLETE|VERIFY_PASS|VERIFY_FAIL|EXAM_PASS|EXAM_FAIL)\s*-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Web Push (VAPID) --- Auto-generate keys if missing
let VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
let VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  const envPath = path.join(TBC_HOME, '.env');
  const vapidKeys = webpush.generateVAPIDKeys();
  VAPID_PUBLIC = vapidKeys.publicKey;
  VAPID_PRIVATE = vapidKeys.privateKey;
  // Append to .env file
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch {}
  const lines = [];
  if (!envContent.includes('VAPID_PUBLIC_KEY=')) lines.push(`VAPID_PUBLIC_KEY=${VAPID_PUBLIC}`);
  if (!envContent.includes('VAPID_PRIVATE_KEY=')) lines.push(`VAPID_PRIVATE_KEY=${VAPID_PRIVATE}`);
  if (!envContent.includes('VAPID_EMAIL=')) lines.push(`VAPID_EMAIL=${VAPID_EMAIL}`);
  if (lines.length) {
    fs.appendFileSync(envPath, (envContent.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n');
    log('Auto-generated VAPID keys and saved to .env');
  }
}
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}
const pushSubscriptions = new Map(); // endpoint -> subscription

// --- Configuration ---
const PORT = process.env.TBC_PORT || 3100;
const SERVE_STATIC = process.env.TBC_SERVE_STATIC !== 'false';
const ALLOW_CUSTOM_PROVIDER = process.env.TBC_ALLOW_CUSTOM_PROVIDER === 'true';

// Ensure TBC_HOME exists
if (!fs.existsSync(TBC_HOME)) {
  fs.mkdirSync(TBC_HOME, { recursive: true });
}
if (!fs.existsSync(path.join(TBC_HOME, 'logs'))) {
  fs.mkdirSync(path.join(TBC_HOME, 'logs'), { recursive: true });
}

// --- State ---
const projects = new Map(); // projectId -> ProjectRunner

// --- SSE notification system ---
const sseClients = new Set();
const notifications = []; // In-memory notification store
const MAX_NOTIFICATIONS = 200;

// Throttled status broadcasts — at most once per second per project
const _statusBroadcastTimers = new Map();
function broadcastStatusUpdate(projectId) {
  if (_statusBroadcastTimers.has(projectId)) return; // already scheduled
  _statusBroadcastTimers.set(projectId, setTimeout(() => {
    _statusBroadcastTimers.delete(projectId);
    const runner = orchestrator.getProject(projectId);
    if (!runner) return;
    const data = JSON.stringify({ type: 'status-update', project: projectId, status: runner.getStatus() });
    for (const client of sseClients) {
      client.write(`data: ${data}\n\n`);
    }
  }, 500)); // 500ms debounce
}

function broadcastReportUpdate(projectId, reportId, agent, cycle) {
  const data = JSON.stringify({ type: 'report-new', project: projectId, reportId, agent, cycle });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

function broadcastLiveAgentEvent(projectId, event) {
  const data = JSON.stringify({ type: 'agent-log-event', project: projectId, event });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

function broadcastEvent(event) {
  const messages = {
    milestone: `📌 New milestone: ${event.title}`,
    verified: `✅ Milestone verified: ${event.title}`,
    'verify-fail': `❌ Verification failed: ${event.title}`,
    phase: `🔄 Phase → ${event.phase}`,
    error: `⚠️ ${event.message}`,
    'agent-done': `${event.success ? '✓' : '✗'} ${event.agent}: ${event.summary || 'no response'}`,
    'project-complete': `🏁 Project ${event.success ? 'completed' : 'ended'}: ${event.message}`,
  };
  const notification = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: event.type,
    project: event.project,
    message: messages[event.type] || JSON.stringify(event),
    timestamp: new Date().toISOString(),
    read: false,
    detailed: event.type === 'agent-done',
  };
  notifications.unshift(notification);
  if (notifications.length > MAX_NOTIFICATIONS) notifications.length = MAX_NOTIFICATIONS;
  const data = JSON.stringify({ ...event, notification });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
  // Web Push
  if (VAPID_PUBLIC && pushSubscriptions.size > 0) {
    const pushPayload = JSON.stringify({
      title: `TBC: ${event.project || ''}`,
      body: notification.message,
      tag: `tbc-${event.type}-${event.project}`,
      detailed: notification.detailed || false,
    });
    for (const [endpoint, sub] of pushSubscriptions) {
      webpush.sendNotification(sub, pushPayload).catch(err => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          pushSubscriptions.delete(endpoint);
        }
      });
    }
  }
}
const startTime = Date.now();

// --- Logging ---
function log(msg, projectId = null) {
  const ts = new Date().toLocaleString('sv-SE', { hour12: false }).replace(',', '');
  const prefix = projectId ? `[${projectId}]` : '[tbc]';
  const line = `${ts} ${prefix} ${msg}`;
  console.log(line);
  if (projectId) {
    const runner = orchestrator.getProject(projectId);
    if (runner) {
      const logPath = runner.orchestratorLogPath;
      try { fs.appendFileSync(logPath, line + '\n'); } catch {}
    }
  }
}

// --- GitHub URL Parser ---
function parseGithubUrl(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\s.]+)/);
  if (!match) return null;
  const [, username, reponame] = match;
  const id = `${username}/${reponame}`;
  const projectDir = path.join(TBC_HOME, 'dev', 'src', 'github.com', username, reponame);
  const repoDir = path.join(projectDir, 'repo');
  const cloneUrl = `https://github.com/${username}/${reponame}.git`;
  return { id, username, reponame, projectDir, repoDir, cloneUrl };
}

// ProjectRunner lives in src/orchestrator/ProjectRunner.js.
const ProjectRunner = createProjectRunnerClass({
  TBC_HOME,
  ROOT,
  broadcastStatusUpdate,
  broadcastReportUpdate,
  broadcastLiveAgentEvent,
  broadcastEvent,
  log,
  parseGithubUrl,
  stripMetaBlocks,
  sleep,
  getProviderRuntimeSelection,
  parseExplicitModelSelection,
  detectProviderFromToken,
  formatStoredChatErrorMessage,
  parseSummarizeCooldown,
  getKeyPoolSafe,
  getOAuthAccessToken,
});

const orchestrator = new LocalOrchestrator({
  tbcHome: TBC_HOME,
  RunnerClass: ProjectRunner,
  projects,
  log,
});

// --- Load Projects ---

function loadProjects() {
  return orchestrator.loadProjectRegistry();
}

function syncProjects() {
  return orchestrator.syncProjects();
}

// --- Basic Auth ---
const { isAuthenticated, requireWrite, passwordRequired } = createAuth({
  password: process.env.TBC_PASSWORD || null,
});

const routeContext = {
  get vapidPublic() { return VAPID_PUBLIC; },
  pushSubscriptions,
  notifications,
  sseClients,
  isAuthenticated,
  passwordRequired,
  orchestrator,
  startTime,
  requireWrite,
  syncProjects,
  allowCustomProvider: ALLOW_CUSTOM_PROVIDER,
  getKeyPoolSafe,
  addKey,
  addOAuthKey,
  updateKey,
  removeKey,
  reorderKeys,
  listOAuthProviders,
  startOAuthLogin,
  submitManualCode,
  checkOAuthStatus,
  clearOAuthCredentials,
  tbcHome: TBC_HOME,
  maskToken,
  detectTokenProvider,
  loadOAuthCredentials,
  loadKeyPool,
  parseGithubUrl,
  log,
};

// --- HTTP API ---
const server = http.createServer(async (req, res) => {

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  // CORS: only allow requests from the same origin (the dashboard served by this server)
  const origin = req.headers.origin;
  const allowedOrigin = `http://localhost:${PORT}`;
  if (origin === allowedOrigin || origin === `http://127.0.0.1:${PORT}`) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (await handleRealtimeRoutes(req, res, url, routeContext)) return;

  if (await handleSettingsRoutes(req, res, url, routeContext)) return;

  if (await handleKeyRoutes(req, res, url, routeContext)) return;

  if (await handleOAuthRoutes(req, res, url, routeContext)) return;

  if (await handleModelRoutes(req, res, url)) return;

  if (await handleGlobalRoutes(req, res, url, routeContext)) return;

  if (await handleGithubRoutes(req, res, url, routeContext)) return;

  if (await handleProjectRegistryRoutes(req, res, url, pathParts, routeContext)) return;

  // --- Project-scoped API ---
  // Support both single-segment (m2sim) and two-segment (sarchlab/m2sim) IDs

  if (pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2]) {
    const twoSegId = pathParts[3] ? `${pathParts[2]}/${pathParts[3]}` : null;
    let projectId, subPathStart;
    if (twoSegId && orchestrator.hasProject(twoSegId)) {
      projectId = twoSegId;
      subPathStart = 4;
    } else {
      projectId = pathParts[2];
      subPathStart = 3;
    }
    const runner = orchestrator.getProject(projectId);

    if (!runner) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    const subPath = pathParts.slice(subPathStart).join('/');

    const projectRouteContext = {
      ...routeContext,
      runner,
      projectId,
      subPath,
      root: ROOT,
      buildCustomTierMap,
      modelTiers: MODEL_TIERS,
      getPiModels,
      getOAuthAccessToken,
      getProviderRuntimeSelection,
      parseSummarizeCooldown,
      parseExplicitModelSelection,
      detectProviderFromToken,
      formatStoredChatErrorMessage,
    };

    if (await handleProjectStatusRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectConfigRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectActivityRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectIssueRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectReportRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectRepoRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectChatRoutes(req, res, url, projectRouteContext)) return;

    if (await handleProjectActionRoutes(req, res, url, projectRouteContext)) return;
  }

  // --- Static Files ---
  if (SERVE_STATIC && fs.existsSync(MONITOR_DIST)) {
    serveStatic(req, res, url.pathname, MONITOR_DIST);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Helpers ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Preflight checks ---
function checkPrerequisites() {
  const missing = [];
  try { execSync('gh --version', { stdio: 'pipe' }); } catch { missing.push('gh (GitHub CLI) — install from https://cli.github.com'); }
  try { execSync('claude --version', { stdio: 'pipe' }); } catch { missing.push('claude (Claude Code CLI) — install from https://docs.anthropic.com/en/docs/claude-code'); }
  if (missing.length > 0) {
    log('WARNING: Missing required tools:');
    missing.forEach(m => log(`  - ${m}`));
    log('Some features will not work without these tools.');
  }
}

// --- Main ---
log('TheBotCompany starting...');
checkPrerequisites();
syncProjects();
// Migrate existing keys from .env and project configs into key-pool.json
migrateFromEnv(projects);
server.listen(PORT, () => {
  log(`Server listening on http://localhost:${PORT}`);
  if (SERVE_STATIC && fs.existsSync(MONITOR_DIST)) {
    log(`Serving monitor from ${MONITOR_DIST}`);
  }
});

process.on('SIGINT', () => {
  log('Shutting down...');
  for (const runner of orchestrator.listProjects()) {
    runner.stop();
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('Shutting down...');
  for (const runner of orchestrator.listProjects()) {
    runner.stop();
  }
  process.exit(0);
});
