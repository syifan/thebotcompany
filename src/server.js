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
import { spawn, execSync } from 'child_process';
import yaml from 'js-yaml';
import Database from 'better-sqlite3';
import { runAgentWithAPI } from './agent-runner.js';
import { listSessions as chatListSessions, createSession as chatCreateSession, getSession as chatGetSession, deleteSession as chatDeleteSession, updateSessionPreferences as chatUpdateSessionPreferences, streamChatMessage, getActiveStream, isStreaming as isChatStreaming, saveMessage as chatSaveMessage } from './chat.js';
import { resolveModel, callModel, buildUserMessage, getModels as getPiModels } from './providers/index.js';
import { buildCustomTierMap, resolveProviderRuntime } from './providers/custom-config.js';
import { startOAuthLogin, submitManualCode, checkOAuthStatus, getAccessToken as getOAuthAccessToken, clearCredentials as clearOAuthCredentials, listOAuthProviders, loadCredentials as loadOAuthCredentials } from './oauth.js';
import {
  loadKeyPool, addKey, addOAuthKey, removeKey, updateKey, reorderKeys,
  getKeyPoolSafe, resolveKeyForProject, markRateLimited, markKeySucceeded, migrateFromEnv,
  detectTokenProvider as detectTokenProviderFromPool,
} from './key-pool.js';
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
    const runner = projects.get(projectId);
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
    const runner = projects.get(projectId);
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

// --- MIME Types ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// --- Project Runner ---
class ProjectRunner {
  constructor(id, config) {
    this.id = id;
    this.path = config.path.replace(/^~/, process.env.HOME);
    this.enabled = config.enabled !== false;
    this.archived = config.archived === true;
    this.cycleCount = 0;   // Cycles: manager + worker runs
    this.epochCount = 0;   // Epochs: full Athena → implementation → verification → Athena loops
    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.isPaused = false;
    this.sleepUntil = null;
    this.wakeNow = false;
    this.running = false;
    this.lastComputedSleepMs = null; // Cached sleep interval
    this.currentSchedule = null;
    this.abortCurrentCycle = false;
    // Phase state machine: athena | implementation | verification | examination
    this.phase = 'athena'; // Start by asking Athena for first milestone
    this.milestoneTitle = null;
    this.milestoneDescription = null;
    this.milestoneCyclesBudget = 0;
    this.milestoneCyclesUsed = 0;
    this.currentMilestoneId = null;
    this.pendingMilestoneId = null;
    this.currentEpochId = null;
    this.currentEpochPrId = null;
    this.currentMilestoneBranch = null;
    this.lastMergedMilestoneBranch = null;
    this.aresGraceCycleUsed = false;
    this.verificationFeedback = null;
    this.examinationFeedback = null;
    this.pendingCompletionMessage = null;
    this.isFixRound = false; // legacy flag, should stay false under epoch-as-PR flow
    this.isComplete = false;
    this.completionSuccess = false;
    this.completionMessage = null;
    this.consecutiveFailures = 0; // Track consecutive agent failures for auto-pause
    this.currentAgentLog = [];
    this.currentAgentModel = null; this.currentAgentCost = 0; this.currentAgentUsage = null; this.currentAgentKeyId = null; this.currentAgentVisibility = null;
    this._repo = null;
  }

  /**
   * Centralized state mutation with invariant enforcement.
   * All state changes should go through this method.
   * Automatically saves state and enforces consistency rules.
   */
  setState(patch, { save = true } = {}) {
    // Apply patch
    for (const [key, value] of Object.entries(patch)) {
      this[key] = value;
    }

    // Enforce invariants
    // 1. Complete projects are always paused
    if (this.isComplete) {
      this.isPaused = true;
    }
    // 2. Paused projects have no sleep countdown
    if (this.isPaused) {
      this.sleepUntil = null;
      this.lastComputedSleepMs = null;
    }
    // 3. Phase reset: when entering athena phase, clear implementation/verification state
    if (patch.phase === 'athena' && !patch.milestoneDescription) {
      // Don't clear milestone info if it wasn't explicitly set — Athena needs context
    }

    if (save) this.saveState();

    // Broadcast status update via SSE for instant dashboard refresh
    broadcastStatusUpdate(this.id);
  }

  get projectDir() {
    const repo = this.repo;
    if (repo) {
      return path.join(TBC_HOME, 'dev', 'src', 'github.com', ...repo.split('/'));
    }
    return path.join(TBC_HOME, 'local', this.id);
  }

  get agentDir() {
    return this.projectDir;
  }

  get chatsDir() {
    return path.join(this.projectDir, 'chats');
  }

  get agentsDir() {
    return path.join(this.projectDir, 'agents');
  }

  get responsesDir() {
    return path.join(this.projectDir, 'responses');
  }

  get uploadsDir() {
    return path.join(this.projectDir, 'uploads');
  }

  get projectDbPath() {
    return path.join(this.projectDir, 'project.db');
  }

  get orchestratorLogPath() {
    return path.join(this.projectDir, 'orchestrator.log');
  }

  get statePath() {
    return path.join(this.projectDir, 'state.json');
  }

  get stopPath() {
    return path.join(this.projectDir, 'STOP');
  }

  getAgentNotesDir(agentName) {
    return path.join(this.agentsDir, agentName);
  }

  getOperationalPaths() {
    return [
      this.projectDbPath,
      this.orchestratorLogPath,
      this.responsesDir,
      this.agentsDir,
      this.uploadsDir,
      this.statePath,
      this.stopPath,
    ];
  }

  get skillsDir() {
    return path.join(this.projectDir, 'skills');
  }

  get knowledgeDir() {
    return path.join(this.projectDir, 'knowledge');
  }

  get workerSkillsDir() {
    return path.join(this.skillsDir, 'workers');
  }

  get repo() {
    if (this._repo === null) {
      try {
        const remoteUrl = execSync('git remote get-url origin', {
          cwd: this.path,
          encoding: 'utf-8'
        }).trim();
        const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
        this._repo = match ? match[1] : null;
      } catch {
        this._repo = null;
      }
    }
    return this._repo;
  }

  get configPath() {
    return path.join(this.projectDir, 'config.yaml');
  }

  loadConfig() {
    const defaults = { cycleIntervalMs: 0, agentTimeoutMs: 3600000, model: 'mid', budgetPer24h: 0 };
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const config = yaml.load(raw) || {};
      // Validate numeric fields
      for (const key of ['cycleIntervalMs', 'agentTimeoutMs', 'budgetPer24h']) {
        if (config[key] !== undefined && (typeof config[key] !== 'number' || config[key] < 0)) {
          log(`WARNING: Invalid ${key} in config.yaml (${config[key]}), using default`, this.id);
          config[key] = defaults[key];
        }
      }
      return { ...defaults, ...config };
    } catch (e) {
      return defaults;
    }
  }

  saveConfig(content) {
    fs.mkdirSync(this.projectDir, { recursive: true });
    yaml.load(content); // Validate YAML
    fs.writeFileSync(this.configPath, content);
  }

  loadAgents() {
    const managers = [];
    const workers = [];
    
    const managersDir = path.join(ROOT, 'agent', 'managers');
    const workersDir = this.workerSkillsDir;
    
    const parseRole = (content) => {
      // Prefer frontmatter role: field
      const fmRole = (content.match(/^role:\s*(.+)$/m) || [])[1]?.trim();
      if (fmRole) return fmRole;
      // Fallback: match "# Name (Role)" in markdown
      const match = content.match(/^#\s*\w+\s*\(([^)]+)\)/m);
      return match ? match[1] : null;
    };
    
    const shortenModel = (model) => {
      if (!model) return null;
      const versionMatch = model.match(/(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i);
      if (versionMatch) {
        const name = versionMatch[1].toLowerCase();
        const major = versionMatch[2];
        const minor = versionMatch[3];
        return minor && minor.length <= 2 ? `${name} ${major}.${minor}` : `${name} ${major}`;
      }
      if (model.includes('opus')) return 'opus';
      if (model.includes('sonnet')) return 'sonnet';
      if (model.includes('haiku')) return 'haiku';
      return model;
    };
    
    const parseModel = (content) => {
      const match = content.match(/^model:\s*(.+)$/m);
      return match ? shortenModel(match[1].trim()) : null;
    };
    
    const config = this.loadConfig();
    const managerOverrides = config.managers || {};
    
    if (fs.existsSync(managersDir)) {
      for (const file of fs.readdirSync(managersDir)) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
          const overrides = managerOverrides[name] || {};
          // Disabled check: config override takes priority, then frontmatter
          const isDisabled = overrides.disabled !== undefined ? overrides.disabled : /^disabled:\s*true$/m.test(content);
          if (isDisabled) continue;
          // Model: config override takes priority, then frontmatter
          const frontmatterModel = (content.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null;
          const rawModel = overrides.model || frontmatterModel;
          managers.push({ name, role: parseRole(content), model: shortenModel(rawModel), rawModel, isManager: true });
        }
      }
    }
    
    if (fs.existsSync(workersDir)) {
      for (const file of fs.readdirSync(workersDir)) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
          if (/^disabled:\s*true$/m.test(content)) continue;
          const reportsTo = (content.match(/^reports_to:\s*(.+)$/m) || [])[1]?.trim() || null;
          workers.push({ name, role: parseRole(content), model: parseModel(content), rawModel: (content.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null, isManager: false, reportsTo });
        }
      }
    }
    
    const costSummary = this.getCostSummary();
    for (const agent of [...managers, ...workers]) {
      const agentCost = costSummary.agents[agent.name];
      agent.totalCost = agentCost ? agentCost.totalCost : 0;
      agent.last24hCost = agentCost ? agentCost.last24hCost : 0;
      agent.lastCallCost = agentCost ? agentCost.lastCallCost : 0;
      agent.avgCallCost = agentCost ? agentCost.avgCallCost : 0;
      agent.callCount = agentCost ? agentCost.callCount : 0;
    }

    return { managers, workers };
  }

  getAgentDetails(agentName) {
    const workersDir = this.workerSkillsDir;
    const managersDir = path.join(ROOT, 'agent', 'managers');
    const agentNotesDir = this.getAgentNotesDir(agentName);
    
    let skillPath = path.join(workersDir, `${agentName}.md`);
    let isManager = false;
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(managersDir, `${agentName}.md`);
      isManager = true;
    }
    
    if (!fs.existsSync(skillPath)) {
      return null;
    }
    
    const skill = fs.readFileSync(skillPath, 'utf-8');
    
    let agentFiles = [];
    if (fs.existsSync(agentNotesDir)) {
      agentFiles = fs.readdirSync(agentNotesDir).flatMap(f => {
        const filePath = path.join(agentNotesDir, f);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return [];
        return [{
          name: f,
          size: stat.size,
          modified: stat.mtime,
          content: stat.size < 50000 ? fs.readFileSync(filePath, 'utf-8') : null
        }];
      });
    }
    
    // Get last response from response log
    let lastResponse = null;
    let lastRawOutput = null;
    const responseLogPath = path.join(this.responsesDir, `${agentName}.log`);
    const rawLogPath = path.join(this.responsesDir, `${agentName}.raw.log`);
    
    const getLastBlock = (filePath, maxChars = 15000) => {
      if (!fs.existsSync(filePath)) return null;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const blocks = content.split(/={60,}/);
        if (blocks.length >= 2) {
          const lastBlock = blocks.slice(-2).join('').trim();
          return lastBlock.length > maxChars ? lastBlock.slice(-maxChars) : lastBlock;
        }
      } catch {}
      return null;
    };
    
    lastResponse = getLastBlock(responseLogPath);
    lastRawOutput = getLastBlock(rawLogPath);
    
    // Extract model from frontmatter
    const modelMatch = skill.match(/^model:\s*(.+)$/m);
    const frontmatterModel = modelMatch ? modelMatch[1].trim() : null;
    
    // Check config override (config.managers.<name>.model or config.workers.<name>.model)
    const config = this.loadConfig();
    const overrides = (isManager ? config.managers : config.workers) || {};
    const configModel = overrides[agentName]?.model || null;
    const model = configModel || frontmatterModel || null;
    
    // Read shared rules: everyone.md + role-specific (worker.md or manager.md)
    let everyone = null;
    let roleRules = null;
    try { everyone = fs.readFileSync(path.join(ROOT, 'agent', 'everyone.md'), 'utf-8'); } catch {}
    try { roleRules = fs.readFileSync(path.join(ROOT, 'agent', isManager ? 'manager.md' : 'worker.md'), 'utf-8'); } catch {}

    return { name: agentName, isManager, skill, agentFiles, lastResponse, lastRawOutput, model, everyone, roleRules };
  }

  getLogs(lines = 50) {
    const logPath = this.orchestratorLogPath;
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).slice(-lines);
  }

  getCostSummary() {
    const empty = { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, lastCycleDuration: 0, avgCycleDuration: 0, agents: {} };
    try {
      const db = this.getDb();
      // Ensure cost columns exist
      try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Total cost
      const totalCost = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports').get().v;
      const last24hCost = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports WHERE created_at > ?').get(cutoff).v;

      // Per-cycle data
      const cycles = db.prepare('SELECT cycle, SUM(cost) as cost, SUM(duration_ms) as duration FROM reports WHERE cost IS NOT NULL GROUP BY cycle ORDER BY cycle ASC').all();
      let lastCycleCost = 0, avgCycleCost = 0, lastCycleDuration = 0, avgCycleDuration = 0;
      if (cycles.length > 0) {
        const last = cycles[cycles.length - 1];
        lastCycleCost = last.cost || 0;
        lastCycleDuration = last.duration || 0;
        const totalCycleCost = cycles.reduce((s, c) => s + (c.cost || 0), 0);
        const totalCycleDuration = cycles.reduce((s, c) => s + (c.duration || 0), 0);
        avgCycleCost = totalCycleCost / cycles.length;
        avgCycleDuration = totalCycleDuration / cycles.length;
      }

      // Per-agent data
      const agentRows = db.prepare(`SELECT agent,
        COALESCE(SUM(cost), 0) as totalCost,
        COALESCE(SUM(CASE WHEN created_at > ? THEN cost ELSE 0 END), 0) as last24hCost,
        COUNT(*) as callCount
        FROM reports WHERE cost IS NOT NULL GROUP BY agent`).all(cutoff);
      const agents = {};
      for (const row of agentRows) {
        const lastCall = db.prepare('SELECT cost FROM reports WHERE agent = ? AND cost IS NOT NULL ORDER BY id DESC LIMIT 1').get(row.agent);
        agents[row.agent] = {
          totalCost: row.totalCost,
          last24hCost: row.last24hCost,
          callCount: row.callCount,
          lastCallCost: lastCall?.cost || 0,
          avgCallCost: row.callCount > 0 ? row.totalCost / row.callCount : 0,
        };
      }

      db.close();

      return { totalCost, last24hCost, lastCycleCost, avgCycleCost, lastCycleDuration, avgCycleDuration, agents };
    } catch {
      return empty;
    }
  }

  computeSleepInterval() {
    const config = this.loadConfig();
    const budgetPer24h = config.budgetPer24h || 0;
    const MIN_SLEEP = 10000;       // 10s
    const MAX_SLEEP = 7200000;     // 2h

    // If no budget set, fall back to fixed interval
    if (budgetPer24h <= 0) {
      return Math.max(config.cycleIntervalMs || 0, MIN_SLEEP);
    }

    const minFloor = config.cycleIntervalMs > 0 ? config.cycleIntervalMs : MIN_SLEEP;

    // Query cost data from SQLite reports table
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let cycleCosts = [];
    let spent24h = 0;
    let oldestTime24h = Infinity;

    try {
      const db = this.getDb();
      try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}

      spent24h = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports WHERE created_at > ?').get(cutoff).v;
      const oldest = db.prepare('SELECT MIN(created_at) as v FROM reports WHERE created_at > ?').get(cutoff);
      if (oldest?.v) oldestTime24h = new Date(oldest.v).getTime();

      const cycles = db.prepare('SELECT cycle, SUM(cost) as cost, MAX(duration_ms) as duration FROM reports WHERE cost IS NOT NULL GROUP BY cycle ORDER BY cycle ASC').all();
      cycleCosts = cycles.map(c => ({ cost: c.cost || 0, duration: c.duration || 0 }));
      db.close();
    } catch {}

    const remaining = budgetPer24h - spent24h;

    // Budget exhaustion: sleep until oldest entry rolls off
    if (remaining <= 0) {
      if (oldestTime24h < Infinity) {
        const rolloffAt = oldestTime24h + 24 * 60 * 60 * 1000;
        const waitMs = Math.max(rolloffAt - Date.now(), MIN_SLEEP);
        log(`Budget exhausted ($${spent24h.toFixed(2)}/$${budgetPer24h}), sleeping until oldest entry rolls off`, this.id);
        return Math.min(waitMs, MAX_SLEEP);
      }
      log(`Budget exhausted, sleeping max`, this.id);
      return MAX_SLEEP;
    }

    const n = cycleCosts.length;

    // Cold start: no historical data
    if (n === 0) {
      const { managers, workers } = this.loadAgents();
      const agentCount = managers.length + workers.length || 3;
      const model = (config.model || '').toLowerCase();
      let perAgentCost;
      if (model.includes('opus')) perAgentCost = 2.50;
      else if (model.includes('haiku')) perAgentCost = 0.50;
      else perAgentCost = 1.50; // sonnet default

      const estimatedCycleCost = perAgentCost * agentCount;
      const agentTimeout = config.agentTimeoutMs > 0 ? config.agentTimeoutMs : 900000;
      const estimatedCycleDuration = (agentTimeout / 2) * agentCount;

      const nAffordable = Math.floor(remaining / (estimatedCycleCost * 1.5)); // k=1.5 for cold start
      if (nAffordable <= 0) return MAX_SLEEP;
      const sleepMs = (86400000 / nAffordable) - estimatedCycleDuration;
      log(`Cold start: est cycle cost $${estimatedCycleCost.toFixed(2)}, affordable=${nAffordable}, sleep=${Math.round(sleepMs / 1000)}s`, this.id);
      return Math.max(minFloor, Math.min(sleepMs, MAX_SLEEP));
    }

    // Compute EMA of cycle costs and durations (alpha=0.3) with outlier dampening
    const alpha = 0.3;
    let emaCost = cycleCosts[0].cost;
    let emaDuration = cycleCosts[0].duration;

    for (let i = 1; i < n; i++) {
      let cycleCost = cycleCosts[i].cost;

      // Outlier dampening: if cost > 3x EMA and we have >= 3 data points, clamp to 2x EMA
      if (i >= 3 && cycleCost > 3 * emaCost) {
        cycleCost = 2 * emaCost;
      }

      emaCost = alpha * cycleCost + (1 - alpha) * emaCost;
      emaDuration = alpha * cycleCosts[i].duration + (1 - alpha) * emaDuration;
    }

    // Conservatism factor: k = 1.0 + 0.5 / sqrt(n)
    const k = 1.0 + 0.5 / Math.sqrt(n);

    const nAffordable = Math.floor(remaining / (emaCost * k));
    if (nAffordable <= 0) {
      log(`Budget nearly exhausted (remaining=$${remaining.toFixed(2)}, est/cycle=$${emaCost.toFixed(2)}), sleeping max`, this.id);
      return MAX_SLEEP;
    }

    const sleepMs = (86400000 / nAffordable) - emaDuration;
    log(`Budget: $${spent24h.toFixed(2)}/$${budgetPer24h} spent, est/cycle=$${emaCost.toFixed(2)}, k=${k.toFixed(2)}, affordable=${nAffordable}, sleep=${Math.round(Math.max(minFloor, Math.min(sleepMs, MAX_SLEEP)) / 1000)}s`, this.id);
    return Math.max(minFloor, Math.min(sleepMs, MAX_SLEEP));
  }

  getBudgetStatus() {
    const config = this.loadConfig();
    const budgetPer24h = config.budgetPer24h || 0;
    if (budgetPer24h <= 0) return null;

    const costSummary = this.getCostSummary();
    const spent24h = costSummary.last24hCost;
    const remaining24h = budgetPer24h - spent24h;
    const percentUsed = budgetPer24h > 0 ? (spent24h / budgetPer24h) * 100 : 0;
    const exhausted = remaining24h <= 0;

    return {
      budgetPer24h,
      spent24h,
      remaining24h,
      percentUsed,
      computedSleepMs: this.lastComputedSleepMs, // Use cached value
      exhausted
    };
  }

  _syncAgentRegistry(db) {
    const upsert = db.prepare(`
      INSERT INTO agents (name, role, reports_to, model, disabled)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        role = excluded.role,
        reports_to = excluded.reports_to,
        model = excluded.model,
        disabled = excluded.disabled
    `);
    const managersDir = path.join(ROOT, 'agent', 'managers');
    const workersDir = this.workerSkillsDir;
    const parseRole = (content) => (content.match(/^role:\s*(.+)$/m) || [])[1]?.trim() || null;
    const parseModel = (content) => (content.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null;

    if (fs.existsSync(managersDir)) {
      for (const file of fs.readdirSync(managersDir)) {
        if (!file.endsWith('.md')) continue;
        const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
        const name = file.replace('.md', '');
        const disabled = /^disabled:\s*true$/m.test(content) ? 1 : 0;
        upsert.run(name, parseRole(content), null, parseModel(content), disabled);
      }
    }

    if (fs.existsSync(workersDir)) {
      for (const file of fs.readdirSync(workersDir)) {
        if (!file.endsWith('.md')) continue;
        const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
        const name = file.replace('.md', '');
        const disabled = /^disabled:\s*true$/m.test(content) ? 1 : 0;
        const reportsTo = (content.match(/^reports_to:\s*(.+)$/m) || [])[1]?.trim() || null;
        upsert.run(name, parseRole(content), reportsTo, parseModel(content), disabled);
      }
    }
  }

  _resolveAllowedIssueClosers(db, issueCreator) {
    if (issueCreator === 'human' || issueCreator === 'chat') {
      return { allowed: new Set(['human', 'chat']), special: 'chat-human' };
    }
    return { allowed: new Set([issueCreator, 'athena']), special: 'agent-athena' };
  }

  getDb() {
    const dbPath = this.projectDbPath;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, role TEXT, reports_to TEXT, model TEXT, disabled INTEGER DEFAULT 0, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
      CREATE TABLE IF NOT EXISTS issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT DEFAULT '', status TEXT DEFAULT 'open', creator TEXT NOT NULL, assignee TEXT, labels TEXT DEFAULT '', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_by TEXT, closed_at TEXT, closed_by TEXT);
      CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL REFERENCES issues(id), author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
      CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, milestone_id TEXT UNIQUE, title TEXT, description TEXT NOT NULL, cycles_budget INTEGER DEFAULT 20, cycles_used INTEGER DEFAULT 0, branch_name TEXT, parent_milestone_id TEXT, linked_pr_id INTEGER, failure_reason TEXT, phase TEXT DEFAULT 'implementation', status TEXT DEFAULT 'active', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), completed_at TEXT);
      CREATE TABLE IF NOT EXISTS tbc_prs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, summary TEXT DEFAULT '', milestone_id TEXT, parent_pr_id INTEGER, epoch_index TEXT, branch_name TEXT, base_branch TEXT NOT NULL, head_branch TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'merged', 'closed')), decision TEXT, decision_reason TEXT DEFAULT '', issue_ids TEXT DEFAULT '[]', test_status TEXT DEFAULT 'unknown', github_pr_number INTEGER, github_pr_url TEXT, actor TEXT, updated_by TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
    `);
    try { db.exec('ALTER TABLE issues ADD COLUMN updated_by TEXT'); } catch {}
    try { db.exec('ALTER TABLE issues ADD COLUMN closed_by TEXT'); } catch {}
    try { db.exec('ALTER TABLE milestones ADD COLUMN milestone_id TEXT'); } catch {}
    try { db.exec('ALTER TABLE milestones ADD COLUMN title TEXT'); } catch {}
    try { db.exec('ALTER TABLE milestones ADD COLUMN branch_name TEXT'); } catch {}
    try { db.exec('ALTER TABLE milestones ADD COLUMN parent_milestone_id TEXT'); } catch {}
    try { db.exec('ALTER TABLE milestones ADD COLUMN linked_pr_id INTEGER'); } catch {}
    try { db.exec('ALTER TABLE milestones ADD COLUMN failure_reason TEXT'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN milestone_id TEXT'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN parent_pr_id INTEGER'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN epoch_index TEXT'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN branch_name TEXT'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN decision TEXT'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN decision_reason TEXT DEFAULT ""'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN actor TEXT'); } catch {}
    try { db.exec('ALTER TABLE tbc_prs ADD COLUMN updated_by TEXT'); } catch {}
    db.exec(`
      UPDATE tbc_prs
      SET status = CASE
        WHEN status = 'merged' THEN 'merged'
        WHEN status IN ('closed', 'completed', 'superseded') THEN 'closed'
        ELSE 'open'
      END
      WHERE status NOT IN ('open', 'merged', 'closed');
      CREATE TRIGGER IF NOT EXISTS tbc_prs_status_insert_check
      BEFORE INSERT ON tbc_prs
      FOR EACH ROW
      WHEN NEW.status NOT IN ('open', 'merged', 'closed')
      BEGIN
        SELECT RAISE(ABORT, 'invalid tbc_prs.status');
      END;
      CREATE TRIGGER IF NOT EXISTS tbc_prs_status_update_check
      BEFORE UPDATE OF status ON tbc_prs
      FOR EACH ROW
      WHEN NEW.status NOT IN ('open', 'merged', 'closed')
      BEGIN
        SELECT RAISE(ABORT, 'invalid tbc_prs.status');
      END;
    `);
    this._syncAgentRegistry(db);
    return db;
  }

  async getComments(author, page = 1, perPage = 20) {
    try {
      const db = this.getDb();
      let query, countQuery, params;
      if (author) {
        query = `SELECT c.id, c.issue_id, c.author, c.body, c.created_at FROM comments c WHERE c.author = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
        countQuery = `SELECT COUNT(*) as total FROM comments WHERE author = ?`;
        params = [author, perPage, (page - 1) * perPage];
      } else {
        query = `SELECT c.id, c.issue_id, c.author, c.body, c.created_at FROM comments c ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
        countQuery = `SELECT COUNT(*) as total FROM comments`;
        params = [perPage, (page - 1) * perPage];
      }
      const comments = db.prepare(query).all(...params).map(c => ({ ...c, agent: c.author }));
      const { total } = author ? db.prepare(countQuery).get(author) : db.prepare(countQuery).get();
      db.close();
      return {
        comments,
        total,
        page,
        perPage,
        hasMore: page * perPage < total
      };
    } catch (e) {
      return { comments: [], total: 0, error: e.message };
    }
  }

  async getPRs(status = 'open') {
    try {
      const db = this.getDb();
      let query = `
        SELECT id, title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, github_pr_number, github_pr_url, actor, updated_by, created_at, updated_at
        FROM tbc_prs
      `;
      const params = [];
      if (status === 'open' || status === 'merged' || status === 'closed') {
        query += ` WHERE status = ?`;
        params.push(status);
      }
      query += `
        ORDER BY updated_at DESC, id DESC
        LIMIT 50
      `;
      const prs = db.prepare(query).all(...params);
      db.close();
      return prs.map(pr => ({
        ...pr,
        number: pr.id,
        headRefName: pr.head_branch,
        baseRefName: pr.base_branch,
        shortTitle: pr.title,
        issueIds: (() => { try { return JSON.parse(pr.issue_ids || '[]'); } catch { return []; } })(),
      }));
    } catch {
      return [];
    }
  }

  async getPR(prId) {
    try {
      const db = this.getDb();
      const pr = db.prepare(`
        SELECT id, title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, github_pr_number, github_pr_url, actor, updated_by, created_at, updated_at
        FROM tbc_prs
        WHERE id = ?
      `).get(prId);
      db.close();
      if (!pr) return null;
      return {
        ...pr,
        number: pr.id,
        headRefName: pr.head_branch,
        baseRefName: pr.base_branch,
        shortTitle: pr.title,
        issueIds: (() => { try { return JSON.parse(pr.issue_ids || '[]'); } catch { return []; } })(),
      };
    } catch {
      return null;
    }
  }

  async getOpenEpochPRForCurrentMilestone() {
    try {
      const db = this.getDb();
      const pr = db.prepare(`
        SELECT * FROM tbc_prs
        WHERE status = 'open'
          AND (
            (branch_name IS NOT NULL AND branch_name = ?)
            OR head_branch = ?
          )
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get(this.currentMilestoneBranch || '', this.currentMilestoneBranch || '');
      db.close();
      return pr || null;
    } catch {
      return null;
    }
  }

  async decideEpochPR(status, { actor = 'apollo', reason = '' } = {}) {
    const pr = await this.getOpenEpochPRForCurrentMilestone();
    if (!pr) return null;
    try {
      const db = this.getDb();
      const normalizedStatus = status === 'merged' ? 'merged' : 'closed';
      db.prepare(`
        UPDATE tbc_prs
        SET status = ?, decision = ?, decision_reason = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(
        normalizedStatus,
        normalizedStatus === 'merged' ? 'merge' : 'close',
        reason || '',
        actor,
        new Date().toISOString(),
        pr.id,
      );
      db.close();
      return { ...pr, status: normalizedStatus, decision: normalizedStatus === 'merged' ? 'merge' : 'close', decision_reason: reason || '' };
    } catch {
      return null;
    }
  }

  closeOpenEpochPRForBranch(branchName, { actor = 'apollo', reason = '' } = {}) {
    if (!branchName) return null;
    try {
      const db = this.getDb();
      const pr = db.prepare(`
        SELECT * FROM tbc_prs
        WHERE status = 'open'
          AND (
            (branch_name IS NOT NULL AND branch_name = ?)
            OR head_branch = ?
          )
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get(branchName, branchName);
      if (!pr) {
        db.close();
        return null;
      }
      const normalizedStatus = 'closed';
      db.prepare(`
        UPDATE tbc_prs
        SET status = ?, decision = ?, decision_reason = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(
        normalizedStatus,
        'close',
        reason || '',
        actor,
        new Date().toISOString(),
        pr.id,
      );
      db.close();
      return { ...pr, status: normalizedStatus, decision: 'close', decision_reason: reason || '' };
    } catch {
      return null;
    }
  }

  normalizeResetTargetMilestone(resetTo) {
    const value = typeof resetTo === 'string' ? resetTo.trim() : '';
    if (!value) return null;
    if (/^root$/i.test(value)) return { milestoneId: null, label: 'root' };
    const current = String(this.currentMilestoneId || '').trim();
    if (!current) return null;
    const candidate = value.replace(/^m/i, 'M');
    const ancestors = [];
    const parts = current.split('.');
    for (let i = parts.length; i >= 1; i--) ancestors.push(parts.slice(0, i).join('.'));
    if (!ancestors.includes(candidate)) return null;
    return { milestoneId: candidate, label: candidate };
  }

  getParentMilestoneId(milestoneId = null) {
    const value = String(milestoneId || '').trim();
    if (!value || !value.includes('.')) return null;
    return value.split('.').slice(0, -1).join('.') || null;
  }

  async getMilestoneRecord(milestoneId) {
    if (!milestoneId) return null;
    try {
      const db = this.getDb();
      const row = db.prepare(`SELECT * FROM milestones WHERE milestone_id = ?`).get(milestoneId);
      db.close();
      return row || null;
    } catch {
      return null;
    }
  }

  makeMilestoneBranchPrefix(milestoneId) {
    return String(milestoneId || 'M0').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  slugifyMilestoneTitle(title, { stripLeadingMilestoneId = null } = {}) {
    let normalizedTitle = String(title || 'milestone');
    if (stripLeadingMilestoneId) {
      const escapedMilestoneId = String(stripLeadingMilestoneId)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\./g, '[\\s._-]*');
      normalizedTitle = normalizedTitle.replace(new RegExp(`^\\s*${escapedMilestoneId}(?:[\\s:._-]+|\\b)`, 'i'), '');
    }
    return normalizedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'milestone';
  }

  async allocateNextMilestoneId(parentMilestoneId = null) {
    try {
      const db = this.getDb();
      let nextId = 'M1';
      if (parentMilestoneId) {
        const rows = db.prepare(`SELECT milestone_id FROM milestones WHERE parent_milestone_id = ? OR milestone_id LIKE ?`).all(parentMilestoneId, `${parentMilestoneId}.%`);
        let maxChild = 0;
        for (const row of rows) {
          const key = String(row.milestone_id || '');
          const suffix = key.slice(parentMilestoneId.length + 1);
          if (/^\d+$/.test(suffix)) maxChild = Math.max(maxChild, Number(suffix));
        }
        nextId = `${parentMilestoneId}.${maxChild + 1}`;
      } else {
        const rows = db.prepare(`SELECT milestone_id FROM milestones WHERE milestone_id GLOB 'M*'`).all();
        let maxTop = 0;
        for (const row of rows) {
          const m = String(row.milestone_id || '').match(/^M(\d+)$/);
          if (m) maxTop = Math.max(maxTop, Number(m[1]));
        }
        nextId = `M${maxTop + 1}`;
      }
      db.close();
      return nextId;
    } catch {
      if (parentMilestoneId) return `${parentMilestoneId}.1`;
      return `M${(this.epochCount || 0) + 1}`;
    }
  }

  async allocateNextEpochId() {
    try {
      const db = this.getDb();
      const rows = db.prepare(`SELECT epoch_index FROM tbc_prs WHERE epoch_index IS NOT NULL`).all();
      let maxEpoch = 0;
      for (const row of rows) {
        const m = String(row.epoch_index || '').match(/^E(\d+)$/);
        if (m) maxEpoch = Math.max(maxEpoch, Number(m[1]));
      }
      db.close();
      return `E${maxEpoch + 1}`;
    } catch {
      return `E${(this.epochCount || 0) + 1}`;
    }
  }

  async upsertMilestoneRecord({ milestoneId, title, description, cyclesBudget, branchName, parentMilestoneId = null, status = 'active', phase = 'implementation', failureReason = null, linkedPrId = null }) {
    if (!milestoneId) return;
    try {
      const db = this.getDb();
      const existing = db.prepare(`SELECT id FROM milestones WHERE milestone_id = ?`).get(milestoneId);
      const now = new Date().toISOString();
      if (existing) {
        db.prepare(`UPDATE milestones SET title = ?, description = ?, cycles_budget = ?, branch_name = ?, parent_milestone_id = ?, linked_pr_id = ?, failure_reason = ?, phase = ?, status = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE milestone_id = ?`)
          .run(title || null, description || '', cyclesBudget || 0, branchName || null, parentMilestoneId || null, linkedPrId || null, failureReason || null, phase, status, status, now, milestoneId);
      } else {
        db.prepare(`INSERT INTO milestones (milestone_id, title, description, cycles_budget, cycles_used, branch_name, parent_milestone_id, linked_pr_id, failure_reason, phase, status) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
          .run(milestoneId, title || null, description || '', cyclesBudget || 0, branchName || null, parentMilestoneId || null, linkedPrId || null, failureReason || null, phase, status);
      }
      db.close();
    } catch {}
  }

  async ensureEpochPRForCurrentMilestone() {
    if (!this.currentMilestoneId || !this.milestoneTitle || !this.currentMilestoneBranch) return null;
    const existing = await this.getOpenEpochPRForCurrentMilestone();
    if (existing) {
      if (!this.currentEpochPrId) this.setState({ currentEpochPrId: existing.id }, { save: true });
      return existing;
    }
    try {
      const db = this.getDb();
      const now = new Date().toISOString();
      const result = db.prepare(`INSERT INTO tbc_prs (title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, actor, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, '', '[]', 'unknown', 'ares', 'ares', ?, ?)`).run(
        this.milestoneTitle,
        this.milestoneDescription || '',
        this.currentMilestoneId,
        null,
        this.currentEpochId,
        this.currentMilestoneBranch,
        'main',
        this.currentMilestoneBranch,
        now,
        now,
      );
      const prId = result.lastInsertRowid;
      db.close();
      await this.upsertMilestoneRecord({
        milestoneId: this.currentMilestoneId,
        title: this.milestoneTitle,
        description: this.milestoneDescription,
        cyclesBudget: this.milestoneCyclesBudget,
        branchName: this.currentMilestoneBranch,
        parentMilestoneId: this.currentMilestoneId.includes('.') ? this.currentMilestoneId.split('.').slice(0, -1).join('.') : null,
        linkedPrId: prId,
      });
      this.setState({ currentEpochPrId: prId }, { save: true });
      return await this.getPR(prId);
    } catch {
      return null;
    }
  }

  async markCurrentMilestoneFailed(reason) {
    if (!this.currentMilestoneId) return;
    await this.upsertMilestoneRecord({
      milestoneId: this.currentMilestoneId,
      title: this.milestoneTitle,
      description: this.milestoneDescription,
      cyclesBudget: this.milestoneCyclesBudget,
      branchName: this.currentMilestoneBranch,
      parentMilestoneId: this.currentMilestoneId.includes('.') ? this.currentMilestoneId.split('.').slice(0, -1).join('.') : null,
      status: 'failed',
      phase: 'athena',
      failureReason: reason || null,
      linkedPrId: this.currentEpochPrId,
    });
  }

  async markCurrentMilestoneCompleted() {
    if (!this.currentMilestoneId) return;
    await this.upsertMilestoneRecord({
      milestoneId: this.currentMilestoneId,
      title: this.milestoneTitle,
      description: this.milestoneDescription,
      cyclesBudget: this.milestoneCyclesBudget,
      branchName: this.currentMilestoneBranch,
      parentMilestoneId: this.currentMilestoneId.includes('.') ? this.currentMilestoneId.split('.').slice(0, -1).join('.') : null,
      status: 'completed',
      phase: 'athena',
      linkedPrId: this.currentEpochPrId,
    });
  }

  async getIssues() {
    try {
      const db = this.getDb();
      const issues = db.prepare(`
        SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id) as comment_count
        FROM issues i ORDER BY i.created_at DESC
      `).all();
      db.close();
      return issues;
    } catch {
      return [];
    }
  }

  async createIssue(title, body = '', creator = 'human', assignee = null) {
    if (!title?.trim()) throw new Error('Missing issue title');
    try {
      const db = this.getDb();
      const now = new Date().toISOString();
      const result = db.prepare(
        `INSERT INTO issues (title, body, creator, assignee, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(title.trim(), body.trim(), creator, assignee || null, now, now);
      db.close();
      return { success: true, issueId: result.lastInsertRowid };
    } catch (e) {
      throw new Error(`Failed to create issue: ${e.message}`);
    }
  }

  getStatus() {
    return {
      id: this.id,
      path: this.path,
      repo: this.repo,
      enabled: this.enabled,
      archived: this.archived,
      running: this.running,
      paused: this.isPaused,
      pauseReason: this.pauseReason || null,
      cycleCount: this.cycleCount,
      epochCount: this.epochCount,
      currentAgent: this.currentAgent,
      currentAgentModel: this.currentAgentModel,
      currentAgentKeyId: this.currentAgentKeyId || null,
      currentAgentVisibility: this.currentAgentVisibility || { mode: 'full', issues: [] },
      currentAgentRuntime: this.currentAgentStartTime
        ? Math.floor((Date.now() - this.currentAgentStartTime) / 1000)
        : null,
      sleeping: this.sleepUntil !== null && !this.isPaused,
      sleepUntil: this.isPaused ? null : this.sleepUntil,
      schedule: this.currentSchedule || null,
      phase: this.phase,
      milestoneTitle: this.milestoneTitle,
      milestone: this.milestoneDescription,
      milestoneCyclesBudget: this.milestoneCyclesBudget,
      milestoneCyclesUsed: this.milestoneCyclesUsed,
      currentMilestoneId: this.currentMilestoneId,
      pendingMilestoneId: this.pendingMilestoneId,
      currentEpochId: this.currentEpochId,
      currentEpochPrId: this.currentEpochPrId,
      currentMilestoneBranch: this.currentMilestoneBranch,
      lastMergedMilestoneBranch: this.lastMergedMilestoneBranch,
      isFixRound: this.isFixRound,
      isComplete: this.isComplete || false,
      completionSuccess: this.completionSuccess || false,
      completionMessage: this.completionMessage || null,
      config: this.loadConfig(),
      agents: this.loadAgents(),
      cost: this.getCostSummary(),
      budget: this.getBudgetStatus()
    };
  }

  bootstrapPreview() {
    const projectDataExists = fs.existsSync(this.projectDir);
    let projectDataContents = [];
    if (projectDataExists) {
      projectDataContents = fs.readdirSync(this.projectDir).filter(name => !['repo', 'knowledge', 'skills', 'config.yaml'].includes(name));
    }
    // Read spec.md and check roadmap.md from private knowledge base
    let specContent = null;
    const specPath = path.join(this.knowledgeDir, 'spec.md');
    try { specContent = fs.readFileSync(specPath, 'utf-8'); } catch {}
    const hasRoadmap = fs.existsSync(path.join(this.knowledgeDir, 'roadmap.md'));
    return { available: true, projectDataEmpty: projectDataContents.length === 0, repo: this.repo, specContent, hasRoadmap };
  }

  bootstrap(options = {}) {
    // 0. Kill any running agent and pause the project
    if (this.currentAgentProcess) {
      try { this.currentAgentProcess.kill('SIGKILL'); } catch {}
      log(`Killed running agent ${this.currentAgent} for bootstrap`, this.id);
      this.currentAgentProcess = null;
      this.currentAgent = null;
      this.currentAgentStartTime = null;
      this.currentAgentLog = [];
      this.currentAgentModel = null; this.currentAgentCost = 0; this.currentAgentUsage = null; this.currentAgentKeyId = null; this.currentAgentVisibility = null;
    }
    this.isPaused = true;
    this.pauseReason = 'Bootstrapping';
    this.completedAgents = [];
    this.currentCycleId = null;
    this.currentSchedule = null;

    // 1. Wipe project operational state only, keep repo/knowledge/skills intact
    for (const target of this.getOperationalPaths()) {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
    }
    log(`Cleared project operational state`, this.id);
    fs.mkdirSync(this.projectDir, { recursive: true });

    // 2. Reset cycle count, phase, and save state
    this.setState({
      cycleCount: 0,
      epochCount: 0,
      phase: 'athena',
      milestoneTitle: null,
      milestoneDescription: null,
      milestoneCyclesBudget: 0,
      milestoneCyclesUsed: 0,
      currentMilestoneId: null,
      pendingMilestoneId: null,
      currentEpochId: null,
      currentEpochPrId: null,
      currentMilestoneBranch: null,
      aresGraceCycleUsed: false,
      verificationFeedback: null,
      examinationFeedback: null,
      pendingCompletionMessage: null,
      isFixRound: false,
      isComplete: false,
      completionSuccess: false,
      completionMessage: null,
      isPaused: true,
      pauseReason: 'Bootstrapped — resume when ready',
    });
    log(`Reset cycle count, project paused`, this.id);

    // 3. Remove roadmap.md from private knowledge base if requested
    if (options.removeRoadmap) {
      const roadmapPath = path.join(this.knowledgeDir, 'roadmap.md');
      if (fs.existsSync(roadmapPath)) {
        try {
          fs.unlinkSync(roadmapPath);
          log(`Removed private roadmap.md`, this.id);
        } catch (e) {
          log(`Warning: failed to remove private roadmap.md: ${e.message}`, this.id);
        }
      }
    }

    // 4. Update private spec.md if requested
    if (options.spec && options.spec.mode !== 'keep') {
      const specPath = path.join(this.knowledgeDir, 'spec.md');
      let newContent = '';
      if (options.spec.mode === 'edit') {
        newContent = options.spec.content || '';
      } else if (options.spec.mode === 'new') {
        const what = (options.spec.whatToBuild || '').trim();
        const criteria = (options.spec.successCriteria || '').trim();
        newContent = `# Project Spec\n\n## What to Build\n\n${what}\n\n## Success Criteria\n\n${criteria}\n`;
      }
      if (newContent) {
        try {
          fs.writeFileSync(specPath, newContent);
          log(`Updated private knowledge/spec.md`, this.id);
        } catch (e) {
          log(`Warning: failed to update spec.md: ${e.message}`, this.id);
        }
      }
    }

    return { bootstrapped: true };
  }

  _writeReport(agentName, body, { success = true, durationMs = 0 } = {}) {
    const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
    const startedAt = new Date();
    const endedAt = new Date();
    const reportBody = `> ⏱ Started: ${startedAt.toLocaleString('sv-SE')} | Ended: ${endedAt.toLocaleString('sv-SE')} | Duration: ${durationStr}\n\n${body.trim()}`;
    const db = this.getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle INTEGER NOT NULL,
      agent TEXT NOT NULL,
      body TEXT NOT NULL,
      summary TEXT,
      milestone_id TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )`);
    try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN input_tokens INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN output_tokens INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN cache_read_tokens INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN success INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN model TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN timed_out INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN key_id TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
    db.prepare(`INSERT INTO reports (cycle, agent, body, created_at, cost, duration_ms, input_tokens, output_tokens, cache_read_tokens, success, model, timed_out, key_id, visibility_mode, visibility_issues, milestone_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      this.cycleCount, agentName, reportBody, new Date().toISOString(),
      null, durationMs,
      null, null, null,
      success ? 1 : 0, null, 0,
      null,
      'full', JSON.stringify([]), this.currentMilestoneId || null
    );
    const lastId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    db.close();
    log(`Saved report for ${agentName}`, this.id);
    broadcastReportUpdate(this.id, lastId, agentName, this.cycleCount);
    return { reportId: lastId };
  }

  async runDoctor() {
    const config = this.loadConfig();
    const doctorAgent = { name: 'doctor', isManager: true, rawModel: 'high' };
    const task = [
      'Inspect this project and act only as an AI Doctor agent.',
      '',
      'Your job is to inspect and repair project layout drift. Do not rely on any built-in deterministic doctor behavior. You are the doctor.',
      '',
      'Canonical layout:',
      '- repo/',
      '- knowledge/',
      '- skills/',
      '- project.db',
      '- orchestrator.log',
      '- responses/',
      '- agents/',
      '',
      'Required behavior:',
      '- Inspect the actual filesystem.',
      '- Repair missing or misplaced project files when it is safe.',
      '- Ensure required directories and files exist after repair.',
      '- If known agent directories under agents/ are missing, create them.',
      '- Do not change product code in repo/ unless absolutely necessary for the repair itself.',
      '- Prefer move/rename over copy when safe.',
      '',
      'At the end, write a concise doctor report with these sections exactly:',
      '## Doctor Check',
      'Layout status: ...',
      '',
      '### Required paths',
      '- ...',
      '',
      '### Repair actions',
      '- ...',
      '',
      'If something could not be fixed, say why clearly.',
    ].join('\n');
    return await this.runAgent(doctorAgent, config, 'doctor', task, { mode: 'full', issues: [] });
  }

  async start() {
    if (this.running) return;
    // Validate project path exists
    if (!fs.existsSync(this.path)) {
      log(`ERROR: Project path does not exist: ${this.path}`, this.id);
      return;
    }

    // Ensure project directories exist
    fs.mkdirSync(this.projectDir, { recursive: true });
    fs.mkdirSync(this.chatsDir, { recursive: true });
    fs.mkdirSync(this.agentsDir, { recursive: true });
    fs.mkdirSync(this.responsesDir, { recursive: true });
    fs.mkdirSync(this.skillsDir, { recursive: true });
    fs.mkdirSync(this.knowledgeDir, { recursive: true });
    fs.mkdirSync(path.join(this.projectDir, 'knowledge', 'analysis'), { recursive: true });
    fs.mkdirSync(path.join(this.projectDir, 'knowledge', 'decisions'), { recursive: true });
    fs.mkdirSync(this.workerSkillsDir, { recursive: true });
    
    // Load persisted state
    this.loadState();
    
    this.running = true;
    log(`Starting project runner (data: ${this.projectDir}, cycle: ${this.cycleCount})`, this.id);
    this.runLoop();
  }

  loadState() {
    const statePath = this.statePath;
    try {
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        this.cycleCount = state.cycleCount || 0;
        this.epochCount = state.epochCount || 0;
        this.completedAgents = state.completedAgents || [];
        this.currentCycleId = state.currentCycleId || null;
        this.currentSchedule = state.currentSchedule || null;
        if (state.isPaused !== undefined) this.isPaused = state.isPaused;
        // Phase state
        this.phase = state.phase || 'athena';
        this.milestoneTitle = state.milestoneTitle || null;
        this.milestoneDescription = state.milestoneDescription || null;
        this.milestoneCyclesBudget = state.milestoneCyclesBudget || 0;
        this.milestoneCyclesUsed = state.milestoneCyclesUsed || 0;
        this.currentMilestoneId = state.currentMilestoneId || null;
        this.pendingMilestoneId = state.pendingMilestoneId || null;
        this.currentEpochId = state.currentEpochId || null;
        this.currentEpochPrId = state.currentEpochPrId || null;
        this.currentMilestoneBranch = state.currentMilestoneBranch || null;
        this.lastMergedMilestoneBranch = state.lastMergedMilestoneBranch || null;
        this.aresGraceCycleUsed = state.aresGraceCycleUsed || false;
        this.verificationFeedback = state.verificationFeedback || null;
        this.examinationFeedback = state.examinationFeedback || null;
        this.pendingCompletionMessage = state.pendingCompletionMessage || null;
        this.isFixRound = state.isFixRound || false;
        this.isComplete = state.isComplete || false;
        this.completionSuccess = state.completionSuccess || false;
        this.completionMessage = state.completionMessage || null;
        log(`Loaded state: cycle ${this.cycleCount}, phase: ${this.phase}, completed: [${this.completedAgents.join(', ')}]${this.isPaused ? ', paused' : ''}`, this.id);
      } else {
        // New project — start paused
        this.setState({ isPaused: true, pauseReason: 'New project (paused by default)' }, { save: false });
        this.completedAgents = [];
        this.currentCycleId = null;
        this.currentSchedule = null;
      }
    } catch (e) {
      log(`Failed to load state: ${e.message}`, this.id);
      this.completedAgents = [];
      this.currentCycleId = null;
      this.currentSchedule = null;
    }
  }

  saveState() {
    const statePath = this.statePath;
    try {
      const state = {
        cycleCount: this.cycleCount,
        epochCount: this.epochCount || 0,
        completedAgents: this.completedAgents || [],
        currentCycleId: this.currentCycleId,
        currentSchedule: this.currentSchedule || null,
        isPaused: this.isPaused || false,
        phase: this.phase,
        milestoneTitle: this.milestoneTitle,
        milestoneDescription: this.milestoneDescription,
        milestoneCyclesBudget: this.milestoneCyclesBudget,
        milestoneCyclesUsed: this.milestoneCyclesUsed,
        currentMilestoneId: this.currentMilestoneId || null,
        pendingMilestoneId: this.pendingMilestoneId || null,
        currentEpochId: this.currentEpochId || null,
        currentEpochPrId: this.currentEpochPrId || null,
        currentMilestoneBranch: this.currentMilestoneBranch || null,
        lastMergedMilestoneBranch: this.lastMergedMilestoneBranch || null,
        aresGraceCycleUsed: this.aresGraceCycleUsed || false,
        verificationFeedback: this.verificationFeedback,
        examinationFeedback: this.examinationFeedback,
        pendingCompletionMessage: this.pendingCompletionMessage,
        isFixRound: this.isFixRound,
        isComplete: this.isComplete || false,
        completionSuccess: this.completionSuccess || false,
        completionMessage: this.completionMessage || null,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (e) {
      log(`Failed to save state: ${e.message}`, this.id);
    }
  }

  stop() {
    this.running = false;
    if (this.currentAgentProcess) {
      this.currentAgentProcess.kill('SIGTERM');
    }
    log(`Stopped project runner`, this.id);
  }

  pause() {
    this.setState({ isPaused: true, pauseReason: null });
    log(`Paused`, this.id);
  }

  resume() {
    if (this.isComplete) {
      log(`Reopening completed project`, this.id);
      this.setState({
        isComplete: false,
        completionSuccess: false,
        completionMessage: null,
        isPaused: false,
        pauseReason: null,
        phase: 'athena',
        milestoneTitle: null,
        milestoneDescription: null,
        milestoneCyclesBudget: 0,
        milestoneCyclesUsed: 0,
        verificationFeedback: null,
        examinationFeedback: null,
        pendingCompletionMessage: null,
        currentSchedule: null,
        completedAgents: [],
      });
    } else {
      this.setState({ isPaused: false, pauseReason: null });
    }
    this.wakeNow = true;
    log(`Resumed`, this.id);
  }

  skip() {
    if (this.currentAgentProcess) {
      log(`Skipping current agent`, this.id);
      this.currentAgentProcess.kill('SIGTERM');
    } else if (this.sleepUntil) {
      log(`Skipping sleep`, this.id);
      this.wakeNow = true;
    }
  }

  // Kill Run: terminate the current agent, move to next in schedule
  killRun() {
    if (this.currentAgentProcess) {
      log(`🔴 Kill Run: terminating current agent`, this.id);
      this.currentAgentProcess.kill('SIGTERM');
    }
  }

  // Kill Cycle: terminate current agent + skip remaining workers in schedule
  killCycle() {
    log(`🔴 Kill Cycle: terminating agent and clearing schedule`, this.id);
    if (this.currentAgentProcess) {
      this.currentAgentProcess.kill('SIGTERM');
    }
    this.currentSchedule = null;
    this.completedAgents = [];
    this.saveState();
  }

  // Kill Epoch: terminate everything + force back to Athena
  killEpoch() {
    log(`🔴 Kill Epoch: terminating agent, clearing schedule, returning to Athena`, this.id);
    this.abortCurrentCycle = true;
    if (this.currentAgentProcess) {
      this.currentAgentProcess.kill('SIGTERM');
    }
    if (this.currentMilestoneBranch) {
      this.closeOpenEpochPRForBranch(this.currentMilestoneBranch, {
        actor: 'ares',
        reason: `Epoch killed manually while replanning milestone ${this.currentMilestoneId || 'unknown'}.`,
      });
    }
    this.currentSchedule = null;
    this.completedAgents = [];
    this.setState({
      phase: 'athena',
      pendingMilestoneId: null,
      milestoneTitle: null,
      milestoneDescription: null,
      milestoneCyclesBudget: 0,
      milestoneCyclesUsed: 0,
      currentEpochId: null,
      currentEpochPrId: null,
      currentMilestoneBranch: null,
      verificationFeedback: null,
      isFixRound: false,
    });
  }

  // Wait while paused, auto-resuming after intervalMs. Optional condition check to resume early.
  async _autoPauseWait(intervalMs, resumeCondition = null) {
    const retryAt = Date.now() + intervalMs;
    while (this.isPaused && this.running && !this.wakeNow) {
      await sleep(5000);
      // Check if it's time to auto-retry
      if (Date.now() >= retryAt) {
        if (resumeCondition && !resumeCondition()) {
          // Condition not met, keep waiting (check again in 2h)
          log(`Auto-retry check: condition not met, waiting another 2h`, this.id);
          return this._autoPauseWait(intervalMs, resumeCondition);
        }
        log(`Auto-resuming after ${Math.round(intervalMs / 60000)}m pause`, this.id);
        this.isPaused = false;
        this.pauseReason = null;
        return;
      }
    }
    // Manually resumed or stopped
    if (!this.isPaused) {
      this.pauseReason = null;
    }
  }

  async sleepDelay(minutes, label) {
    const ms = Math.min(Math.max(parseFloat(minutes) || 0, 0), 120) * 60000;
    if (ms <= 0) return;
    log(`⏳ Waiting ${Math.round(ms / 60000)}m after ${label}...`, this.id);
    this.sleepUntil = Date.now() + ms;
    let slept = 0;
    while (slept < ms && !this.wakeNow && this.running && !this.abortCurrentCycle) {
      await sleep(5000);
      slept += 5000;
      while (this.isPaused && !this.wakeNow && this.running && !this.abortCurrentCycle) { await sleep(1000); }
    }
    this.sleepUntil = null;
  }

  _parseVisibility(value, task) {
    const visMode = typeof value === 'object' ? value.visibility : undefined;
    if (!visMode || visMode === 'full') return null;
    if (visMode === 'blind') return { mode: 'blind', issues: [] };
    if (visMode === 'focused') {
      const issueIds = (task || '').match(/#(\d+)/g)?.map(m => m.slice(1)) || [];
      return { mode: 'focused', issues: issueIds };
    }
    return null;
  }

  parseSchedule(resultText) {
    // Parse <!-- SCHEDULE --> ... <!-- /SCHEDULE --> from manager response.
    // Canonical format only: a JSON array of steps.
    const match = resultText.match(/<!--\s*SCHEDULE\s*-->\s*([\[{][\s\S]*?[\]}])\s*<!--\s*\/SCHEDULE\s*-->/);
    if (!match) return null;
    const normalizeStep = (step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
      if (step.delay !== undefined) {
        return Object.keys(step).length === 1 && typeof step.delay === 'number'
          ? { delay: step.delay }
          : null;
      }
      if (typeof step.agent !== 'string' || !step.agent.trim()) return null;
      const { agent, ...rest } = step;
      if (!Object.prototype.hasOwnProperty.call(rest, 'task')) return null;
      return { [agent]: rest };
    };
    try {
      const raw = JSON.parse(match[1]);
      if (!Array.isArray(raw)) return null;
      const steps = raw.map(normalizeStep);
      if (steps.some(step => step === null)) return null;
      return { _steps: steps };
    } catch (e) {
      log(`Failed to parse schedule: ${e.message}`, this.id);
      return null;
    }
  }

  async executeSchedule(schedule, config, managerName = null) {
    if (!schedule || !schedule._steps) return { total: 0, failures: 0 };
    
    let total = 0;
    let failures = 0;
    const ownerName = typeof managerName === 'string' ? managerName.toLowerCase() : null;
    const freshWorkers = this.loadAgents().workers.filter(worker => {
      if (!ownerName) return true;
      return (worker.reportsTo || '').toLowerCase() === ownerName;
    });
    
    for (const step of schedule._steps) {
      if (!this.running || this.abortCurrentCycle) break;
      
      // Delay step
      if (step.delay !== undefined) {
        await this.sleepDelay(step.delay, 'schedule');
        if (this.abortCurrentCycle) break;
        continue;
      }
      
      // Agent step: { "agentName": taskValue }
      const name = Object.keys(step).find(k => k !== 'delay');
      if (!name) continue;

      // Skip agents already completed (supports resume after reboot)
      if (this.completedAgents.includes(name.toLowerCase())) {
        log(`Skipping ${name} (already completed this cycle)`, this.id);
        continue;
      }
      
      const value = step[name];
      const worker = freshWorkers.find(w => w.name.toLowerCase() === name.toLowerCase());
      if (!worker) {
        log(`Worker "${name}" not found, skipping`, this.id);
        continue;
      }
      
      while (this.isPaused && this.running && !this.abortCurrentCycle) { await sleep(1000); }
      if (this.abortCurrentCycle) break;
      
      const task = typeof value === 'string' ? value : value.task || null;
      const vis = this._parseVisibility(value, task);
      
      // Retry on timeout/failure (up to 2 retries)
      const maxRetries = 2;
      let attempt = 0;
      let succeeded = false;
      while (attempt <= maxRetries && !succeeded && this.running && !this.abortCurrentCycle) {
        if (attempt > 0) {
          log(`Retrying ${worker.name} (attempt ${attempt + 1}/${maxRetries + 1})`, this.id);
        }
        const wResult = await this.runAgent(worker, config, null, task, vis);
        if (this.abortCurrentCycle) break;
        total++;
        if (wResult && wResult.success) {
          succeeded = true;
          this.completedAgents.push(name.toLowerCase());
          this.saveState();
        } else {
          failures++;
          const wasTimeout = wResult && wResult.killedByTimeout;
          if (wasTimeout) break; // Don't retry on timeout (agent can't finish in time)
          attempt++;
        }
      }
    }
    
    return { total, failures };
  }

  async runLoop() {
    while (this.running) {
      while (this.isPaused && this.running) {
        await sleep(1000);
      }
      if (!this.running) break;

      const config = this.loadConfig();

      // Check budget before starting cycle
      const budgetStatus = this.getBudgetStatus();
      if (budgetStatus && budgetStatus.exhausted) {
        log(`Budget exhausted ($${budgetStatus.spent24h.toFixed(2)}/$${budgetStatus.budgetPer24h}), waiting for budget to roll off`, this.id);
        this.setState({ isPaused: true, pauseReason: `Budget exhausted: $${budgetStatus.spent24h.toFixed(2)} / $${budgetStatus.budgetPer24h} (24h)` });
        // Re-check every 2 hours until budget rolls off or manually resumed
        await this._autoPauseWait(2 * 60 * 60 * 1000, () => !this.getBudgetStatus().exhausted);
        if (!this.running) break;
        continue;
      }

      // Check if any API key is available before starting a cycle
      const preConfig = this.loadConfig();
      const poolCheck = getKeyPoolSafe();
      if (poolCheck.keys.filter(k => k.enabled).length === 0 && !preConfig.setupToken) {
        log(`No API keys configured. Pausing project. Add a key in Settings > Credentials.`, this.id);
        this.setState({ isPaused: true, pauseReason: 'No API keys configured. Add one in Settings > Credentials.' });
        await this._autoPauseWait(30_000, () => getKeyPoolSafe().keys.some(k => k.enabled));
        if (!this.running) break;
        continue;
      }

      const { managers, workers } = this.loadAgents();

      // Start new cycle — preserve schedule state if resuming from reboot
      this.abortCurrentCycle = false;
      const resuming = !!this.currentSchedule;
      if (!resuming) {
        this.cycleCount++;
        this.completedAgents = [];
        this.saveState();
      }
      log(`===== CYCLE ${this.cycleCount} (phase: ${this.phase})${resuming ? ' [RESUMING]' : ''} =====`, this.id);

      let cycleFailures = 0;
      let cycleTotal = 0;

      // ===== PHASE: ATHENA (strategy) =====
      if (this.phase === 'athena') {
        const athena = managers.find(m => m.name === 'athena');
        if (athena) {
          // Build situation context for Athena
          if (!this.pendingMilestoneId) {
            const parentMilestoneId = this.currentMilestoneId || null;
            this.pendingMilestoneId = await this.allocateNextMilestoneId(parentMilestoneId);
            this.saveState();
          }
          const reservedBranchPrefix = this.makeMilestoneBranchPrefix(this.pendingMilestoneId);

          let situation = '';
          if (this.examinationFeedback) {
            situation = `> **Situation: Project Completion Rejected by Themis**\n> ${this.examinationFeedback}\n\n`;
          } else if (!this.milestoneDescription) {
            situation = '> **Situation: Project Just Started**\n\n';
          } else if (this.verificationFeedback === '__passed__') {
            situation = '> **Situation: Milestone Verified Complete**\n> Previous milestone was verified by Apollo\'s team.\n\n';
          } else if (this.verificationFeedback) {
            situation = `> **Situation: Epoch PR Rejected by Apollo**\n> ${this.verificationFeedback}\n> Previous milestone: ${this.currentMilestoneId || 'unknown'}\n> Previous branch: ${this.currentMilestoneBranch || 'unknown'}\n> Athena should split or narrow the failed milestone into a new PR-sized milestone, not send it back as a generic fix round.\n\n`;
          } else {
            situation = `> **Situation: Implementation Deadline Missed**\n> Ares's team used ${this.milestoneCyclesUsed}/${this.milestoneCyclesBudget} cycles without completing the milestone.\n> Previous milestone: ${this.currentMilestoneId || 'unknown'}\n> Current branch: ${this.currentMilestoneBranch || 'not set'}\n\n`;
          }
          situation += `> **Assigned milestone ID:** ${this.pendingMilestoneId}\n> **Reserved branch prefix:** ${reservedBranchPrefix}\n`;
          if (this.currentMilestoneId) {
            situation += `> **Optional reset:** If the current subtree is wrong, you may return a milestone with \"reset_to\": \"${this.currentMilestoneId}\" or any ancestor milestone id (or \"root\") to abandon deeper branches and replan from that level.\n`;
          }
          situation += `\n`;

          const result = await this.runAgent(athena, config, null, situation);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          // Parse schedule and milestone from Athena's response
          let schedule = null;
          if (result && result.resultText) {
            schedule = this.parseSchedule(result.resultText);
            if (schedule) {
              log(`Schedule: ${JSON.stringify(schedule)}`, this.id);
            }

            const milestoneMatch = result.resultText.match(/<!-- MILESTONE -->\s*([\s\S]*?)\s*<!-- \/MILESTONE -->/);
            if (milestoneMatch) {
              try {
                const milestone = JSON.parse(milestoneMatch[1]);
                const milestoneTitle = milestone.title || milestone.description.slice(0, 80);
                const resetTarget = this.normalizeResetTargetMilestone(milestone.reset_to);
                const resetTo = resetTarget ? resetTarget.milestoneId : (this.currentMilestoneId || null);
                const shouldReusePendingMilestoneId = !!this.pendingMilestoneId && resetTo === (this.currentMilestoneId || null);
                const milestoneId = shouldReusePendingMilestoneId
                  ? this.pendingMilestoneId
                  : await this.allocateNextMilestoneId(resetTo);
                if (milestone.reset_to && !resetTarget) {
                  log(`Ignoring invalid reset_to target from Athena: ${milestone.reset_to}`, this.id);
                } else if (milestone.reset_to && resetTarget) {
                  log(`Athena reset planning anchor to ${resetTarget.label}`, this.id);
                  if (this.currentMilestoneBranch) {
                    this.closeOpenEpochPRForBranch(this.currentMilestoneBranch, {
                      actor: 'athena',
                      reason: `Athena reset subtree to ${resetTarget.label} while replanning.`,
                    });
                  }
                }
                this.setState({
                  milestoneTitle,
                  milestoneDescription: milestone.description,
                  milestoneCyclesBudget: milestone.cycles || 20,
                  milestoneCyclesUsed: 0,
                  currentMilestoneId: milestoneId,
                  pendingMilestoneId: null,
                  currentEpochId: null,
                  currentEpochPrId: null,
                  currentMilestoneBranch: null,
                  aresGraceCycleUsed: false,
                  verificationFeedback: null,
                  examinationFeedback: null,
                  pendingCompletionMessage: null,
                  isFixRound: false,
                  phase: 'implementation',
                });
                await this.upsertMilestoneRecord({
                  milestoneId,
                  title: milestoneTitle,
                  description: milestone.description,
                  cyclesBudget: milestone.cycles || 20,
                  branchName: null,
                  parentMilestoneId: milestoneId.includes('.') ? milestoneId.split('.').slice(0, -1).join('.') : null,
                  phase: 'implementation',
                  status: 'active',
                });
                this.epochCount++;
                this.saveState();
                log(`Epoch ${this.epochCount}: New milestone (${this.milestoneCyclesBudget} cycles): ${this.milestoneDescription.slice(0, 100)}...`, this.id);
                broadcastEvent({ type: 'milestone', project: this.id, title: this.milestoneTitle, cycles: this.milestoneCyclesBudget });
              } catch (e) {
                log(`Failed to parse milestone: ${e.message}`, this.id);
              }
            }
            // Check for PROJECT_COMPLETE tag
            const completeMatch = result.resultText.match(/<!-- PROJECT_COMPLETE -->\s*([\s\S]*?)\s*<!-- \/PROJECT_COMPLETE -->/);
            if (completeMatch) {
              try {
                const completion = JSON.parse(completeMatch[1]);
                const success = !!completion.success;
                const message = completion.message || 'Project completed';
                if (success) {
                  this.setState({
                    phase: 'examination',
                    pendingCompletionMessage: message,
                    examinationFeedback: null,
                    completionSuccess: false,
                    completionMessage: null,
                    isComplete: false,
                    isPaused: false,
                    pauseReason: null,
                  });
                  log(`🧪 PROJECT COMPLETE claimed — routing to Themis examination: ${message}`, this.id);
                  broadcastEvent({ type: 'phase', project: this.id, phase: 'examination', title: this.milestoneTitle || 'Project examination' });
                } else {
                  this.setState({
                    isComplete: true,
                    completionSuccess: success,
                    completionMessage: message,
                    isPaused: true,
                    pauseReason: `Project ${success ? 'completed successfully' : 'ended'}: ${message}`,
                  });
                  log(`🏁 PROJECT COMPLETE (success: ${success}): ${message}`, this.id);
                  broadcastEvent({ type: 'project-complete', project: this.id, success, message });
                }
                continue;
              } catch (e) {
                log(`Failed to parse PROJECT_COMPLETE: ${e.message}`, this.id);
              }
            }

            // Check for STOP file
            if (fs.existsSync(this.stopPath)) {
              log(`STOP file detected — pausing project`, this.id);
              this.setState({ isPaused: true, pauseReason: 'Project stopped by Athena' });
              continue;
            }
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            this.currentSchedule = schedule;
            this.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await this.executeSchedule(schedule, config, 'athena');
            cycleTotal += total;
            cycleFailures += failures;
            this.currentSchedule = null;
            this.completedAgents = [];
          }

          this.saveState();
        }
      }

      // ===== PHASE: IMPLEMENTATION (Ares + his workers) =====
      else if (this.phase === 'implementation') {
        const aresGraceMode = this.milestoneCyclesUsed >= this.milestoneCyclesBudget;
        // Check if deadline missed (before running)
        if (aresGraceMode && this.aresGraceCycleUsed) {
          const failureReason = `Implementation deadline missed after ${this.milestoneCyclesUsed}/${this.milestoneCyclesBudget} cycles for ${this.currentMilestoneId || 'unknown milestone'}.`;
          await this.decideEpochPR('closed', { actor: 'apollo', reason: failureReason });
          await this.markCurrentMilestoneFailed(failureReason);
          log(`⏰ Implementation deadline missed (${this.milestoneCyclesUsed}/${this.milestoneCyclesBudget} cycles)`, this.id);
          this.setState({ currentEpochId: null, currentEpochPrId: null, currentMilestoneBranch: null, aresGraceCycleUsed: false, phase: 'athena' });
          continue;
        }

        // Resume interrupted schedule from previous cycle (e.g. after reboot)
        // Note: don't require completedAgents — schedule may start with a delay step
        if (this.currentSchedule) {
          log(`Resuming interrupted schedule (${this.completedAgents.length} agents already completed${this.completedAgents.length ? ': [' + this.completedAgents.join(', ') + ']' : ''})`, this.id);
          const { total, failures } = await this.executeSchedule(this.currentSchedule, config, 'ares');
          cycleTotal += total;
          cycleFailures += failures;
          this.currentSchedule = null;
          this.completedAgents = [];
          this.saveState();
        } else {

        const ares = managers.find(m => m.name === 'ares');
        if (ares) {
          let epochStateChanged = false;
          if (!this.currentEpochId) {
            this.currentEpochId = await this.allocateNextEpochId();
            this.epochCount += 1;
            epochStateChanged = true;
          }
          if (!this.currentMilestoneBranch) {
            const branchPrefix = this.makeMilestoneBranchPrefix(this.currentMilestoneId);
            this.currentMilestoneBranch = `${String(this.currentEpochId || 'E0').toLowerCase()}-${branchPrefix}-${this.slugifyMilestoneTitle(this.milestoneTitle, { stripLeadingMilestoneId: this.currentMilestoneId })}`;
            epochStateChanged = true;
          }
          if (epochStateChanged) this.saveState();
          const openEpochPr = await this.ensureEpochPRForCurrentMilestone();
          // Build context for Ares (remaining includes this cycle)
          const cyclesRemaining = Math.max(0, this.milestoneCyclesBudget - this.milestoneCyclesUsed);
          let aresContext = `> **Milestone ID:** ${this.currentMilestoneId || 'unknown'}
> **Milestone:** ${this.milestoneDescription}
> **Epoch ID:** ${this.currentEpochId || 'unknown'}
> **Cycles remaining:** ${cyclesRemaining} of ${this.milestoneCyclesBudget}
> **Milestone branch:** ${this.currentMilestoneBranch || 'not set'}
> **Epoch PR:** ${openEpochPr?.id ? `#${openEpochPr.id}` : 'not set'}
> **Epoch PR rule:** The orchestrator assigned exactly one TBC PR to this milestone branch. Use it instead of creating competing PRs.

`;
          if (aresGraceMode) {
            aresContext += `> **Grace review mode:** Worker budget is exhausted. This is your final manager-only pass.
> **Do not emit a schedule. Do not assign any workers.**
> Review the existing evidence only. If the milestone is already complete, emit <!-- CLAIM_COMPLETE -->. Otherwise emit no completion block and the milestone will fail.

`;
          }
          if (this.isFixRound && this.verificationFeedback) {
            aresContext += `> **Legacy verification feedback:**
> ${this.verificationFeedback}

`;
          }

          const result = await this.runAgent(ares, config, null, aresContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;
          if (aresGraceMode) this.aresGraceCycleUsed = true;

          // Parse schedule and check for CLAIM_COMPLETE
          let schedule = null;
          let claimedComplete = false;
          if (result && result.resultText) {
            if (!aresGraceMode) {
              schedule = this.parseSchedule(result.resultText);
              if (schedule) {
                log(`Schedule: ${JSON.stringify(schedule)}`, this.id);
                this.currentSchedule = schedule;
              }
            } else if (this.parseSchedule(result.resultText)) {
              log('⚠️ Ignoring Ares schedule because grace review mode forbids worker scheduling', this.id);
            }

            // Check if Ares claims milestone complete
            if (result.resultText.includes('<!-- CLAIM_COMPLETE -->')) {
              claimedComplete = true;
              const openEpochPr = await this.ensureEpochPRForCurrentMilestone();
              if (!openEpochPr) {
                this.verificationFeedback = `Ares claimed milestone completion without an orchestrator-managed epoch PR on branch ${this.currentMilestoneBranch || 'unknown'}.`;
                log('⚠️ CLAIM_COMPLETE ignored because no orchestrator-managed epoch PR exists for the current milestone branch', this.id);
                this.saveState();
                claimedComplete = false;
              } else {
                log(`🎯 Ares claims milestone complete for epoch PR #${openEpochPr.id} — switching to verification`, this.id);
                this.setState({ phase: 'verification', currentEpochPrId: openEpochPr.id });
                broadcastEvent({ type: 'phase', project: this.id, phase: 'verification', title: this.milestoneTitle });
              }
            }
          }

          if (aresGraceMode && !claimedComplete) {
            const failureReason = `Implementation deadline missed after ${this.milestoneCyclesUsed}/${this.milestoneCyclesBudget} cycles for ${this.currentMilestoneId || 'unknown milestone'} (Ares grace review did not claim completion).`;
            await this.decideEpochPR('closed', { actor: 'apollo', reason: failureReason });
            await this.markCurrentMilestoneFailed(failureReason);
            log(`⏰ ${failureReason}`, this.id);
            this.setState({ currentEpochId: null, currentEpochPrId: null, currentMilestoneBranch: null, aresGraceCycleUsed: false, phase: 'athena', verificationFeedback: failureReason });
            this.saveState();
            continue;
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            this.completedAgents = [];
            this.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await this.executeSchedule(schedule, config, 'ares');
            cycleTotal += total;
            cycleFailures += failures;
            this.currentSchedule = null;
            this.completedAgents = [];
            this.saveState();
          }
        }
        } // end else (no interrupted schedule)
        // Only count cycle if at least one agent succeeded
        if (cycleTotal > 0 && cycleFailures < cycleTotal) {
          this.milestoneCyclesUsed++;
        } else if (cycleTotal > 0) {
          log(`All ${cycleTotal} agents failed — cycle not counted toward milestone budget`, this.id);
        }
        this.saveState();
      }

      // ===== PHASE: VERIFICATION (Apollo + his workers) =====
      else if (this.phase === 'verification') {
        // Resume interrupted verification schedule (e.g. after reboot)
        if (this.currentSchedule && this.completedAgents.length > 0) {
          log(`Resuming interrupted verification schedule (${this.completedAgents.length} agents already completed: [${this.completedAgents.join(', ')}])`, this.id);
          const { total, failures } = await this.executeSchedule(this.currentSchedule, config, 'apollo');
          cycleTotal += total;
          cycleFailures += failures;
          this.currentSchedule = null;
          this.completedAgents = [];
          this.saveState();
        } else {
        const apollo = managers.find(m => m.name === 'apollo');
        if (apollo) {
          const isRollupVerification = !this.currentEpochPrId;
          const apolloContext = isRollupVerification
            ? `> **Milestone to verify:** ${this.milestoneDescription}\n> **Rollup verification target:** ${this.currentMilestoneId || 'unknown'}\n> **Verification mode:** Parent milestone rollup after a child milestone passed\n> **Active epoch PR:** none (rollup verification)\n> Apollo should decide whether this parent milestone is now fully complete or Athena should plan the next child under it.\n\n`
            : `> **Milestone to verify:** ${this.milestoneDescription}\n> **Milestone branch:** ${this.currentMilestoneBranch || 'not set'}\n> **Active epoch PR:** ${this.currentEpochPrId || 'unknown'}\n> Apollo owns the PR decision: merge on pass, close on fail.\n\n`;

          const result = await this.runAgent(apollo, config, null, apolloContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          let schedule = null;
          let decision = null;
          if (result && result.resultText) {
            schedule = this.parseSchedule(result.resultText);
            if (schedule) {
              log(`Schedule: ${JSON.stringify(schedule)}`, this.id);
            }

            // Check for verification decision
            if (result.resultText.includes('<!-- VERIFY_PASS -->')) {
              decision = 'pass';
            }
            const failMatch = result.resultText.match(/<!-- VERIFY_FAIL -->\s*([\s\S]*?)\s*<!-- \/VERIFY_FAIL -->/);
            if (failMatch) {
              try {
                const failData = JSON.parse(failMatch[1]);
                decision = 'fail';
                this.verificationFeedback = failData.feedback || 'Verification failed (no specific feedback)';
              } catch {
                decision = 'fail';
                this.verificationFeedback = 'Verification failed (could not parse feedback)';
              }
            }
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            this.currentSchedule = schedule;
            this.completedAgents = [];
            this.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await this.executeSchedule(schedule, config, 'apollo');
            cycleTotal += total;
            cycleFailures += failures;
            this.currentSchedule = null;
            this.completedAgents = [];
            this.saveState();
          }

          // Process decision
          if (decision === 'pass') {
            const mergedPr = isRollupVerification ? null : await this.decideEpochPR('merged', {
              actor: 'apollo',
              reason: `Apollo passed milestone ${this.currentMilestoneId || ''} ${this.milestoneTitle || this.milestoneDescription || ''}`.trim(),
            });
            const completedMilestoneId = this.currentMilestoneId;
            const completedMilestoneTitle = this.milestoneTitle;
            const parentMilestoneId = this.getParentMilestoneId(completedMilestoneId);
            await this.markCurrentMilestoneCompleted();
            if (parentMilestoneId) {
              const parentMilestone = await this.getMilestoneRecord(parentMilestoneId);
              log(`✅ Milestone verified — escalating completion check to parent milestone ${parentMilestoneId}`, this.id);
              broadcastEvent({ type: 'verified', project: this.id, title: completedMilestoneTitle });
              if (parentMilestone) {
                await this.upsertMilestoneRecord({
                  milestoneId: parentMilestoneId,
                  title: parentMilestone.title,
                  description: parentMilestone.description,
                  cyclesBudget: parentMilestone.cycles_budget,
                  branchName: parentMilestone.branch_name,
                  parentMilestoneId: parentMilestone.parent_milestone_id,
                  phase: 'verification',
                  status: 'active',
                  linkedPrId: parentMilestone.linked_pr_id,
                  failureReason: null,
                });
              }
              this.setState({
                milestoneTitle: parentMilestone?.title || parentMilestoneId,
                milestoneDescription: parentMilestone?.description || `Parent rollup verification for ${parentMilestoneId}`,
                milestoneCyclesBudget: parentMilestone?.cycles_budget || 0,
                milestoneCyclesUsed: parentMilestone?.cycles_used || 0,
                currentMilestoneId: parentMilestoneId,
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: parentMilestone?.branch_name || null,
                aresGraceCycleUsed: false,
                lastMergedMilestoneBranch: mergedPr?.branch_name || mergedPr?.head_branch || this.currentMilestoneBranch || this.lastMergedMilestoneBranch,
                verificationFeedback: null,
                isFixRound: false,
                phase: 'verification',
              });
              broadcastEvent({ type: 'phase', project: this.id, phase: 'verification', title: parentMilestone?.title || parentMilestoneId });
            } else {
              log(`✅ Milestone verified — waking Athena for next milestone`, this.id);
              broadcastEvent({ type: 'verified', project: this.id, title: this.milestoneTitle });
              this.milestoneTitle = null;
              this.setState({
                milestoneTitle: null,
                milestoneDescription: null,
                milestoneCyclesBudget: 0,
                milestoneCyclesUsed: 0,
                currentMilestoneId: null,
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: null,
                aresGraceCycleUsed: false,
                lastMergedMilestoneBranch: mergedPr?.branch_name || mergedPr?.head_branch || this.currentMilestoneBranch || this.lastMergedMilestoneBranch,
                verificationFeedback: null,
                isFixRound: false,
                phase: 'athena',
              });
            }
          } else if (decision === 'fail') {
            const failureReason = this.verificationFeedback || 'Apollo rejected the epoch PR and requested milestone splitting or narrowing.';
            if (isRollupVerification) {
              log('❌ Parent rollup verification incomplete — returning to Athena to plan the next child milestone', this.id);
              broadcastEvent({ type: 'verify-fail', project: this.id, title: this.milestoneTitle });
              this.setState({
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: null,
                aresGraceCycleUsed: false,
                verificationFeedback: failureReason,
                isFixRound: false,
                phase: 'athena',
              });
            } else {
              await this.decideEpochPR('closed', {
                actor: 'apollo',
                reason: failureReason,
              });
              await this.markCurrentMilestoneFailed(failureReason);
              log('❌ Verification failed — returning to Athena for split/replan', this.id);
              broadcastEvent({ type: 'verify-fail', project: this.id, title: this.milestoneTitle });
              this.setState({
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                aresGraceCycleUsed: false,
                verificationFeedback: failureReason,
                isFixRound: false,
                phase: 'athena',
              });
            }
          } else {
            // No decision yet, stay in verification phase — still save
            this.saveState();
          }
        }
        } // end else (no interrupted verification schedule)
      }

      // ===== PHASE: EXAMINATION (Themis final audit) =====
      else if (this.phase === 'examination') {
        // Resume interrupted examination schedule (e.g. after reboot)
        if (this.currentSchedule) {
          log(`Resuming interrupted examination schedule (${this.completedAgents.length} agents already completed${this.completedAgents.length ? ': [' + this.completedAgents.join(', ') + ']' : ''})`, this.id);
          const { total, failures } = await this.executeSchedule(this.currentSchedule, config, 'themis');
          cycleTotal += total;
          cycleFailures += failures;
          this.currentSchedule = null;
          this.completedAgents = [];
          this.saveState();
        } else {
        const themis = managers.find(m => m.name === 'themis');
        if (themis) {
          const themisContext = `> **Final completion claim:** ${this.pendingCompletionMessage || 'Project claimed complete'}\n> **Evaluate the entire project, not just the human\'s explicit goal.** Audit correctness, completeness, maintainability, artifacts, tests, docs, and obvious risks.\n\n`;
          const result = await this.runAgent(themis, config, null, themisContext, { mode: 'full', issues: [] });
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          let schedule = null;
          let decision = null;
          let failData = null;
          if (result && result.resultText) {
            schedule = this.parseSchedule(result.resultText);
            if (schedule) {
              log(`Schedule: ${JSON.stringify(schedule)}`, this.id);
            }

            if (result.resultText.includes('<!-- EXAM_PASS -->')) {
              decision = 'pass';
            }
            const failMatch = result.resultText.match(/<!-- EXAM_FAIL -->\s*([\s\S]*?)\s*<!-- \/EXAM_FAIL -->/);
            if (failMatch) {
              try {
                failData = JSON.parse(failMatch[1]);
              } catch {
                failData = { feedback: 'Themis rejected project completion, but the response could not be parsed.' };
              }
              decision = 'fail';
            } else if (!schedule && decision == null) {
              decision = 'fail';
            }
          }

          if (schedule) {
            this.currentSchedule = schedule;
            this.completedAgents = [];
            this.saveState();
            const { total, failures } = await this.executeSchedule(schedule, config, 'themis');
            cycleTotal += total;
            cycleFailures += failures;
            this.currentSchedule = null;
            this.completedAgents = [];
            this.saveState();
          }

          if (decision === 'pass') {
            const message = this.pendingCompletionMessage || 'Project completed';
            this.setState({
              phase: 'athena',
              isComplete: true,
              completionSuccess: true,
              completionMessage: message,
              pendingCompletionMessage: null,
              examinationFeedback: null,
              currentSchedule: null,
              completedAgents: [],
              isPaused: true,
              pauseReason: `Project completed successfully: ${message}`,
            });
            log(`🏁 PROJECT COMPLETE (validated by Themis): ${message}`, this.id);
            broadcastEvent({ type: 'project-complete', project: this.id, success: true, message });
          } else if (decision === 'fail') {
            let issues = Array.isArray(failData?.issues) ? failData.issues : [];
            const rawFeedback = (result?.resultText || '').trim();
            if (issues.length === 0) {
              issues = [{
                title: 'Themis rejected project completion',
                body: rawFeedback || failData?.feedback || failData?.summary || 'Themis did not issue EXAM_PASS, so the completion claim was rejected.',
              }];
            }
            const createdIssueIds = [];
            for (const issue of issues) {
              if (!issue?.title) continue;
              try {
                const created = await this.createIssue(issue.title, issue.body || '', 'themis');
                createdIssueIds.push(created.issueId);
              } catch (e) {
                log(`Themis issue creation failed: ${e.message}`, this.id);
              }
            }
            const feedback = failData?.feedback || failData?.summary || rawFeedback || 'Themis rejected the project completion claim.';
            this.setState({
              phase: 'athena',
              examinationFeedback: createdIssueIds.length
                ? `${feedback} New issues: ${createdIssueIds.map(id => `#${id}`).join(', ')}`
                : feedback,
              pendingCompletionMessage: null,
              currentSchedule: null,
              completedAgents: [],
              isComplete: false,
              completionSuccess: false,
              completionMessage: null,
              isPaused: false,
              pauseReason: null,
            });
            log(`❌ Themis rejected project completion — returning to Athena`, this.id);
            broadcastEvent({ type: 'phase', project: this.id, phase: 'athena', title: this.milestoneTitle || 'Replanning after Themis rejection' });
          } else {
            // No decision yet, stay in examination phase — still save
            this.saveState();
          }
        }
        } // end else (no interrupted examination schedule)
      }

      // If no agent succeeded, don't count this cycle
      if (cycleTotal > 0 && cycleFailures === cycleTotal) {
        this.cycleCount--;
        this.saveState();
      }

      // Track consecutive agent failures — auto-pause after 10
      this.consecutiveFailures = (cycleTotal > 0 && cycleFailures === cycleTotal)
        ? this.consecutiveFailures + cycleFailures
        : 0;
      if (this.consecutiveFailures >= 10 && this.running) {
        log(`⚠️ ${this.consecutiveFailures} consecutive agent failures — auto-pausing (retry in 2h)`, this.id);
        broadcastEvent({ type: 'error', project: this.id, message: `${this.consecutiveFailures} consecutive failures — auto-paused` });
        this.setState({ isPaused: true, pauseReason: `${this.consecutiveFailures} consecutive agent failures` });
        this.consecutiveFailures = 0;
        await this._autoPauseWait(2 * 60 * 60 * 1000);
        if (!this.running) break;
        continue;
      }

      // Compute sleep: budget-derived or fixed interval
      const sleepMs = this.computeSleepInterval();
      this.lastComputedSleepMs = sleepMs; // Cache for status requests
      if (this.running) {
        log(`Sleeping ${Math.round(sleepMs / 1000)}s...`, this.id);
        this.wakeNow = false;
        this.sleepUntil = Date.now() + sleepMs;

        let sleptMs = 0;
        while (sleptMs < sleepMs && !this.wakeNow && this.running) {
          await sleep(5000);
          sleptMs += 5000;
          while (this.isPaused && !this.wakeNow && this.running) {
            await sleep(1000);
          }
        }
        this.sleepUntil = null;
      }
    }
  }

  // Build the full prompt for an agent (shared across CLI and API paths)
  _getAgentFilesystemPolicy(agent, visibility = null) {
    if (agent.name === 'doctor') {
      return null;
    }
    const visMode = visibility?.mode || 'full';
    const repoDir = this.path;
    const knowledgeDir = this.knowledgeDir;
    const ownWorkspaceDir = path.join(this.agentsDir, agent.name);
    const read = [repoDir];
    const write = [repoDir];
    if (visMode !== 'blind') {
      read.push(knowledgeDir);
      read.push(ownWorkspaceDir);
      write.push(ownWorkspaceDir);
    }
    if (agent.isManager && visMode !== 'blind') {
      read.push(this.workerSkillsDir);
      write.push(this.workerSkillsDir);
    }
    const denied = [
      this.agentsDir,
      this.responsesDir,
      this.uploadsDir,
      this.skillsDir,
      this.statePath,
      this.orchestratorLogPath,
      this.projectDbPath,
    ];
    return { read, write, denied, dbPath: this.projectDbPath };
  }

  _buildAgentPrompt(agent, task, visibility) {
    const skillPath = agent.isManager
      ? path.join(ROOT, 'agent', 'managers', `${agent.name}.md`)
      : path.join(this.workerSkillsDir, `${agent.name}.md`);

    if (!fs.existsSync(skillPath)) {
      return null;
    }

    let skillContent = fs.readFileSync(skillPath, 'utf-8');

    // Build shared rules: everyone.md + folder_structure.md + db.md + role-specific rules
    let sharedRules = '';
    try {
      const everyonePath = path.join(ROOT, 'agent', 'everyone.md');
      const folderStructurePath = path.join(ROOT, 'agent', 'folder_structure.md');
      sharedRules = fs.readFileSync(everyonePath, 'utf-8') + '\n\n---\n\n';
      try {
        sharedRules += fs.readFileSync(folderStructurePath, 'utf-8') + '\n\n---\n\n';
      } catch {}
      const visMode = visibility?.mode || 'full';
      if (visMode === 'full') {
        const dbPath = path.join(ROOT, 'agent', 'db.md');
        try {
          const dbContent = fs.readFileSync(dbPath, 'utf-8');
          sharedRules += dbContent + '\n\n---\n\n';
        } catch {}
      }
      if (agent.name !== 'themis') {
        if (visMode === 'focused') {
          sharedRules += '\n> **You are in focused mode.** You cannot read the issue tracker or PR board. Work only from the task, the repository, shared knowledge, and your own agent notes. If needed, you may create a new issue or PR record to report a blocker or finding.\n\n---\n\n';
        } else if (visMode === 'blind') {
          sharedRules += '\n> **You are in blind mode.** You cannot read the issue tracker or PR board, and you cannot rely on shared knowledge or any agent notes, including your own prior notes. Work only from the task and the repository. If needed, you may create a new issue or PR record to report a blocker or finding.\n\n---\n\n';
        }
      } else {
        sharedRules += '\n> **You are Themis, final examination manager.** You run in full view, not blind. Inspect the repository, issue tracker, PR board, shared knowledge, and agent notes directly. You may hire and schedule workers, but only workers who report to you. Your examination team is independent from the Athena, Ares, and Apollo teams, so make your own judgment from primary evidence.\n\n---\n\n';
      }
      const rolePath = path.join(ROOT, 'agent', agent.isManager ? 'manager.md' : 'worker.md');
      sharedRules += fs.readFileSync(rolePath, 'utf-8') + '\n\n---\n\n';
    } catch {}

    let taskHeader = '';
    if (task) {
      taskHeader = `> **Your assignment: ${task}**\n\n`;
    }

    // Strip YAML frontmatter (---...---) from skill content before building prompt
    skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
    skillContent = (taskHeader + sharedRules + skillContent).replaceAll('{project_dir}', this.projectDir);

    return skillContent;
  }

  // Post-processing shared by both CLI and API agent runs
  _postProcessAgentRun(agent, config, { resultText, cost, durationMs, killedByTimeout, exitCode, rawOutput, apiSuccess, usage }) {
    const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
    // For API runner: use apiSuccess if provided; for CLI runner: use exitCode
    const success = !killedByTimeout && (apiSuccess !== undefined ? apiSuccess : (exitCode === 0 || exitCode === undefined));

    // Build token info string for logging
    let tokenInfo = '';
    if (cost !== undefined) {
      tokenInfo = ` | cost: $${cost.toFixed(4)}`;
    }

    // Log response to agent-specific log file
    try {
      const responsesDir = this.responsesDir;
      fs.mkdirSync(responsesDir, { recursive: true });
      const timestamp = new Date().toLocaleString('sv-SE', { hour12: false }).replace(',', '');
      const header = `\n${'='.repeat(60)}\n[${timestamp}] Cycle ${this.cycleCount} | Success: ${success}\n${'='.repeat(60)}\n`;

      // Always log raw output for debugging
      const rawLogPath = path.join(responsesDir, `${agent.name}.raw.log`);
      fs.appendFileSync(rawLogPath, header + (rawOutput || resultText || '') + '\n');

      // Log parsed result if available
      if (resultText) {
        const agentLogPath = path.join(responsesDir, `${agent.name}.log`);
        fs.appendFileSync(agentLogPath, header + resultText + '\n');
      }
    } catch (e) {
      log(`Failed to log response for ${agent.name}: ${e.message}`, this.id);
    }

    // Write agent report to SQLite (cost data included — no longer writes to cost.csv)
    if (resultText || killedByTimeout || !success) {
      try {
        let reportBody;
        if (killedByTimeout || !success) {
          const errorType = killedByTimeout ? '⏰ Timeout' : '❌ Error';
          const errorMsg = killedByTimeout
            ? `Killed after exceeding the ${Math.floor(config.agentTimeoutMs / 60000)}m timeout limit.`
            : `Agent failed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}.`;
          // Capture partial work on timeout
          let partialWork = '';
          if (killedByTimeout) {
            try {
              const repoDir = path.join(this.projectDir, 'repo');
              if (fs.existsSync(path.join(repoDir, '.git'))) {
                const diffStat = execSync('git diff --stat HEAD 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim();
                const stagedStat = execSync('git diff --stat --cached HEAD 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim();
                if (diffStat || stagedStat) {
                  partialWork = `\n\n### Partial Work Detected\n\nUncommitted changes found in repo:\n\`\`\`\n${(stagedStat ? 'Staged:\n' + stagedStat + '\n' : '')}${(diffStat ? 'Unstaged:\n' + diffStat : '')}\n\`\`\``;
                }
              }
            } catch {}
          }
          reportBody = `## ${errorType}\n\n${errorMsg}\n\n- Duration: ${durationStr}${partialWork}`;
          // Include partial result text if we have it
          if (resultText) {
            reportBody += `\n\n### Partial Response\n\n${resultText.trim()}`;
          }
        } else {
          reportBody = resultText.trim();
        }
        // Prepend time log to all reports
        const agentStartTime = new Date(this.currentAgentStartTime).toLocaleString('sv-SE');
        const endTime = new Date().toLocaleString('sv-SE');
        reportBody = `> ⏱ Started: ${agentStartTime} | Ended: ${endTime} | Duration: ${durationStr}\n\n${reportBody}`;
        const db = this.getDb();
        db.exec(`CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cycle INTEGER NOT NULL,
          agent TEXT NOT NULL,
          body TEXT NOT NULL,
          summary TEXT,
          milestone_id TEXT,
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )`);
        try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN input_tokens INTEGER'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN output_tokens INTEGER'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN cache_read_tokens INTEGER'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN success INTEGER'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN model TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN timed_out INTEGER'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN key_id TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
        db.prepare(`INSERT INTO reports (cycle, agent, body, created_at, cost, duration_ms, input_tokens, output_tokens, cache_read_tokens, success, model, timed_out, key_id, visibility_mode, visibility_issues, milestone_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          this.cycleCount, agent.name, reportBody, new Date().toISOString(),
          cost ?? null, durationMs ?? null,
          usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.cacheReadTokens ?? null,
          success ? 1 : 0, this.currentAgentModel ?? null, killedByTimeout ? 1 : 0,
          this.currentAgentKeyId ?? null,
          this.currentAgentVisibility?.mode || 'full', JSON.stringify(this.currentAgentVisibility?.issues || []), this.currentMilestoneId || null
        );
        const lastId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        db.close();
        log(`Saved report for ${agent.name}`, this.id);
        // Broadcast new report via SSE
        broadcastReportUpdate(this.id, lastId, agent.name, this.cycleCount);
      } catch (dbErr) {
        log(`Failed to write report: ${dbErr.message}`, this.id);
      }
    }

    log(`${agent.name} done (success: ${success})${tokenInfo}`, this.id);
    const summary = resultText ? stripMetaBlocks(resultText).slice(0, 500).replace(/\n+/g, ' ').trim() : '';
    broadcastEvent({ type: 'agent-done', project: this.id, agent: agent.name, success, summary });
    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.currentAgentLog = [];
    broadcastStatusUpdate(this.id);
    this.currentAgentModel = null; this.currentAgentCost = 0; this.currentAgentUsage = null; this.currentAgentKeyId = null; this.currentAgentVisibility = null;

    return { success, resultText, killedByTimeout: !!killedByTimeout };
  }

  async runAgent(agent, config, mode = null, task = null, visibility = null) {
    this.currentAgent = agent.name;
    this.currentAgentKeyId = null;
    this.currentAgentVisibility = visibility || { mode: 'full', issues: [] };
    this.currentAgentStartTime = Date.now();
    broadcastStatusUpdate(this.id);
    const runAbortController = new AbortController();
    this.currentAgentProcess = {
      kill: () => runAbortController.abort(),
    };
    const modeStr = mode ? ` [${mode}]` : '';
    log(`Running: ${agent.name}${agent.isManager ? ' (manager)' : ''}${modeStr}`, this.id);

    // Ensure agent notes directory exists for this agent
    const agentNotesDir = this.getAgentNotesDir(agent.name);
    fs.mkdirSync(agentNotesDir, { recursive: true });

    // Build the prompt (shared between CLI and API paths)
    const skillContent = this._buildAgentPrompt(agent, task, visibility);
    if (!skillContent) {
      const skillPath = agent.isManager
        ? path.join(ROOT, 'agent', 'managers', `${agent.name}.md`)
        : path.join(this.workerSkillsDir, `${agent.name}.md`);
      log(`Skill file not found: ${skillPath}, skipping ${agent.name}`, this.id);
      this.currentAgent = null;
      this.currentAgentProcess = null;
      this.currentAgentStartTime = null;
      this.currentAgentLog = [];
      this.currentAgentModel = null; this.currentAgentCost = 0; this.currentAgentUsage = null; this.currentAgentKeyId = null; this.currentAgentVisibility = null;
      return { success: false, resultText: '' };
    }

    const agentTierOrModel = agent.rawModel || config.model || 'mid';

    // Resolve token from key pool first — provider comes from the resolved key
    const oauthTokenGetter = async (authFile, provider) => {
      return getOAuthAccessToken(provider, this.id);
    };
    const keyResult = await resolveKeyForProject(config, null, oauthTokenGetter);
    let resolvedToken = keyResult?.token || null;
    let resolvedKeyId = keyResult?.keyId || null;
    const resolvedKeyType = keyResult?.type || 'api';
    this.currentAgentKeyId = resolvedKeyId;

    // Fallback: setupToken when project key selection is not configured
    if (!resolvedToken && config.setupToken) {
      resolvedToken = config.setupToken;
    }

    // Derive provider from the resolved key
    let providerHint;
    if (keyResult?.provider) {
      providerHint = keyResult.provider;
    } else if (config.setupTokenProvider) {
      providerHint = config.setupTokenProvider;
    } else if (resolvedToken) {
      providerHint = detectProviderFromToken(resolvedToken);
    } else {
      providerHint = 'anthropic';
    }

    const runtimeSelection = getProviderRuntimeSelection({
      provider: providerHint,
      modelTier: agentTierOrModel,
      keyResult,
      projectModels: config.models,
    });
    const agentModel = runtimeSelection.selectedModel;
    const reasoningEffort = runtimeSelection.reasoningEffort || null;
    const customConfig = runtimeSelection.customConfig || null;

    if (!resolvedToken) {
      log(`No API token configured for ${agent.name} (model: ${agentModel}). Skipping agent run. Add a key in Settings.`, this.id);
      this.currentAgent = null;
      this.currentAgentProcess = null;
      this.currentAgentStartTime = null;
      this.currentAgentLog = [];
      this.currentAgentModel = null; this.currentAgentCost = 0; this.currentAgentUsage = null; this.currentAgentKeyId = null; this.currentAgentVisibility = null;
      broadcastStatusUpdate(this.id);
      return { error: 'no_token', message: 'No API key configured. Add one in Settings > Credentials.' };
    }

    const agentEnv = {
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      TBC_DB: this.projectDbPath,
      TBC_VISIBILITY: visibility?.mode || 'full',
      TBC_FOCUSED_ISSUES: visibility?.issues?.join(',') || '',
    };

    const tierLabel = runtimeSelection.reasoningEffort ? `${agentModel} (${runtimeSelection.reasoningEffort})` : agentModel;
    log(`Using API runner for ${agent.name} (model: ${tierLabel})`, this.id);
    this.currentAgentModel = tierLabel;

    const projectId = this.id;
    const result = await runAgentWithAPI({
      prompt: skillContent,
      model: agentModel,
      token: resolvedToken,
      keyType: resolvedKeyType,
      provider: providerHint,
      customConfig,
      reasoningEffort,
      cwd: this.path,
      timeoutMs: config.agentTimeoutMs || 0,
      env: agentEnv,
      allowedRepo: agent.name === 'doctor' ? null : (this.repo || null),
      allowedPaths: this._getAgentFilesystemPolicy(agent, visibility),
      issuePolicy: { ...(visibility || { mode: 'full', issues: [] }), actor: agent.name },
      abortSignal: runAbortController.signal,
      keyId: resolvedKeyId,
      onRateLimited: (kid, cooldownMs) => markRateLimited(kid, cooldownMs || 5 * 60_000),
      resolveNewToken: async () => {
        const newKey = await resolveKeyForProject(config, null, oauthTokenGetter);
        if (newKey?.provider) {
          const newRuntimeSelection = getProviderRuntimeSelection({
            provider: newKey.provider,
            modelTier: agentTierOrModel,
            keyResult: newKey,
            projectModels: null,
          });
          newKey.model = newRuntimeSelection.selectedModel;
          newKey.reasoningEffort = newRuntimeSelection.reasoningEffort || null;
          newKey.customConfig = newRuntimeSelection.customConfig || null;
        }
        if (newKey?.keyId) this.currentAgentKeyId = newKey.keyId;
        return newKey;
      },
      log: (msg) => {
        log(`  [${agent.name}] ${msg}`, projectId);
        if (typeof msg === 'string' && msg.startsWith('Tool: ')) return;
        const event = { time: Date.now(), type: 'thinking', content: String(msg) };
        this.currentAgentLog.push(event);
        if (this.currentAgentLog.length > 500) this.currentAgentLog.shift();
        broadcastLiveAgentEvent(projectId, event);
      },
      onEvent: (event) => {
        const enriched = { time: Date.now(), ...event };
        this.currentAgentLog.push(enriched);
        if (this.currentAgentLog.length > 500) this.currentAgentLog.shift();
        broadcastLiveAgentEvent(projectId, enriched);
      },
      onProgress: ({ usage, cost }) => {
        this.currentAgentCost = cost;
        this.currentAgentUsage = usage;
      },
    });

    if (result.success && resolvedKeyId) {
      markKeySucceeded(resolvedKeyId);
    }

    return this._postProcessAgentRun(agent, config, {
      resultText: result.resultText,
      cost: result.cost,
      durationMs: result.durationMs,
      killedByTimeout: result.timedOut || false,
      apiSuccess: result.success,
      usage: result.usage,
      rawOutput: JSON.stringify({ usage: result.usage, resultText: result.resultText }),
    });
  }
}

// --- Load Projects ---
function loadProjects() {
  const projectsPath = path.join(TBC_HOME, 'projects.yaml');
  try {
    if (!fs.existsSync(projectsPath)) {
      const defaultConfig = `# TheBotCompany - Project Registry
projects:
  # Example:
  # m2sim:
  #   path: ~/dev/src/github.com/sarchlab/m2sim
  #   enabled: true
`;
      fs.writeFileSync(projectsPath, defaultConfig);
      log(`Created ${projectsPath}`);
      return {};
    }
    const raw = fs.readFileSync(projectsPath, 'utf-8');
    const config = yaml.load(raw) || {};
    return config.projects || {};
  } catch (e) {
    log(`Failed to load projects.yaml: ${e.message}`);
    return {};
  }
}

function syncProjects() {
  const config = loadProjects();
  
  for (const [id, cfg] of Object.entries(config)) {
    if (!projects.has(id)) {
      const runner = new ProjectRunner(id, cfg);
      projects.set(id, runner);
      if (runner.enabled) {
        runner.start();
      }
    }
  }
  
  for (const [id, runner] of projects) {
    if (!(id in config)) {
      runner.stop();
      projects.delete(id);
    }
  }
}

// --- Static File Serving ---
function serveStatic(req, res, urlPath) {
  let filePath = path.join(MONITOR_DIST, urlPath === '/' ? 'index.html' : urlPath);
  
  // SPA fallback
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    filePath = path.join(MONITOR_DIST, 'index.html');
  }
  
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

// --- Basic Auth ---
const TBC_PASSWORD = process.env.TBC_PASSWORD || null;

function isAuthenticated(req) {
  if (!TBC_PASSWORD) return true;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [, pass] = decoded.split(':');
    if (pass === TBC_PASSWORD) return true;
  }
  return false;
}

function requireWrite(req, res) {
  if (isAuthenticated(req)) return true;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Authentication required for write operations' }));
  return false;
}

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

  // --- VAPID public key ---
  if (req.method === 'GET' && url.pathname === '/api/push/vapid-key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: VAPID_PUBLIC || null }));
    return;
  }

  // --- Push subscription ---
  if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const sub = JSON.parse(body);
        if (sub.endpoint) {
          pushSubscriptions.set(sub.endpoint, sub);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing endpoint' }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { endpoint } = JSON.parse(body);
        pushSubscriptions.delete(endpoint);
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- Notifications API ---
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(notifications));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') {
    for (const n of notifications) n.read = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3];
    const n = notifications.find(x => x.id === id);
    if (n) n.read = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- SSE endpoint ---
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // --- Auth status ---
  if (req.method === 'GET' && url.pathname === '/api/auth') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: isAuthenticated(req), passwordRequired: !!TBC_PASSWORD }));
    return;
  }

  // --- Settings (global token) ---

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const anthropicToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
    const openaiToken = process.env.OPENAI_API_KEY || null;
    const googleToken = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    const codexCreds = loadOAuthCredentials('openai-codex');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      // Backward compat fields
      hasGlobalToken: !!anthropicToken,
      globalTokenPreview: anthropicToken ? maskToken(anthropicToken) : null,
      tokenType: anthropicToken ? (anthropicToken.startsWith('sk-ant-oat') ? 'oauth' : 'api_key') : null,
      providers: {
        anthropic: { hasToken: !!anthropicToken, preview: anthropicToken ? maskToken(anthropicToken) : null },
        openai: { hasToken: !!openaiToken, preview: openaiToken ? maskToken(openaiToken) : null },
        google: { hasToken: !!googleToken, preview: googleToken ? maskToken(googleToken) : null },
        'openai-codex': { hasToken: !!codexCreds?.access, type: 'oauth' },
      },
      // New: key pool
      keyPool: getKeyPoolSafe(),
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/token') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { token, provider: forceProvider } = JSON.parse(body);
        const envPath = path.join(TBC_HOME, '.env');
        let envContent = '';
        try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch {}

        // Detect provider from token or explicit provider field
        const provider = forceProvider || detectTokenProvider(token) || 'anthropic';

        // Provider → env var mapping
        const providerEnvVars = {
          anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
          openai: ['OPENAI_API_KEY'],
          google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        };

        // Clear existing env vars for this provider
        const varsToClean = providerEnvVars[provider] || [];
        for (const v of varsToClean) {
          envContent = envContent.replace(new RegExp(`^${v}=.*\\n?`, 'm'), '');
          delete process.env[v];
        }

        if (token) {
          // Pick the right env var
          let envVar;
          if (provider === 'anthropic') {
            envVar = token.startsWith('sk-ant-oat') ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
          } else if (provider === 'openai') {
            envVar = 'OPENAI_API_KEY';
          } else if (provider === 'google') {
            envVar = 'GEMINI_API_KEY';
          } else {
            envVar = 'ANTHROPIC_API_KEY';
          }
          envContent = envContent.trimEnd() + `\n${envVar}=${token}\n`;
          process.env[envVar] = token;

          // Also add to key pool (backward compat)
          addKey({ label: `${provider.charAt(0).toUpperCase() + provider.slice(1)}`, token, provider });
        } else {
          // Token removal — remove matching pool entries for this provider
          const pool = loadKeyPool();
          const toRemove = pool.keys.filter(k => k.provider === provider && k.type === 'api_key');
          for (const k of toRemove) removeKey(k.id);
        }

        fs.writeFileSync(envPath, envContent);

        // Return updated status for all providers
        const anthropicToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
        const openaiToken = process.env.OPENAI_API_KEY || null;
        const googleToken = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
        const codexCreds = loadOAuthCredentials('openai-codex');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          provider,
          hasGlobalToken: !!anthropicToken,
          tokenType: anthropicToken ? (anthropicToken.startsWith('sk-ant-oat') ? 'oauth' : 'api_key') : null,
          providers: {
            anthropic: { hasToken: !!anthropicToken, preview: anthropicToken ? maskToken(anthropicToken) : null },
            openai: { hasToken: !!openaiToken, preview: openaiToken ? maskToken(openaiToken) : null },
            google: { hasToken: !!googleToken, preview: googleToken ? maskToken(googleToken) : null },
            'openai-codex': { hasToken: !!codexCreds?.access, type: 'oauth' },
          },
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- Key Pool CRUD endpoints ---

  if (req.method === 'GET' && url.pathname === '/api/keys') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...getKeyPoolSafe(), allowCustomProvider: ALLOW_CUSTOM_PROVIDER }));
    return;
  }

  const keyGetMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (req.method === 'GET' && keyGetMatch) {
    if (!requireWrite(req, res)) return;
    const key = getKeyPoolSafe().keys.find(k => k.id === keyGetMatch[1]);
    if (!key) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Key not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/keys') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { label, token, provider, type, authFile, customConfig } = JSON.parse(body);
        if (provider === 'custom' && !ALLOW_CUSTOM_PROVIDER) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Custom provider is disabled on this instance (set TBC_ALLOW_CUSTOM_PROVIDER=true to enable)' }));
          return;
        }
        if (type === 'oauth' && authFile) {
          // OAuth credential (browser sign-in) — no token, has authFile
          addOAuthKey({ label, provider, authFile });
        } else if (token) {
          addKey({ label, token, provider, type, customConfig });
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token is required (or authFile for OAuth)' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getKeyPoolSafe()));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // PUT /api/keys/:id
  const keysPutMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (req.method === 'PUT' && keysPutMatch) {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const patch = JSON.parse(body);
        if (patch.customConfig && !ALLOW_CUSTOM_PROVIDER) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Custom provider is disabled on this instance' }));
          return;
        }
        const updated = updateKey(keysPutMatch[1], patch);
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Key not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getKeyPoolSafe()));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /api/keys/:id
  const keysDeleteMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (req.method === 'DELETE' && keysDeleteMatch) {
    if (!requireWrite(req, res)) return;
    removeKey(keysDeleteMatch[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getKeyPoolSafe()));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/keys/reorder') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { orderedIds } = JSON.parse(body);
        reorderKeys(orderedIds);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getKeyPoolSafe()));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- OAuth endpoints (generic, supports all pi-ai providers) ---

  // List available OAuth providers
  if (req.method === 'GET' && url.pathname === '/api/oauth/providers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listOAuthProviders()));
    return;
  }

  // Start OAuth login flow
  if (req.method === 'POST' && url.pathname === '/api/oauth/login') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { provider: providerId, project: projectId } = JSON.parse(body);
        if (!providerId) throw new Error('provider is required');
        const flow = await startOAuthLogin(providerId, projectId || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authorization_url: flow.authorization_url, flowId: flow.flowId }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Submit manual code/redirect URL for active flow
  if (req.method === 'POST' && url.pathname === '/api/oauth/submit-code') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { flowId, code } = JSON.parse(body);
        if (!flowId || !code) throw new Error('flowId and code are required');
        submitManualCode(flowId, code);
        // Wait briefly for the flow to complete
        const { waitForFlow } = await import('./oauth.js');
        const completed = await waitForFlow(flowId, 10000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, completed }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Check OAuth status for a provider
  if (req.method === 'GET' && url.pathname === '/api/oauth/status') {
    const providerId = url.searchParams.get('provider');
    const projectId = url.searchParams.get('project') || null;
    if (!providerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'provider param required' }));
      return;
    }
    const status = await checkOAuthStatus(providerId, projectId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // Logout / clear OAuth credentials
  if (req.method === 'POST' && url.pathname === '/api/oauth/logout') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { provider: providerId, project: projectId } = JSON.parse(body);
        if (!providerId) throw new Error('provider is required');
        clearOAuthCredentials(providerId, projectId || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Backward-compatible OpenAI Codex endpoints
  if (req.method === 'POST' && url.pathname === '/api/openai-codex/login') {
    if (!requireWrite(req, res)) return;
    const projectId = url.searchParams.get('project') || null;
    try {
      const flow = await startOAuthLogin('openai-codex', projectId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authorization_url: flow.authorization_url, flowId: flow.flowId }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/openai-codex/status') {
    const projectId = url.searchParams.get('project') || null;
    const status = await checkOAuthStatus('openai-codex', projectId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/openai-codex/logout') {
    if (!requireWrite(req, res)) return;
    const projectId = url.searchParams.get('project') || null;
    clearOAuthCredentials('openai-codex', projectId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // --- Models API (fetch from Anthropic) ---

  if (req.method === 'GET' && url.pathname === '/api/models') {
    const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No auth token configured' }));
      return;
    }
    try {
      const isOAuth = token.startsWith('sk-ant-oat');
      const headers = { 'anthropic-version': '2023-06-01' };
      if (isOAuth) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
      } else {
        headers['x-api-key'] = token;
      }
      const resp = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers });
      if (!resp.ok) {
        const err = await resp.text();
        res.writeHead(resp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Anthropic API error: ${resp.status}`, details: err }));
        return;
      }
      const data = await resp.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Global API ---
  
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      projectCount: projects.size,
      projects: Array.from(projects.values()).map(p => p.getStatus())
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      projects: Array.from(projects.values()).map(p => p.getStatus())
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reload') {
    if (!requireWrite(req, res)) return;
    syncProjects();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projectCount: projects.size }));
    return;
  }

  // GET /api/github/orgs - List GitHub orgs + current user
  if (req.method === 'GET' && url.pathname === '/api/github/orgs') {
    try {
      const user = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 15000 }).trim();
      let orgs = [];
      try {
        orgs = execSync('gh api user/orgs --jq ".[].login"', { encoding: 'utf-8', timeout: 15000 })
          .trim().split('\n').filter(Boolean);
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user, orgs: [user, ...orgs] }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/github/repos?owner=xxx - List repos for an owner
  if (req.method === 'GET' && url.pathname === '/api/github/repos') {
    const owner = url.searchParams.get('owner');
    if (!owner) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing owner parameter' }));
      return;
    }
    try {
      const output = execSync(
        `gh repo list ${owner} --json nameWithOwner,name,description --limit 100`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      const repos = JSON.parse(output);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ repos }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/github/create-repo - Create a new GitHub repo
  if (req.method === 'POST' && url.pathname === '/api/github/create-repo') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, owner, isPrivate, description } = JSON.parse(body);
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing repo name' }));
          return;
        }
        
        // Get current user to check if owner is user or org
        const currentUser = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 15000 }).trim();
        const isOrg = owner && owner !== currentUser;
        
        let cmd = `gh repo create`;
        if (isOrg) {
          cmd += ` ${owner}/${name}`;
        } else {
          cmd += ` ${name}`;
        }
        cmd += isPrivate ? ' --private' : ' --public';
        if (description) cmd += ` --description ${JSON.stringify(description)}`;
        // Create in TBC_HOME
        const repoId = `${owner || currentUser}/${name}`;
        const projectDir = path.join(TBC_HOME, 'dev', 'src', 'github.com', owner || currentUser, name);
        fs.mkdirSync(projectDir, { recursive: true });
        const repoDir = path.join(projectDir, 'repo');
        
        // Create the repo on GitHub (without --clone)
        execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
        
        // Clone into the 'repo' subdirectory
        const cloneUrl = `https://github.com/${owner || currentUser}/${name}.git`;
        execSync(`git clone ${cloneUrl} repo`, { cwd: projectDir, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: repoId, path: repoDir }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/projects/clone - Clone a GitHub repo and check for spec.md
  if (req.method === 'POST' && url.pathname === '/api/projects/clone') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: repoUrl } = JSON.parse(body);
        if (!repoUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url' }));
          return;
        }

        const parsed = parseGithubUrl(repoUrl);
        if (!parsed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid GitHub URL. Expected format: https://github.com/username/reponame' }));
          return;
        }

        if (projects.has(parsed.id)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Project "${parsed.id}" is already registered` }));
          return;
        }

        fs.mkdirSync(parsed.projectDir, { recursive: true });

        if (fs.existsSync(path.join(parsed.repoDir, '.git'))) {
          try {
            execSync('git pull', { cwd: parsed.repoDir, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
            log(`Pulled latest for ${parsed.id}`);
          } catch (e) {
            log(`Git pull failed for ${parsed.id}: ${e.message}`);
          }
        } else {
          try {
            execSync(`git clone ${parsed.cloneUrl} repo`, {
              cwd: parsed.projectDir,
              encoding: 'utf-8',
              timeout: 120000,
              stdio: 'pipe'
            });
            log(`Cloned ${parsed.id}`);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Failed to clone repository: ${e.message}` }));
            return;
          }
        }

        const knowledgeSpecPath = path.join(parsed.projectDir, 'knowledge', 'spec.md');
        const repoSpecPath = path.join(parsed.repoDir, 'spec.md');
        const specPath = fs.existsSync(knowledgeSpecPath) ? knowledgeSpecPath : repoSpecPath;
        const hasSpec = fs.existsSync(specPath);
        let specContent = null;
        if (hasSpec) {
          specContent = fs.readFileSync(specPath, 'utf-8');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          id: parsed.id,
          path: parsed.repoDir,
          hasSpec,
          specContent,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/projects/add - Add a new project
  if (req.method === 'POST' && url.pathname === '/api/projects/add') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id, path: projectPath, spec, budgetPer24h } = JSON.parse(body);
        if (!id || !projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing id or path' }));
          return;
        }

        const resolvedPath = projectPath.replace(/^~/, process.env.HOME);

        // Write project-private knowledge/spec.md if spec data provided
        if (spec && (spec.whatToBuild || spec.successCriteria)) {
          const projectRoot = path.dirname(resolvedPath);
          const knowledgeDir = path.join(projectRoot, 'knowledge');
          const specPath = path.join(knowledgeDir, 'spec.md');
          const specContent = `# Project Specification\n\n## What do you want to build?\n\n${spec.whatToBuild || ''}\n\n## How do you consider the project is success?\n\n${spec.successCriteria || ''}\n`;
          fs.mkdirSync(knowledgeDir, { recursive: true });
          fs.writeFileSync(specPath, specContent);
        }

        const projectsPath = path.join(TBC_HOME, 'projects.yaml');
        const raw = fs.readFileSync(projectsPath, 'utf-8');
        const projConfig = yaml.load(raw) || {};
        if (!projConfig.projects) projConfig.projects = {};

        projConfig.projects[id] = { path: resolvedPath, enabled: true };

        fs.writeFileSync(projectsPath, yaml.dump(projConfig, { lineWidth: -1 }));
        syncProjects();

        // Write initial project config with budget
        if (budgetPer24h !== undefined) {
          const runner = projects.get(id);
          if (runner) {
            const config = runner.loadConfig();
            config.budgetPer24h = parseFloat(budgetPer24h) || 0;
            fs.mkdirSync(runner.projectDir, { recursive: true });
            fs.writeFileSync(runner.configPath, yaml.dump(config, { lineWidth: -1 }));
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id, path: resolvedPath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /api/projects/:id - Remove a project
  // DELETE /api/projects/:id — only match exact project path (no sub-routes like /chats/1)
  const isExactProjectDelete = req.method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2] && (
    pathParts.length === 3 || // single-segment: /api/projects/m2sim
    (pathParts.length === 4 && `${pathParts[2]}/${pathParts[3]}` && projects.has(`${pathParts[2]}/${pathParts[3]}`)) // two-segment: /api/projects/sarchlab/m2sim
  ) && !(pathParts.length > 4); // NOT a sub-route like /chats/1
  if (isExactProjectDelete) {
    const twoSegId = pathParts[3] ? `${pathParts[2]}/${pathParts[3]}` : null;
    const projectId = (twoSegId && projects.has(twoSegId)) ? twoSegId : pathParts[2];
    try {
      const projectsPath = path.join(TBC_HOME, 'projects.yaml');
      const raw = fs.readFileSync(projectsPath, 'utf-8');
      const config = yaml.load(raw) || {};
      
      if (config.projects && config.projects[projectId]) {
        // Stop the runner if running
        const runner = projects.get(projectId);
        if (runner) runner.stop();
        projects.delete(projectId);
        
        delete config.projects[projectId];
        fs.writeFileSync(projectsPath, yaml.dump(config, { lineWidth: -1 }));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: projectId }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Project not found' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Project-scoped API ---
  // Support both single-segment (m2sim) and two-segment (sarchlab/m2sim) IDs

  if (pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2]) {
    const twoSegId = pathParts[3] ? `${pathParts[2]}/${pathParts[3]}` : null;
    let projectId, subPathStart;
    if (twoSegId && projects.has(twoSegId)) {
      projectId = twoSegId;
      subPathStart = 4;
    } else {
      projectId = pathParts[2];
      subPathStart = 3;
    }
    const runner = projects.get(projectId);

    if (!runner) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    const subPath = pathParts.slice(subPathStart).join('/');

    // GET /api/projects/:id/status
    if (req.method === 'GET' && subPath === 'status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runner.getStatus()));
      return;
    }

    // GET /api/projects/:id/logs
    if (req.method === 'GET' && subPath === 'logs') {
      const lines = parseInt(url.searchParams.get('lines')) || 50;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: runner.getLogs(lines) }));
      return;
    }

    // GET /api/projects/:id/agent-log
    if (req.method === 'GET' && subPath === 'agent-log') {
      const running = runner.currentAgent !== null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Resolve key label from pool
      let keyLabel = null;
      if (runner.currentAgentKeyId) {
        const pool = getKeyPoolSafe();
        keyLabel = (pool.keys || []).find(k => k.id === runner.currentAgentKeyId)?.label || null;
      }
      res.end(JSON.stringify({
        running,
        agent: runner.currentAgent,
        model: runner.currentAgentModel,
        keyId: runner.currentAgentKeyId || null,
        keyLabel,
        visibility: runner.currentAgentVisibility || { mode: 'full', issues: [] },
        startTime: runner.currentAgentStartTime,
        cost: runner.currentAgentCost || 0,
        usage: runner.currentAgentUsage || null,
        log: running ? runner.currentAgentLog : [],
      }));
      return;
    }

    // GET /api/projects/:id/agents
    if (req.method === 'GET' && subPath === 'agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runner.loadAgents()));
      return;
    }

    // GET /api/projects/:id/agents/:name
    if (req.method === 'GET' && subPath.startsWith('agents/') && subPath.split('/')[1]) {
      const agentName = subPath.split('/')[1];
      const details = runner.getAgentDetails(agentName);
      if (!details) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(details));
      return;
    }

    // PATCH /api/projects/:id/agents/:name - Update agent settings
    if (req.method === 'PATCH' && subPath.startsWith('agents/') && subPath.split('/')[1]) {
      const agentName = subPath.split('/')[1];
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { model } = JSON.parse(body);
          if (!model && model !== '') throw new Error('Missing model');
          
          // Check if this is a manager or worker
          const managersDir = path.join(ROOT, 'agent', 'managers');
          const workersDir = runner.workerSkillsDir;
          const isManager = fs.existsSync(path.join(managersDir, `${agentName}.md`));
          const isWorker = fs.existsSync(path.join(workersDir, `${agentName}.md`));
          
          if (!isManager && !isWorker) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Agent not found' }));
            return;
          }
          
          if (isManager) {
            // Manager settings go in project config.yaml (not the skill file)
            const config = runner.loadConfig();
            if (!config.managers) config.managers = {};
            if (!config.managers[agentName]) config.managers[agentName] = {};
            if (model) {
              config.managers[agentName].model = model;
            } else {
              // Empty string = clear override (inherit from skill file)
              delete config.managers[agentName].model;
              if (Object.keys(config.managers[agentName]).length === 0) {
                delete config.managers[agentName];
              }
            }
            fs.writeFileSync(runner.configPath, yaml.dump(config, { lineWidth: -1 }));
          } else {
            // Worker settings go in the skill file frontmatter
            const skillPath = path.join(workersDir, `${agentName}.md`);
            let content = fs.readFileSync(skillPath, 'utf-8');
            if (content.startsWith('---')) {
              if (model) {
                content = content.replace(/^(---[\s\S]*?)model:\s*.+$/m, `$1model: ${model}`);
                if (!content.match(/^model:/m)) {
                  content = content.replace(/^---\n/, `---\nmodel: ${model}\n`);
                }
              }
            } else {
              content = `---\n${model ? `model: ${model}\n` : ''}---\n${content}`;
            }
            fs.writeFileSync(skillPath, content);
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/config
    if (req.method === 'GET' && subPath === 'config') {
      const raw = fs.existsSync(runner.configPath) ? fs.readFileSync(runner.configPath, 'utf-8') : '';
      const config = runner.loadConfig();
      const projectToken = config.setupToken;
      const hasProjectToken = !!projectToken;
      const safeConfig = { ...config };
      delete safeConfig.setupToken;
      // Include key pool and selection info
      const keyPool = getKeyPoolSafe();
      const keySelection = config.keySelection || null;

      // Determine effective provider from key selection
      let detectedKey = null;
      if (keySelection?.keyId) {
        detectedKey = keyPool.keys.find(k => k.id === keySelection.keyId) || null;
      }
      if (!detectedKey) {
        detectedKey = keyPool.keys.find(k => k.enabled) || null;
      }
      const detectedProvider = detectedKey?.provider || 'anthropic';
      const detectedTiers = detectedProvider === 'custom' && detectedKey?.customConfig
        ? buildCustomTierMap(detectedKey.customConfig)
        : (MODEL_TIERS[detectedProvider] || {});

      // Build available models list per provider from pi-ai
      // Only show recent/relevant models, not the full historical catalog
      const EFFORT_LEVELS = ['medium', 'high', 'xhigh'];
      const ALLOWED_MODELS = {
        anthropic: /^claude-(opus-4-7|opus-4-6|sonnet-4-6)$|^claude-haiku-4-5-/,
        openai: /^(gpt-5\.[345]|o[34])/,
        'openai-codex': /^(gpt-5\.[345])/,
        google: /^gemini-[23]/,
        minimax: /MiniMax/,
      };
      const availableModels = {};
      for (const provider of Object.keys(MODEL_TIERS)) {
        try {
          const models = getPiModels(provider);
          const filter = ALLOWED_MODELS[provider];
          const entries = [];
          for (const m of models) {
            if (filter && !filter.test(m.id)) continue;
            if (m.id.includes('latest')) continue; // skip aliases, use exact versions
            if (m.reasoning) {
              for (const effort of EFFORT_LEVELS) {
                entries.push({ id: `${m.id}@${effort}`, name: `${m.name} (${effort})` });
              }
            } else {
              entries.push({ id: m.id, name: m.name });
            }
          }
          availableModels[provider] = entries;
        } catch { availableModels[provider] = []; }
      }
      availableModels.custom = [];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        config: safeConfig, raw, hasProjectToken,
        projectTokenPreview: projectToken ? maskToken(projectToken) : null,
        provider: detectedProvider,
        tiers: detectedTiers,
        allTiers: detectedProvider === 'custom' ? { ...MODEL_TIERS, custom: detectedTiers } : MODEL_TIERS,
        availableModels,
        keyPool,
        keySelection,
        allowCustomProvider: ALLOW_CUSTOM_PROVIDER,
      }));
      return;
    }

    // POST /api/projects/:id/token — set per-project key selection or direct token
    if (req.method === 'POST' && subPath === 'token') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { keyId, fallback, token, provider: explicitProvider, customConfig } = JSON.parse(body);
          const configPath = runner.configPath;
          const existing = fs.existsSync(configPath) ? yaml.load(fs.readFileSync(configPath, 'utf-8')) || {} : {};

          if (keyId !== undefined) {
            // New key pool selection mode
            delete existing.setupToken;
            delete existing.setupTokenProvider;
            if (keyId) {
              existing.keySelection = { keyId, fallback: fallback !== false };
            } else {
              // Clear selection (use global default)
              delete existing.keySelection;
            }
          } else {
            // Legacy mode: raw token
            if (token) {
              existing.setupToken = token;
              if (explicitProvider) existing.setupTokenProvider = explicitProvider;
              // Also add to global pool
              const entry = addKey({ label: `${explicitProvider || 'API'} (from ${projectId})`, token, provider: explicitProvider, customConfig });
              existing.keySelection = { keyId: entry.id, fallback: true };
            } else {
              delete existing.setupToken;
              delete existing.setupTokenProvider;
              delete existing.keySelection;
            }
          }

          fs.writeFileSync(configPath, yaml.dump(existing));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            hasProjectToken: !!(existing.setupToken || existing.keySelection?.keyId),
            keySelection: existing.keySelection || null,
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/projects/:id/config
    if (req.method === 'POST' && subPath === 'config') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { content } = JSON.parse(body);
          runner.saveConfig(content);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/projects/:id/models — update project-level model overrides
    if (req.method === 'POST' && subPath === 'models') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { models } = JSON.parse(body);
          // Read existing config, merge models, save
          const config = runner.loadConfig();
          if (models && (models.high || models.mid || models.low)) {
            config.models = {};
            if (models.high) config.models.high = models.high;
            if (models.mid) config.models.mid = models.mid;
            if (models.low) config.models.low = models.low;
          } else {
            delete config.models;
          }
          const newYaml = yaml.dump(config, { lineWidth: -1 });
          runner.saveConfig(newYaml);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, models: config.models || null }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/comments
    if (req.method === 'GET' && subPath === 'comments') {
      const author = url.searchParams.get('author');
      const page = parseInt(url.searchParams.get('page')) || 1;
      const perPage = parseInt(url.searchParams.get('per_page')) || 20;
      const result = await runner.getComments(author, page, perPage);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/projects/:id/prs
    if (req.method === 'GET' && subPath === 'prs') {
      const status = ['open', 'merged', 'closed', 'all'].includes(url.searchParams.get('status'))
        ? url.searchParams.get('status')
        : 'open';
      const prs = await runner.getPRs(status);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prs }));
      return;
    }

    // GET /api/projects/:id/milestones — list milestone records for tree rendering
    if (req.method === 'GET' && subPath === 'milestones') {
      try {
        const db = runner.getDb();
        const milestones = db.prepare(`
          SELECT id, milestone_id, title, description, cycles_budget, cycles_used, branch_name, parent_milestone_id, linked_pr_id, failure_reason, phase, status, created_at, completed_at
          FROM milestones
          ORDER BY created_at ASC, id ASC
        `).all();
        db.close();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ milestones }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/projects/:id/prs/:prId — single PR
    const prDetailMatch = req.method === 'GET' && subPath.match(/^prs\/(\d+)$/);
    if (prDetailMatch) {
      try {
        const prId = parseInt(prDetailMatch[1], 10);
        const pr = await runner.getPR(prId);
        if (!pr) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'PR not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pr }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/projects/:id/reports — agent cycle reports (posted by orchestrator)
    if (req.method === 'GET' && subPath === 'reports') {
      try {
        const db = runner.getDb();
        db.exec(`CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cycle INTEGER NOT NULL,
          agent TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )`);
        // Migrate: add summary/visibility columns if missing
        try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}
        try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
        const agent = url.searchParams.get('agent');
        const page = parseInt(url.searchParams.get('page')) || 1;
        const perPage = parseInt(url.searchParams.get('per_page')) || 20;
        let query = 'SELECT * FROM reports';
        const params = [];
        if (agent) { query += ' WHERE agent = ?'; params.push(agent); }
        query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(perPage, (page - 1) * perPage);
        const reports = db.prepare(query).all(...params);
        const total = db.prepare(`SELECT COUNT(*) as count FROM reports${agent ? ' WHERE agent = ?' : ''}`).get(...(agent ? [agent] : [])).count;
        db.close();
        // Enrich reports with key labels from key pool
        const keyPool = getKeyPoolSafe();
        const keyMap = new Map((keyPool.keys || []).map(k => [k.id, k.label]));
        for (const r of reports) {
          if (r.key_id) r.key_label = keyMap.get(r.key_id) || null;
          try { r.visibility_issues = r.visibility_issues ? JSON.parse(r.visibility_issues) : []; } catch { r.visibility_issues = []; }
          if (!r.visibility_mode) r.visibility_mode = 'full';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reports, total, page, perPage }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reports: [], total: 0, page: 1, perPage: 20 }));
      }
      return;
    }

    // POST /api/projects/:id/reports/:reportId/summarize — lazy summarization
    const summarizeMatch = req.method === 'POST' && subPath.match(/^reports\/(\d+)\/summarize$/);
    if (summarizeMatch) {
      const reportId = parseInt(summarizeMatch[1], 10);
      let keyResult = null;
      try {
        const db = runner.getDb();
        try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
        const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
        if (!report) { db.close(); res.writeHead(404); res.end('Not found'); return; }
        if (report.summary) { db.close(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ summary: report.summary })); return; }

        // Use key pool for token resolution
        const config = runner.loadConfig() || {};
        const oauthGetter = async (authFile, provider) => {
          return getOAuthAccessToken(provider);
        };
        const poolSafe = getKeyPoolSafe();
        const firstKey = poolSafe.keys.find(k => k.enabled);
        const providerHintForSummary = config.setupTokenProvider || firstKey?.provider || 'anthropic';

        keyResult = await resolveKeyForProject(config, providerHintForSummary, oauthGetter);
        const token = keyResult?.token || config.setupToken || null;

        if (!token) { db.close(); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No API token configured' })); return; }

        // Use the resolved key's actual provider for model resolution (not the hint)
        const actualProvider = keyResult?.provider || providerHintForSummary;
        const runtimeSelection = getProviderRuntimeSelection({
          provider: actualProvider,
          modelTier: 'xlow',
          keyResult,
          projectModels: null,
        });
        const model = runtimeSelection.selectedModel;

        log(`Summarize report ${reportId}: provider=${actualProvider}, model=${model}`, runner.id);

        // Strip meta blocks from body for cleaner summarization
        const cleanBody = report.body
          .replace(/^>\s*⏱.*$/m, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 4000);

        const prompt = `Summarize this agent report in 5-8 words. Return ONLY the summary, nothing else.\n\n${cleanBody}`;

        // Use pi-ai adapter for summarization (same auth logic as agent calls)
        const { piModel } = resolveModel(model, actualProvider);
        const isOAuth = keyResult?.type === 'oauth';
        const summaryResponse = await callModel(
          piModel,
          'You are a helpful assistant. Return ONLY the summary, nothing else.',
          [buildUserMessage(prompt)],
          [], // no tools
          { token, isOAuth, provider: actualProvider, customConfig: runtimeSelection.customConfig || null },
        );
        const summary = summaryResponse.content?.trim() || null;

        if (summary) {
          db.prepare('UPDATE reports SET summary = ? WHERE id = ?').run(summary, reportId);
        }
        db.close();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ summary }));
      } catch (e) {
        log(`Summarize error: ${e.message}`, runner.id);
        // Mark key as rate-limited if the error indicates a usage/rate limit
        if (keyResult?.keyId && /rate.limit|usage.limit|quota|429/i.test(e.message)) {
          const cooldownMs = parseSummarizeCooldown(e.message);
          markRateLimited(keyResult.keyId, cooldownMs);
          log(`Summarize: marked key ${keyResult.keyId} rate-limited for ${Math.ceil(cooldownMs / 60_000)}m`, runner.id);
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/projects/:id/issues/:issueId — single issue + comments
    const issueDetailMatch = req.method === 'GET' && subPath.match(/^issues\/(\d+)$/);
    if (issueDetailMatch) {
      try {
        const issueId = parseInt(issueDetailMatch[1], 10);
        const db = runner.getDb();
        const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId);
        const comments = issue ? db.prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC').all(issueId) : [];
        db.close();
        if (!issue) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Issue not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ issue, comments }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/projects/:id/issues/:issueId/comments — add comment
    const commentPostMatch = req.method === 'POST' && subPath.match(/^issues\/(\d+)\/comments$/);
    if (commentPostMatch) {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const issueId = parseInt(commentPostMatch[1], 10);
          const { author, body: commentBody } = JSON.parse(body);
          if (!commentBody?.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Comment body required' }));
            return;
          }
          const db = runner.getDb();
          const now = new Date().toISOString();
          const result = db.prepare('INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(issueId, author || 'human', commentBody.trim(), now);
          db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
          db.close();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: result.lastInsertRowid }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // PATCH /api/projects/:id/issues/:issueId — update issue status
    const issuePatchMatch = req.method === 'PATCH' && subPath.match(/^issues\/(\d+)$/);
    if (issuePatchMatch) {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        let db = null;
        try {
          const issueId = parseInt(issuePatchMatch[1], 10);
          const { status, actor } = JSON.parse(body);
          if (!['open', 'closed'].includes(status)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Status must be "open" or "closed"' }));
            return;
          }
          db = runner.getDb();
          const issue = db.prepare('SELECT id, creator, status FROM issues WHERE id = ?').get(issueId);
          if (!issue) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Issue not found' }));
            return;
          }
          const actingAs = actor || 'human';
          if (status === 'closed' && issue.status !== 'closed') {
            const { allowed, special } = runner._resolveAllowedIssueClosers(db, issue.creator);
            if (!allowed.has(actingAs)) {
              const error = special === 'chat-human'
                ? `Issue #${issueId} was opened by ${issue.creator} and can only be closed by chat or human`
                : `Issue #${issueId} was opened by ${issue.creator} and can only be closed by ${issue.creator} or athena`;
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error }));
              return;
            }
          }
          const now = new Date().toISOString();
          const closedAt = status === 'closed' ? now : null;
          const closedBy = status === 'closed' ? actingAs : null;
          db.prepare('UPDATE issues SET status = ?, updated_at = ?, updated_by = ?, closed_at = ?, closed_by = ? WHERE id = ?').run(status, now, actingAs, closedAt, closedBy, issueId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          try { db?.close(); } catch {}
        }
      });
      return;
    }

    // GET /api/projects/:id/issues
    if (req.method === 'GET' && subPath === 'issues') {
      const issues = await runner.getIssues();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issues }));
      return;
    }

    // POST /api/projects/:id/issues/create
    if (req.method === 'POST' && subPath === 'issues/create') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { title, body: issueBody, creator, assignee, text } = JSON.parse(body);
          // Support both structured and text input
          if (title) {
            const result = await runner.createIssue(title, issueBody, creator, assignee);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } else if (text) {
            const lines = text.trim().split('\n');
            const result = await runner.createIssue(lines[0], lines.slice(1).join('\n'), 'human');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } else {
            throw new Error('Missing title or text');
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/repo
    if (req.method === 'GET' && subPath === 'repo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        repo: runner.repo, 
        url: runner.repo ? `https://github.com/${runner.repo}` : null 
      }));
      return;
    }

    // GET /api/projects/:id/download - zip and download project data
    if (req.method === 'GET' && subPath === 'download') {
      try {
        const projectDataDir = runner.projectDir;
        if (!fs.existsSync(projectDataDir)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project data not found' }));
          return;
        }
        const filename = `${runner.id.replace(/\//g, '-')}-project.zip`;
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
        });
        const zip = spawn('zip', ['-r', '-q', '-', '.'], { cwd: projectDataDir, stdio: ['ignore', 'pipe', 'ignore'] });
        zip.stdout.pipe(res);
        zip.on('error', () => {
          // Fallback to tar if zip not available
          const tar = spawn('tar', ['-czf', '-', '-C', projectDataDir, '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
          res.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${filename.replace('.zip', '.tar.gz')}"`,
          });
          tar.stdout.pipe(res);
          tar.on('error', () => { res.end(); });
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/projects/:id/bootstrap - preview what bootstrap will do
    if (req.method === 'GET' && subPath === 'bootstrap') {
      if (!requireWrite(req, res)) return;
      try {
        const result = runner.bootstrapPreview();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/projects/:id/bootstrap - execute bootstrap
    if (req.method === 'POST' && subPath === 'bootstrap') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const options = body ? JSON.parse(body) : {};
          fs.mkdirSync(runner.chatsDir, { recursive: true });
          const result = runner.bootstrap(options);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...result }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/projects/:id/doctor - run AI Doctor agent
    if (req.method === 'POST' && subPath === 'doctor') {
      if (!requireWrite(req, res)) return;
      try {
        if (!runner.isPaused || runner.currentAgent) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Doctor is only available when the project is fully paused.' }));
          return;
        }
        const result = await runner.runDoctor();
        if (!result.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Doctor agent failed', ...result }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // --- Chat endpoints ---

    // GET /api/projects/:id/chats — list chat sessions
    if (req.method === 'GET' && subPath === 'chats') {
      try {
        const sessions = chatListSessions(runner.chatsDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/projects/:id/chats — create new session
    if (req.method === 'POST' && subPath === 'chats') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const session = chatCreateSession(runner.chatsDir, data.title, {
            selectedKeyId: typeof data.selectedKeyId === 'string' ? data.selectedKeyId : null,
            selectedModel: typeof data.selectedModel === 'string' ? data.selectedModel : null,
          });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ session }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/chats/:chatId — get session with messages
    const chatDetailMatch = req.method === 'GET' && subPath.match(/^chats\/(\d+)$/);
    if (chatDetailMatch) {
      try {
        const session = chatGetSession(runner.chatsDir, parseInt(chatDetailMatch[1]));
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
        } else {
          const chatId = parseInt(chatDetailMatch[1]);
          const activeStream = getActiveStream(chatId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            session,
            streaming: !!activeStream,
            streamingContent: activeStream ? { text: activeStream.text, toolCalls: activeStream.toolCalls } : null,
          }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // PATCH /api/projects/:id/chats/:chatId/preferences — persist session key/model selection
    const chatPreferencesMatch = req.method === 'PATCH' && subPath.match(/^chats\/(\d+)\/preferences$/);
    if (chatPreferencesMatch) {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const chatId = parseInt(chatPreferencesMatch[1]);
          const session = chatUpdateSessionPreferences(runner.chatsDir, chatId, {
            selectedKeyId: typeof data.selectedKeyId === 'string' && data.selectedKeyId !== 'auto' ? data.selectedKeyId : null,
            selectedModel: typeof data.selectedModel === 'string' && data.selectedModel !== 'auto' ? data.selectedModel : null,
          });
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ session }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/chats/:chatId/stream — reconnect to active SSE stream
    const chatStreamMatch = req.method === 'GET' && subPath.match(/^chats\/(\d+)\/stream$/);
    if (chatStreamMatch) {
      const chatId = parseInt(chatStreamMatch[1]);
      const activeStream = getActiveStream(chatId);
      if (!activeStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      activeStream.clients.add(res);
      res.on('close', () => { activeStream.clients.delete(res); });
      return;
    }

    // DELETE /api/projects/:id/chats/:chatId — delete session
    const chatDeleteMatch = req.method === 'DELETE' && subPath.match(/^chats\/(\d+)$/);
    if (chatDeleteMatch) {
      if (!requireWrite(req, res)) return;
      try {
        chatDeleteSession(runner.chatsDir, parseInt(chatDeleteMatch[1]));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/projects/:id/chats/upload — upload file for chat
    if (req.method === 'POST' && subPath === 'chats/upload') {
      if (!requireWrite(req, res)) return;
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks);
          // Parse multipart boundary
          const contentType = req.headers['content-type'] || '';
          const boundaryMatch = contentType.match(/boundary=(.+)/);
          if (!boundaryMatch) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing multipart boundary' }));
            return;
          }
          const boundary = '--' + boundaryMatch[1];
          const parts = body.toString('binary').split(boundary).filter(p => p.trim() && p.trim() !== '--');
          
          let filename = null;
          let fileData = null;
          let mimeType = null;

          for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd === -1) continue;
            const headers = part.slice(0, headerEnd);
            const filenameMatch = headers.match(/filename="([^"]+)"/);
            const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
            if (filenameMatch) {
              filename = filenameMatch[1];
              mimeType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
              // Extract binary data (skip headers + \r\n\r\n, remove trailing \r\n)
              const dataStart = headerEnd + 4;
              const dataEnd = part.endsWith('\r\n') ? part.length - 2 : part.length;
              fileData = Buffer.from(part.slice(dataStart, dataEnd), 'binary');
            }
          }

          if (!filename || !fileData) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No file in upload' }));
            return;
          }

          // Save to uploads/
          const uploadsDir = runner.uploadsDir;
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          const ext = path.extname(filename) || '.bin';
          const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          fs.writeFileSync(path.join(uploadsDir, safeName), fileData);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            filename: safeName,
            originalName: filename,
            mimeType,
            size: fileData.length,
            url: `/api/projects/${projectId}/uploads/${safeName}`,
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/uploads/:filename — serve uploaded files
    const uploadMatch = req.method === 'GET' && subPath.match(/^uploads\/(.+)$/);
    if (uploadMatch) {
      const filename = uploadMatch[1];
      const filePath = path.join(runner.uploadsDir, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv' };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // POST /api/projects/:id/chats/:chatId/message — send message (SSE streaming)
    const chatMessageMatch = req.method === 'POST' && subPath.match(/^chats\/(\d+)\/message$/);
    if (chatMessageMatch) {
      if (!requireWrite(req, res)) return;
      const chatId = parseInt(chatMessageMatch[1]);
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const respondChatError = (statusCode, payload) => {
          try {
            chatSaveMessage(runner.chatsDir, chatId, 'assistant', formatStoredChatErrorMessage({
              error: payload.error,
              statusCode,
              source: payload.source || 'server',
              cooldownMs: payload.cooldownMs || 0,
            }), null, { success: false });
          } catch {}
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        try {
          const data = JSON.parse(body);
          if (!data.message?.trim()) {
            respondChatError(400, { error: 'Message is required', source: 'validation' });
            return;
          }

          // Save user message once for this send attempt
          const imageUrls = (data.images || []).map(img => `/api/projects/${projectId}/uploads/${img.filename}`);
          chatSaveMessage(runner.chatsDir, chatId, 'user', data.message.trim(), imageUrls.length > 0 ? imageUrls : null);

          // Resolve API key / model selection
          const config = runner.loadConfig();
          const oauthTokenGetter = async (authFile, provider) => {
            return getOAuthAccessToken(provider, runner.id);
          };
          const explicitKeyId = typeof data.keyId === 'string' && data.keyId.trim() ? data.keyId.trim() : null;
          const { model: explicitModel, reasoningEffort: explicitReasoningEffort } = parseExplicitModelSelection(data.model);
          if (explicitModel && !explicitKeyId) {
            respondChatError(400, { error: 'Select a key before selecting a specific model.', source: 'validation' });
            return;
          }

          const selectedKeySafe = explicitKeyId
            ? (getKeyPoolSafe().keys || []).find(key => key.id === explicitKeyId) || null
            : null;

          chatUpdateSessionPreferences(runner.chatsDir, chatId, {
            selectedKeyId: explicitKeyId,
            selectedModel: explicitModel,
          });
          if (explicitKeyId && !selectedKeySafe) {
            respondChatError(404, { error: 'Selected API key was not found.', errorType: 'key_not_found', source: 'local_selection' });
            return;
          }
          if (selectedKeySafe && !selectedKeySafe.enabled) {
            respondChatError(400, { error: 'Selected API key is disabled.', errorType: 'key_disabled', source: 'local_selection' });
            return;
          }
          if (selectedKeySafe?.rateLimited) {
            respondChatError(429, {
              error: `Selected API key is currently rate limited${selectedKeySafe.cooldownMs ? ` for about ${Math.ceil(selectedKeySafe.cooldownMs / 60_000)}m` : ''}.`,
              errorType: 'key_rate_limited',
              source: 'local_cooldown',
              cooldownMs: selectedKeySafe.cooldownMs || 0,
            });
            return;
          }

          const keyConfig = explicitKeyId
            ? { ...config, keySelection: { keyId: explicitKeyId, fallback: false } }
            : config;
          const keyResult = await resolveKeyForProject(keyConfig, null, oauthTokenGetter);
          if (!keyResult?.token) {
            respondChatError(400, { error: explicitKeyId ? 'Selected API key is unavailable.' : 'No API key configured. Add one in Settings > Credentials.', source: explicitKeyId ? 'local_selection' : 'configuration' });
            return;
          }
          if (explicitKeyId && keyResult.keyId !== explicitKeyId) {
            respondChatError(400, { error: 'Selected API key is unavailable.', errorType: 'key_unavailable', source: 'local_selection' });
            return;
          }

          const modelTier = data.modelTier || 'high';
          const providerHint = keyResult.provider || detectProviderFromToken(keyResult.token);
          const runtimeSelection = explicitModel
            ? {
                selectedModel: explicitModel,
                reasoningEffort: explicitReasoningEffort,
                customConfig: keyResult.customConfig || null,
              }
            : getProviderRuntimeSelection({
                provider: providerHint,
                modelTier,
                keyResult,
                projectModels: config.models,
              });

          // SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const chatOpts = {
            agentDir: runner.chatsDir,
            tbcDbPath: runner.projectDbPath,
            uploadsDir: runner.uploadsDir,
            projectPath: runner.path,
            chatId,
            userMessage: data.message.trim(),
            images: data.images || [],
            model: runtimeSelection.selectedModel,
            token: keyResult.token,
            provider: providerHint,
            customConfig: runtimeSelection.customConfig || null,
            res,
            reasoningEffort: runtimeSelection.reasoningEffort || null,
          };

          try {
            await streamChatMessage(chatOpts);
          } catch (chatErr) {
            // Check if rate-limited — try fallback key only in auto-key mode
            const isRateLimit = /rate.limit|usage.limit|quota|429/i.test(chatErr.message);
            if (isRateLimit && keyResult.keyId) {
              const cooldownMs = parseSummarizeCooldown(chatErr.message);
              markRateLimited(keyResult.keyId, cooldownMs);
              log(`Chat: marked key ${keyResult.keyId} rate-limited for ${Math.ceil(cooldownMs / 60_000)}m`, runner.id);

              if (explicitKeyId) {
                chatErr.errorType = 'provider_rate_limited';
                chatErr.source = 'provider_429';
                chatErr.cooldownMs = cooldownMs;
                chatErr.statusCode = 429;
                throw chatErr;
              }

              // Try fallback key
              const fallbackKey = await resolveKeyForProject(config, null, oauthTokenGetter);
              if (fallbackKey?.token && fallbackKey.token !== keyResult.token) {
                const fbProvider = fallbackKey.provider || detectProviderFromToken(fallbackKey.token);
                const fallbackSelection = getProviderRuntimeSelection({
                  provider: fbProvider,
                  modelTier,
                  keyResult: fallbackKey,
                  projectModels: null,
                });
                log(`Chat: falling back to key ${fallbackKey.keyId} (${fbProvider}), model → ${fallbackSelection.selectedModel}`, runner.id);
                chatOpts.token = fallbackKey.token;
                chatOpts.provider = fbProvider;
                chatOpts.model = fallbackSelection.selectedModel;
                chatOpts.reasoningEffort = fallbackSelection.reasoningEffort || null;
                chatOpts.customConfig = fallbackSelection.customConfig || null;
                await streamChatMessage(chatOpts);
              } else {
                throw chatErr; // no fallback available
              }
            } else {
              throw chatErr;
            }
          }

          res.end();
        } catch (e) {
          const errorPayload = {
            error: e.message,
            errorType: e.errorType || null,
            source: e.source || 'server',
            statusCode: e.statusCode || 500,
            cooldownMs: e.cooldownMs || 0,
          };
          try {
            chatSaveMessage(runner.chatsDir, chatId, 'assistant', formatStoredChatErrorMessage(errorPayload), null, { success: false });
          } catch {}
          if (!res.headersSent) {
            res.writeHead(errorPayload.statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorPayload));
          } else {
            res.write(`data: ${JSON.stringify({
              type: 'error',
              content: errorPayload.error,
              errorType: errorPayload.errorType,
              source: errorPayload.source,
              statusCode: errorPayload.statusCode,
              cooldownMs: errorPayload.cooldownMs,
            })}\n\n`);
            res.end();
          }
        }
      });
      return;
    }

    // POST /api/projects/:id/:action (pause, resume, skip, start, stop)
    // POST /api/projects/:id/archive or /unarchive
    if (req.method === 'POST' && (subPath === 'archive' || subPath === 'unarchive')) {
      if (!requireWrite(req, res)) return;
      const archive = subPath === 'archive';
      runner.archived = archive;
      // Update projects.yaml
      try {
        const configPath = path.join(TBC_HOME, 'projects.yaml');
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.load(raw) || {};
        if (config.projects && config.projects[projectId]) {
          if (archive) {
            config.projects[projectId].archived = true;
          } else {
            delete config.projects[projectId].archived;
          }
          fs.writeFileSync(configPath, yaml.dump(config));
        }
      } catch (e) {
        log(`Failed to update projects.yaml for archive: ${e.message}`);
      }
      if (archive && runner.running) {
        runner.pause('Archived');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, archived: archive }));
      return;
    }

    if (req.method === 'POST' && ['pause', 'resume', 'skip', 'start', 'stop', 'kill-run', 'kill-cycle', 'kill-epoch'].includes(subPath)) {
      if (!requireWrite(req, res)) return;
      switch (subPath) {
        case 'pause': runner.pause(); break;
        case 'resume': runner.resume(); break;
        case 'skip': runner.skip(); break;
        case 'start': runner.start(); break;
        case 'stop': runner.stop(); break;
        case 'kill-run': runner.killRun(); break;
        case 'kill-cycle': runner.killCycle(); break;
        case 'kill-epoch': runner.killEpoch(); break;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, action: subPath, projectId }));
      return;
    }
  }

  // --- Static Files ---
  if (SERVE_STATIC && fs.existsSync(MONITOR_DIST)) {
    serveStatic(req, res, url.pathname);
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
  for (const runner of projects.values()) {
    runner.stop();
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('Shutting down...');
  for (const runner of projects.values()) {
    runner.stop();
  }
  process.exit(0);
});
