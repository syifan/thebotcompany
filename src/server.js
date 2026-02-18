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

// Strip meta directive blocks from agent responses (keep human-readable text only)
function stripMetaBlocks(text) {
  if (!text) return text;
  return text
    .replace(/<!--\s*(SCHEDULE|MILESTONE|CLAIM_COMPLETE|VERIFY_PASS|VERIFY_FAIL)\s*-->[\s\S]*?<!--\s*\/\1\s*-->/g, '')
    .replace(/<!--\s*(CLAIM_COMPLETE|VERIFY_PASS|VERIFY_FAIL)\s*-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Web Push (VAPID) ---
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}
const pushSubscriptions = new Map(); // endpoint -> subscription

// --- Configuration ---
const PORT = process.env.TBC_PORT || 3100;
const SERVE_STATIC = process.env.TBC_SERVE_STATIC !== 'false';

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

function broadcastEvent(event) {
  const messages = {
    milestone: `📌 New milestone: ${event.title}`,
    verified: `✅ Milestone verified: ${event.title}`,
    'verify-fail': `❌ Verification failed: ${event.title}`,
    phase: `🔄 Phase → ${event.phase}`,
    error: `⚠️ ${event.message}`,
    'agent-done': `${event.success ? '✓' : '✗'} ${event.agent}: ${event.summary || 'no response'}`,
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
      const logPath = path.join(runner.agentDir, 'orchestrator.log');
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
    this.cycleCount = 0;
    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.isPaused = false;
    this.sleepUntil = null;
    this.wakeNow = false;
    this.running = false;
    this.lastComputedSleepMs = null; // Cached sleep interval
    this.currentSchedule = null;
    // Phase state machine: athena | implementation | verification
    this.phase = 'athena'; // Start by asking Athena for first milestone
    this.milestoneTitle = null;
    this.milestoneDescription = null;
    this.milestoneCyclesBudget = 0;
    this.milestoneCyclesUsed = 0;
    this.verificationFeedback = null;
    this.isFixRound = false; // true when returning from failed verification
    this.consecutiveFailures = 0; // Track consecutive agent failures for auto-pause
    this._repo = null;
  }

  get projectDir() {
    const repo = this.repo;
    if (repo) {
      return path.join(TBC_HOME, 'dev', 'src', 'github.com', ...repo.split('/'));
    }
    return path.join(TBC_HOME, 'local', this.id);
  }

  get agentDir() {
    return path.join(this.projectDir, 'workspace');
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
    const defaults = { cycleIntervalMs: 0, agentTimeoutMs: 3600000, model: 'claude-opus-4-6', budgetPer24h: 0 };
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
    const workersDir = path.join(this.agentDir, 'workers');
    
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
    const workersDir = path.join(this.agentDir, 'workers');
    const managersDir = path.join(ROOT, 'agent', 'managers');
    const workspaceDir = path.join(this.agentDir, 'workspace', agentName);
    
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
    
    let workspaceFiles = [];
    if (fs.existsSync(workspaceDir)) {
      workspaceFiles = fs.readdirSync(workspaceDir).map(f => {
        const filePath = path.join(workspaceDir, f);
        const stat = fs.statSync(filePath);
        return {
          name: f,
          size: stat.size,
          modified: stat.mtime,
          content: stat.size < 50000 ? fs.readFileSync(filePath, 'utf-8') : null
        };
      });
    }
    
    // Get last response from response log
    let lastResponse = null;
    let lastRawOutput = null;
    const responseLogPath = path.join(this.agentDir, 'responses', `${agentName}.log`);
    const rawLogPath = path.join(this.agentDir, 'responses', `${agentName}.raw.log`);
    
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
    const model = modelMatch ? modelMatch[1].trim() : null;
    
    // Read shared rules: everyone.md + role-specific (worker.md or manager.md)
    let everyone = null;
    let roleRules = null;
    try { everyone = fs.readFileSync(path.join(ROOT, 'agent', 'everyone.md'), 'utf-8'); } catch {}
    try { roleRules = fs.readFileSync(path.join(ROOT, 'agent', isManager ? 'manager.md' : 'worker.md'), 'utf-8'); } catch {}

    return { name: agentName, isManager, skill, workspaceFiles, lastResponse, lastRawOutput, model, everyone, roleRules };
  }

  getLogs(lines = 50) {
    const logPath = path.join(this.agentDir, 'orchestrator.log');
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).slice(-lines);
  }

  getCostSummary() {
    const csvPath = path.join(this.agentDir, 'cost.csv');
    if (!fs.existsSync(csvPath)) {
      return { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, lastCycleDuration: 0, avgCycleDuration: 0, agents: {} };
    }
    try {
      const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
      if (lines.length <= 1) return { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, lastCycleDuration: 0, avgCycleDuration: 0, agents: {} };

      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      let totalCost = 0;
      let last24hCost = 0;
      const agents = {};
      const cycleData = new Map(); // cycle -> { cost, duration }

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 4) continue;
        const time = new Date(parts[0]).getTime();
        const cycle = parseInt(parts[1]);
        const agentName = parts[2];
        const cost = parseFloat(parts[3]);
        const duration = parts.length >= 5 ? parseInt(parts[4]) : 0;
        if (isNaN(cost)) continue;

        totalCost += cost;
        
        // Track cycle costs and durations
        if (!isNaN(cycle)) {
          if (!cycleData.has(cycle)) {
            cycleData.set(cycle, { cost: 0, duration: 0 });
          }
          const data = cycleData.get(cycle);
          data.cost += cost;
          data.duration += duration; // Sum agent durations for cycle total
        }
        
        if (!agents[agentName]) {
          agents[agentName] = { totalCost: 0, last24hCost: 0, callCount: 0, lastCallCost: 0 };
        }
        agents[agentName].totalCost += cost;
        agents[agentName].callCount += 1;
        agents[agentName].lastCallCost = cost; // Overwrite with latest

        if (time >= cutoff) {
          last24hCost += cost;
          agents[agentName].last24hCost += cost;
        }
      }

      // Compute average cost per agent
      for (const name of Object.keys(agents)) {
        agents[name].avgCallCost = agents[name].callCount > 0 
          ? agents[name].totalCost / agents[name].callCount 
          : 0;
      }

      // Compute last/avg cycle cost and duration
      let lastCycleCost = 0;
      let avgCycleCost = 0;
      let lastCycleDuration = 0;
      let avgCycleDuration = 0;
      if (cycleData.size > 0) {
        const cycles = Array.from(cycleData.keys()).sort((a, b) => a - b);
        const lastData = cycleData.get(cycles[cycles.length - 1]);
        lastCycleCost = lastData?.cost || 0;
        lastCycleDuration = lastData?.duration || 0;
        
        let totalCycleCost = 0;
        let totalCycleDuration = 0;
        for (const data of cycleData.values()) {
          totalCycleCost += data.cost;
          totalCycleDuration += data.duration;
        }
        avgCycleCost = totalCycleCost / cycleData.size;
        avgCycleDuration = totalCycleDuration / cycleData.size;
      }

      return { totalCost, last24hCost, lastCycleCost, avgCycleCost, lastCycleDuration, avgCycleDuration, agents };
    } catch {
      return { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, lastCycleDuration: 0, avgCycleDuration: 0, agents: {} };
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

    // Parse cost.csv to get per-cycle data
    const csvPath = path.join(this.agentDir, 'cost.csv');
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cycleCosts = [];    // { cycle, totalCost, totalDuration }
    let spent24h = 0;
    let oldestTime24h = Infinity;

    if (fs.existsSync(csvPath)) {
      try {
        const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
        const cycleMap = new Map(); // cycle -> { cost, duration }

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length < 4) continue;
          const time = new Date(parts[0]).getTime();
          const cycle = parseInt(parts[1]);
          const cost = parseFloat(parts[3]);
          const duration = parts.length >= 5 ? parseInt(parts[4]) : 0;
          if (isNaN(cost)) continue;

          // Track 24h spending (raw cost always counts)
          if (time >= cutoff) {
            spent24h += cost;
            if (time < oldestTime24h) oldestTime24h = time;
          }

          // Group by cycle for EMA
          if (!cycleMap.has(cycle)) cycleMap.set(cycle, { cost: 0, duration: 0 });
          const entry = cycleMap.get(cycle);
          entry.cost += cost;
          entry.duration = Math.max(entry.duration, duration); // agents run sequentially, use max as proxy
        }

        // Sort cycles by number
        cycleCosts = Array.from(cycleMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => v);
      } catch {}
    }

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
      else if (model.includes('haiku')) perAgentCost = 0.20;
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

  getDb() {
    const dbPath = path.join(this.agentDir, 'project.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, role TEXT, reports_to TEXT, model TEXT, disabled INTEGER DEFAULT 0, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
      CREATE TABLE IF NOT EXISTS issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT DEFAULT '', status TEXT DEFAULT 'open', creator TEXT NOT NULL, assignee TEXT, labels TEXT DEFAULT '', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), closed_at TEXT);
      CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL REFERENCES issues(id), author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
      CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, cycles_budget INTEGER DEFAULT 20, cycles_used INTEGER DEFAULT 0, phase TEXT DEFAULT 'implementation', status TEXT DEFAULT 'active', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), completed_at TEXT);
    `);
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

  async getPRs() {
    if (!this.repo) return [];
    try {
      const output = execSync(
        'gh pr list --state open --json number,title,createdAt,headRefName --limit 50',
        { cwd: this.path, encoding: 'utf-8', timeout: 30000 }
      );
      return JSON.parse(output).map(pr => {
        const match = pr.title.match(/^\[([^\]]+)\]\s*(.*)$/);
        return match 
          ? { ...pr, agent: match[1], shortTitle: match[2] }
          : { ...pr, agent: null, shortTitle: pr.title };
      });
    } catch {
      return [];
    }
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
      running: this.running,
      paused: this.isPaused,
      pauseReason: this.pauseReason || null,
      cycleCount: this.cycleCount,
      currentAgent: this.currentAgent,
      currentAgentRuntime: this.currentAgentStartTime
        ? Math.floor((Date.now() - this.currentAgentStartTime) / 1000)
        : null,
      sleeping: this.sleepUntil !== null,
      sleepUntil: this.sleepUntil,
      schedule: this.currentSchedule || null,
      phase: this.phase,
      milestoneTitle: this.milestoneTitle,
      milestone: this.milestoneDescription,
      milestoneCyclesBudget: this.milestoneCyclesBudget,
      milestoneCyclesUsed: this.milestoneCyclesUsed,
      isFixRound: this.isFixRound,
      config: this.loadConfig(),
      agents: this.loadAgents(),
      cost: this.getCostSummary(),
      budget: this.getBudgetStatus()
    };
  }

  bootstrapPreview() {
    const workspaceExists = fs.existsSync(this.agentDir);
    let workspaceContents = [];
    if (workspaceExists) {
      workspaceContents = fs.readdirSync(this.agentDir);
    }
    return { available: true, workspaceEmpty: workspaceContents.length === 0, repo: this.repo };
  }

  bootstrap() {
    // 0. Kill any running agent and pause the project
    if (this.currentAgentProcess) {
      try { this.currentAgentProcess.kill('SIGKILL'); } catch {}
      log(`Killed running agent ${this.currentAgent} for bootstrap`, this.id);
      this.currentAgentProcess = null;
      this.currentAgent = null;
      this.currentAgentStartTime = null;
    }
    this.isPaused = true;
    this.pauseReason = 'Bootstrapping';
    this.completedAgents = [];
    this.currentCycleId = null;
    this.currentSchedule = null;

    // 1. Wipe the entire workspace folder
    if (fs.existsSync(this.agentDir)) {
      fs.rmSync(this.agentDir, { recursive: true });
      log(`Cleared workspace folder`, this.id);
    }
    fs.mkdirSync(this.agentDir, { recursive: true });

    // 2. Reset cycle count, phase, and save state
    this.cycleCount = 0;
    this.phase = 'athena';
    this.milestoneTitle = null;
    this.milestoneDescription = null;
    this.milestoneCyclesBudget = 0;
    this.milestoneCyclesUsed = 0;
    this.verificationFeedback = null;
    this.isFixRound = false;
    this.isPaused = true;
    this.pauseReason = 'Bootstrapped — resume when ready';
    this.saveState();
    log(`Reset cycle count, project paused`, this.id);

    return { bootstrapped: true };
  }

  async start() {
    if (this.running) return;
    // Validate project path exists
    if (!fs.existsSync(this.path)) {
      log(`ERROR: Project path does not exist: ${this.path}`, this.id);
      return;
    }

    // Ensure project workspace directories exist
    for (const sub of ['', 'responses', 'workers']) {
      fs.mkdirSync(path.join(this.agentDir, sub), { recursive: true });
    }
    
    // Load persisted state
    this.loadState();
    
    this.running = true;
    log(`Starting project runner (data: ${this.agentDir}, cycle: ${this.cycleCount})`, this.id);
    this.runLoop();
  }

  loadState() {
    const statePath = path.join(this.agentDir, 'state.json');
    try {
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        this.cycleCount = state.cycleCount || 0;
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
        this.verificationFeedback = state.verificationFeedback || null;
        this.isFixRound = state.isFixRound || false;
        log(`Loaded state: cycle ${this.cycleCount}, phase: ${this.phase}, completed: [${this.completedAgents.join(', ')}]${this.isPaused ? ', paused' : ''}`, this.id);
      } else {
        // New project — start paused
        this.isPaused = true;
        this.pauseReason = 'New project (paused by default)';
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
    const statePath = path.join(this.agentDir, 'state.json');
    try {
      const state = {
        cycleCount: this.cycleCount,
        completedAgents: this.completedAgents || [],
        currentCycleId: this.currentCycleId,
        currentSchedule: this.currentSchedule || null,
        isPaused: this.isPaused || false,
        phase: this.phase,
        milestoneTitle: this.milestoneTitle,
        milestoneDescription: this.milestoneDescription,
        milestoneCyclesBudget: this.milestoneCyclesBudget,
        milestoneCyclesUsed: this.milestoneCyclesUsed,
        verificationFeedback: this.verificationFeedback,
        isFixRound: this.isFixRound,
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
    this.isPaused = true;
    this.pauseReason = null;
    log(`Paused`, this.id);
    this.saveState();
  }

  resume() {
    this.isPaused = false;
    this.pauseReason = null;
    this.wakeNow = true;
    log(`Resumed`, this.id);
    this.saveState();
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
    while (slept < ms && !this.wakeNow && this.running) {
      await sleep(5000);
      slept += 5000;
      while (this.isPaused && !this.wakeNow && this.running) { await sleep(1000); }
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
    // Parse <!-- SCHEDULE --> ... <!-- /SCHEDULE --> from Ares's response
    const match = resultText.match(/<!--\s*SCHEDULE\s*-->\s*(\{[\s\S]*?\})\s*<!--\s*\/SCHEDULE\s*-->/);
    if (!match) return null;
    try {
      const schedule = JSON.parse(match[1]);
      return schedule;
    } catch (e) {
      log(`Failed to parse Ares schedule: ${e.message}`, this.id);
      return null;
    }
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
        this.isPaused = true;
        this.pauseReason = `Budget exhausted: $${budgetStatus.spent24h.toFixed(2)} / $${budgetStatus.budgetPer24h} (24h)`;
        // Re-check every 2 hours until budget rolls off or manually resumed
        await this._autoPauseWait(2 * 60 * 60 * 1000, () => !this.getBudgetStatus().exhausted);
        if (!this.running) break;
        continue;
      }

      const { managers, workers } = this.loadAgents();
      
      // Start new cycle
      this.cycleCount++;
      this.completedAgents = [];
      this.currentSchedule = null;
      this.saveState();
      log(`===== CYCLE ${this.cycleCount} (phase: ${this.phase}) =====`, this.id);

      let cycleFailures = 0;
      let cycleTotal = 0;

      // ===== PHASE: ATHENA (strategy) =====
      if (this.phase === 'athena') {
        const athena = managers.find(m => m.name === 'athena');
        if (athena) {
          // Build situation context for Athena
          let situation = '';
          if (!this.milestoneDescription) {
            situation = '> **Situation: Project Just Started**\n\n';
          } else if (this.verificationFeedback === '__passed__') {
            situation = '> **Situation: Milestone Verified Complete**\n> Previous milestone was verified by Apollo\'s team.\n\n';
          } else {
            situation = `> **Situation: Implementation Deadline Missed**\n> Ares's team used ${this.milestoneCyclesUsed}/${this.milestoneCyclesBudget} cycles without completing the milestone.\n\n`;
          }

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
                this.milestoneTitle = milestone.title || milestone.description.slice(0, 80);
                this.milestoneDescription = milestone.description;
                this.milestoneCyclesBudget = milestone.cycles || 20;
                this.milestoneCyclesUsed = 0;
                this.verificationFeedback = null;
                this.isFixRound = false;
                this.phase = 'implementation';
                log(`New milestone (${this.milestoneCyclesBudget} cycles): ${this.milestoneDescription.slice(0, 100)}...`, this.id);
                broadcastEvent({ type: 'milestone', project: this.id, title: this.milestoneTitle, cycles: this.milestoneCyclesBudget });
              } catch (e) {
                log(`Failed to parse milestone: ${e.message}`, this.id);
              }
            }
            // Check for STOP file
            if (fs.existsSync(path.join(this.agentDir, 'STOP'))) {
              log(`STOP file detected — pausing project`, this.id);
              this.isPaused = true;
              this.pauseReason = 'Project stopped by Athena';
              this.saveState();
              continue;
            }
          }

          // Delay after Athena if requested
          if (schedule && schedule.delay) {
            await this.sleepDelay(schedule.delay, 'athena');
          }

          // Run Athena's scheduled workers (research, evaluation, review)
          if (schedule && schedule.agents) {
            for (const [name, value] of Object.entries(schedule.agents)) {
              if (!this.running) break;
              const worker = workers.find(w => w.name.toLowerCase() === name.toLowerCase());
              if (!worker) continue;
              while (this.isPaused && this.running) { await sleep(1000); }
              const task = typeof value === 'string' ? value : value.task || null;
              const vis = this._parseVisibility(value, task);
              const wResult = await this.runAgent(worker, config, null, task, vis);
              cycleTotal++;
              if (!wResult || !wResult.success) cycleFailures++;
              // Per-agent delay
              const agentDelay = typeof value === 'object' ? value.delay : null;
              if (agentDelay) await this.sleepDelay(agentDelay, name);
            }
          }

          this.saveState();
        }
      }

      // ===== PHASE: IMPLEMENTATION (Ares + his workers) =====
      else if (this.phase === 'implementation') {
        // Check if deadline missed (before running)
        if (this.milestoneCyclesUsed >= this.milestoneCyclesBudget) {
          log(`⏰ Implementation deadline missed (${this.milestoneCyclesUsed}/${this.milestoneCyclesBudget} cycles)`, this.id);
          this.phase = 'athena';
          this.saveState();
          continue;
        }

        const ares = managers.find(m => m.name === 'ares');
        if (ares) {
          // Build context for Ares (remaining includes this cycle)
          const cyclesRemaining = this.milestoneCyclesBudget - this.milestoneCyclesUsed;
          let aresContext = `> **Milestone:** ${this.milestoneDescription}\n> **Cycles remaining:** ${cyclesRemaining} of ${this.milestoneCyclesBudget}\n\n`;
          if (this.isFixRound && this.verificationFeedback) {
            aresContext += `> **⚠️ Verification Failed — Fix Required:**\n> ${this.verificationFeedback}\n> You have ${this.milestoneCyclesBudget - this.milestoneCyclesUsed} cycles to fix and re-claim.\n\n`;
          }

          const result = await this.runAgent(ares, config, null, aresContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          // Parse schedule and check for CLAIM_COMPLETE
          let schedule = null;
          if (result && result.resultText) {
            schedule = this.parseSchedule(result.resultText);
            if (schedule) {
              log(`Schedule: ${JSON.stringify(schedule)}`, this.id);
              this.currentSchedule = schedule;
            }

            // Check if Ares claims milestone complete
            if (result.resultText.includes('<!-- CLAIM_COMPLETE -->')) {
              log(`🎯 Ares claims milestone complete — switching to verification`, this.id);
              this.phase = 'verification';
              broadcastEvent({ type: 'phase', project: this.id, phase: 'verification', title: this.milestoneTitle });
              this.saveState();
            }
          }

          // Delay after manager if requested
          if (schedule && schedule.delay) {
            await this.sleepDelay(schedule.delay, 'ares');
          }

          // Run Ares's scheduled workers
          if (schedule && schedule.agents) {
            for (const [name, value] of Object.entries(schedule.agents)) {
              if (!this.running) break;
              const worker = workers.find(w => w.name.toLowerCase() === name.toLowerCase());
              if (!worker) continue;
              while (this.isPaused && this.running) { await sleep(1000); }
              const task = typeof value === 'string' ? value : value.task || null;
              const vis = this._parseVisibility(value, task);
              const wResult = await this.runAgent(worker, config, null, task, vis);
              cycleTotal++;
              if (!wResult || !wResult.success) cycleFailures++;
              // Per-agent delay
              const agentDelay = typeof value === 'object' ? value.delay : null;
              if (agentDelay) await this.sleepDelay(agentDelay, name);
            }
          }
        }
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
        const apollo = managers.find(m => m.name === 'apollo');
        if (apollo) {
          const apolloContext = `> **Milestone to verify:** ${this.milestoneDescription}\n\n`;

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

          // Delay after manager if requested
          if (schedule && schedule.delay) {
            await this.sleepDelay(schedule.delay, 'apollo');
          }

          // Run Apollo's scheduled workers
          if (schedule && schedule.agents) {
            for (const [name, value] of Object.entries(schedule.agents)) {
              if (!this.running) break;
              const worker = workers.find(w => w.name.toLowerCase() === name.toLowerCase());
              if (!worker) continue;
              while (this.isPaused && this.running) { await sleep(1000); }
              const task = typeof value === 'string' ? value : value.task || null;
              const vis = this._parseVisibility(value, task);
              const wResult = await this.runAgent(worker, config, null, task, vis);
              cycleTotal++;
              if (!wResult || !wResult.success) cycleFailures++;
              // Per-agent delay
              const agentDelay = typeof value === 'object' ? value.delay : null;
              if (agentDelay) await this.sleepDelay(agentDelay, name);
            }
          }

          // Process decision
          if (decision === 'pass') {
            log(`✅ Milestone verified — waking Athena for next milestone`, this.id);
            broadcastEvent({ type: 'verified', project: this.id, title: this.milestoneTitle });
            this.milestoneTitle = null;
            this.milestoneDescription = null;
            this.milestoneCyclesBudget = 0;
            this.milestoneCyclesUsed = 0;
            this.verificationFeedback = null;
            this.isFixRound = false;
            this.phase = 'athena';
          } else if (decision === 'fail') {
            log(`❌ Verification failed — returning to Ares (${Math.floor(this.milestoneCyclesBudget / 2)} fix cycles)`, this.id);
            broadcastEvent({ type: 'verify-fail', project: this.id, title: this.milestoneTitle });
            const fixBudget = Math.floor(this.milestoneCyclesBudget / 2);
            this.milestoneCyclesBudget = this.milestoneCyclesUsed + fixBudget;
            this.isFixRound = true;
            this.phase = 'implementation';
          }
          // If no decision yet, stay in verification phase (Apollo gets more cycles)
          this.saveState();
        }
      }

      // Track consecutive agent failures — auto-pause after 10
      this.consecutiveFailures = (cycleTotal > 0 && cycleFailures === cycleTotal)
        ? this.consecutiveFailures + cycleFailures
        : 0;
      if (this.consecutiveFailures >= 10 && this.running) {
        log(`⚠️ ${this.consecutiveFailures} consecutive agent failures — auto-pausing (retry in 2h)`, this.id);
        broadcastEvent({ type: 'error', project: this.id, message: `${this.consecutiveFailures} consecutive failures — auto-paused` });
        this.isPaused = true;
        this.pauseReason = `${this.consecutiveFailures} consecutive agent failures`;
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

  async runAgent(agent, config, mode = null, task = null, visibility = null) {
    this.currentAgent = agent.name;
    this.currentAgentStartTime = Date.now();
    const modeStr = mode ? ` [${mode}]` : '';
    log(`Running: ${agent.name}${agent.isManager ? ' (manager)' : ''}${modeStr}`, this.id);

    // Managers come from the TBC repo, workers from the project workspace
    const skillPath = agent.isManager
      ? path.join(ROOT, 'agent', 'managers', `${agent.name}.md`)
      : path.join(this.agentDir, 'workers', `${agent.name}.md`);

    // Ensure workspace directory exists for this agent
    const workspaceDir = path.join(this.agentDir, 'workspace', agent.name);
    fs.mkdirSync(workspaceDir, { recursive: true });

    return new Promise((resolve) => {
      // Build prompt: mode header + everyone.md + skill file, with {project_dir} replaced
      if (!fs.existsSync(skillPath)) {
        log(`Skill file not found: ${skillPath}, skipping ${agent.name}`, this.id);
        return resolve({ code: 1, stdout: '', stderr: `Skill file not found: ${skillPath}`, tokens: { in: 0, out: 0, cache_read: 0 } });
      }
      let skillContent = fs.readFileSync(skillPath, 'utf-8');
      
      // Build shared rules: everyone.md + db.md + role-specific rules (worker.md or manager.md)
      let sharedRules = '';
      try {
        const everyonePath = path.join(ROOT, 'agent', 'everyone.md');
        sharedRules = fs.readFileSync(everyonePath, 'utf-8') + '\n\n---\n\n';
        const visMode = visibility?.mode || 'full';
        if (visMode !== 'blind') {
          const dbPath = path.join(ROOT, 'agent', 'db.md');
          try {
            let dbContent = fs.readFileSync(dbPath, 'utf-8');
            if (visMode === 'focused') {
              dbContent += `\n\n> **Visibility: Focused** — You can only access issues: ${visibility?.issues?.join(', ') || 'none specified'}. Other issues are restricted.\n`;
            }
            sharedRules += dbContent + '\n\n---\n\n';
          } catch {}
        } else {
          sharedRules += '\n> **You are in blind mode.** You cannot access the issue tracker (tbc-db). Focus only on the task described above and the repository code.\n\n---\n\n';
        }
        const rolePath = path.join(ROOT, 'agent', agent.isManager ? 'manager.md' : 'worker.md');
        sharedRules += fs.readFileSync(rolePath, 'utf-8') + '\n\n---\n\n';
      } catch {}
      
      // Inject task assignment at the top
      let taskHeader = '';
      if (task) {
        taskHeader = `> **Your assignment: ${task}**\n\n`;
      }
      
      
      // Strip YAML frontmatter (---...---) from skill content before building prompt
      // This prevents Claude CLI from interpreting '---' as a command-line flag
      skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
      
      skillContent = (taskHeader + sharedRules + skillContent).replaceAll('{project_dir}', this.agentDir);

      const agentModel = agent.rawModel || config.model || 'claude-opus-4-6';
      const args = [
        '-p', skillContent,
        '--model', agentModel,
        '--dangerously-skip-permissions',
        '--output-format', 'json'
      ];

      // Resolve setup token: project-specific > global > none
      const projectToken = config.setupToken;
      const globalToken = process.env.ANTHROPIC_AUTH_TOKEN;
      const resolvedToken = projectToken || globalToken || null;

      if (!resolvedToken) {
        log(`No setup token configured for ${agent.name} — using default auth.`, this.id);
      }

      const agentEnv = {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        TBC_DB: path.join(this.agentDir, 'project.db'),
        TBC_VISIBILITY: visibility?.mode || 'full',
        TBC_FOCUSED_ISSUES: visibility?.issues?.join(',') || '',
      };
      // Always explicitly set or remove ANTHROPIC_AUTH_TOKEN to avoid
      // dotenv pollution from process.env leaking into agent spawns
      if (resolvedToken) {
        agentEnv.ANTHROPIC_AUTH_TOKEN = resolvedToken;
      } else {
        delete agentEnv.ANTHROPIC_AUTH_TOKEN;
      }

      this.currentAgentProcess = spawn('claude', args, {
        cwd: this.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: agentEnv,
      });

      let stdout = '';
      this.currentAgentProcess.stdout.on('data', (d) => stdout += d);
      this.currentAgentProcess.stderr.on('data', (d) => stdout += d);

      let killedByTimeout = false;
      // Poll-based timeout: reload config every 60s to pick up changes
      const timeoutInterval = setInterval(() => {
        const freshConfig = this.loadConfig();
        if (freshConfig.agentTimeoutMs > 0) {
          const elapsed = Date.now() - this.currentAgentStartTime;
          if (elapsed >= freshConfig.agentTimeoutMs) {
            log(`⏰ Timeout (${Math.floor(elapsed / 60000)}m elapsed, limit ${Math.floor(freshConfig.agentTimeoutMs / 60000)}m), killing ${agent.name}`, this.id);
            killedByTimeout = true;
            this.currentAgentProcess.kill('SIGTERM');
            // Escalate to SIGKILL after 30s if still alive
            setTimeout(() => {
              try { this.currentAgentProcess?.kill('SIGKILL'); } catch {}
            }, 30000);
            clearInterval(timeoutInterval);
          }
        }
      }, 60000);

      this.currentAgentProcess.on('close', (code) => {
        clearInterval(timeoutInterval);
        
        const durationMs = Date.now() - this.currentAgentStartTime;
        const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
        
        let tokenInfo = '';
        let cost;
        let resultText = '';
        try {
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.startsWith('{')) {
              const data = JSON.parse(line);
              if (data.type === 'result') {
                if (data.usage) {
                  const u = data.usage;
                  // Model-aware pricing (per million tokens)
                  let inputRate = 15, outputRate = 75, cacheRate = 1.5; // opus default
                  if (agentModel.includes('sonnet')) { inputRate = 3; outputRate = 15; cacheRate = 0.3; }
                  else if (agentModel.includes('haiku')) { inputRate = 0.80; outputRate = 4; cacheRate = 0.08; }
                  cost = ((u.input_tokens * inputRate) + (u.output_tokens * outputRate) + (u.cache_read_input_tokens * cacheRate)) / 1_000_000;
                  tokenInfo = ` | tokens: in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens} | cost: $${cost.toFixed(4)}`;
                }
                if (data.result) {
                  resultText = data.result;
                }
              }
            }
          }
        } catch {}
        
        // Log CLI response to agent-specific log file
        try {
          const responsesDir = path.join(this.agentDir, 'responses');
          fs.mkdirSync(responsesDir, { recursive: true });
          const timestamp = new Date().toLocaleString('sv-SE', { hour12: false }).replace(',', '');
          const header = `\n${'='.repeat(60)}\n[${timestamp}] Cycle ${this.cycleCount} | Exit code: ${code}\n${'='.repeat(60)}\n`;
          
          // Always log raw output for debugging
          const rawLogPath = path.join(responsesDir, `${agent.name}.raw.log`);
          fs.appendFileSync(rawLogPath, header + stdout + '\n');
          
          // Log parsed result if available
          if (resultText) {
            const agentLogPath = path.join(responsesDir, `${agent.name}.log`);
            fs.appendFileSync(agentLogPath, header + resultText + '\n');
          }
        } catch (e) {
          log(`Failed to log response for ${agent.name}: ${e.message}`, this.id);
        }

        // Append cost row to cost.csv
        if (cost !== undefined) {
          try {
            const csvPath = path.join(this.agentDir, 'cost.csv');
            if (!fs.existsSync(csvPath)) {
              fs.writeFileSync(csvPath, 'time,cycle,agent,cost,durationMs\n');
            }
            fs.appendFileSync(csvPath, `${new Date().toISOString()},${this.cycleCount},${agent.name},${cost.toFixed(6)},${durationMs}\n`);
          } catch {}
        }

        // Write agent report to SQLite
        if (resultText || killedByTimeout || code !== 0) {
          try {
            let reportBody;
            if (killedByTimeout || code !== 0) {
              const errorType = killedByTimeout ? '⏰ Timeout' : '❌ Error';
              const errorMsg = killedByTimeout
                ? `Killed after exceeding the ${Math.floor(config.agentTimeoutMs / 60000)}m timeout limit.`
                : `Exited with code ${code}.`;
              // Capture partial work on timeout — check for uncommitted changes
              let partialWork = '';
              if (killedByTimeout) {
                try {
                  const repoDir = path.join(this.agentDir, 'repo');
                  if (fs.existsSync(path.join(repoDir, '.git'))) {
                    const diffStat = execSync('git diff --stat HEAD 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim();
                    const stagedStat = execSync('git diff --stat --cached HEAD 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim();
                    if (diffStat || stagedStat) {
                      partialWork = `\n\n### Partial Work Detected\n\nUncommitted changes found in repo:\n\`\`\`\n${(stagedStat ? 'Staged:\n' + stagedStat + '\n' : '')}${(diffStat ? 'Unstaged:\n' + diffStat : '')}\n\`\`\``;
                    }
                  }
                } catch {}
              }
              reportBody = `## ${errorType}\n\n${errorMsg}\n\n- Duration: ${durationStr}\n- Exit code: ${code}${partialWork}`;
            } else {
              reportBody = resultText.trim();
            }
            // Prepend time log to all reports
            const startTime = new Date(this.currentAgentStartTime).toLocaleString('sv-SE');
            const endTime = new Date().toLocaleString('sv-SE');
            reportBody = `> ⏱ Started: ${startTime} | Ended: ${endTime} | Duration: ${durationStr}\n\n${reportBody}`;
            const db = this.getDb();
            db.exec(`CREATE TABLE IF NOT EXISTS reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cycle INTEGER NOT NULL,
              agent TEXT NOT NULL,
              body TEXT NOT NULL,
              created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )`);
            db.prepare('INSERT INTO reports (cycle, agent, body, created_at) VALUES (?, ?, ?, ?)').run(this.cycleCount, agent.name, reportBody, new Date().toISOString());
            db.close();
            log(`Saved report for ${agent.name}`, this.id);
          } catch (dbErr) {
            log(`Failed to write report: ${dbErr.message}`, this.id);
          }
        }

        log(`${agent.name} done (code ${code})${tokenInfo}`, this.id);
        const summary = resultText ? stripMetaBlocks(resultText).slice(0, 500).replace(/\n+/g, ' ').trim() : '';
        broadcastEvent({ type: 'agent-done', project: this.id, agent: agent.name, success: code === 0 && !killedByTimeout, summary });
        this.currentAgent = null;
        this.currentAgentProcess = null;
        this.currentAgentStartTime = null;
        resolve({ success: code === 0 && !killedByTimeout, resultText });
      });
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
    const token = process.env.ANTHROPIC_AUTH_TOKEN;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasGlobalToken: !!token,
      globalTokenPreview: token ? maskToken(token) : null,
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/token') {
    if (!requireWrite(req, res)) return;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        const envPath = path.join(TBC_HOME, '.env');
        let envContent = '';
        try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch {}
        // Replace or add ANTHROPIC_AUTH_TOKEN
        if (/^ANTHROPIC_AUTH_TOKEN=.*/m.test(envContent)) {
          envContent = token
            ? envContent.replace(/^ANTHROPIC_AUTH_TOKEN=.*/m, `ANTHROPIC_AUTH_TOKEN=${token}`)
            : envContent.replace(/^ANTHROPIC_AUTH_TOKEN=.*\n?/m, '');
        } else if (token) {
          envContent = envContent.trimEnd() + `\nANTHROPIC_AUTH_TOKEN=${token}\n`;
        }
        fs.writeFileSync(envPath, envContent);
        // Update in-memory
        if (token) {
          process.env.ANTHROPIC_AUTH_TOKEN = token;
        } else {
          delete process.env.ANTHROPIC_AUTH_TOKEN;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, hasGlobalToken: !!token }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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

        const specPath = path.join(parsed.repoDir, 'spec.md');
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

        // Write spec.md if spec data provided
        if (spec && (spec.whatToBuild || spec.successCriteria)) {
          const specPath = path.join(resolvedPath, 'spec.md');
          const specContent = `# Project Specification\n\n## What do you want to build?\n\n${spec.whatToBuild || ''}\n\n## How do you consider the project is success?\n\n${spec.successCriteria || ''}\n`;
          fs.writeFileSync(specPath, specContent);
          try {
            execSync('git add spec.md && git commit -m "[TBC] Add project specification" && git push', {
              cwd: resolvedPath, encoding: 'utf-8', stdio: 'pipe'
            });
          } catch {} // Best effort
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
  if (req.method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2]) {
    // Support both single-segment (m2sim) and two-segment (sarchlab/m2sim) IDs
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
          const workersDir = path.join(runner.agentDir, 'workers');
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ config: safeConfig, raw, hasProjectToken, projectTokenPreview: projectToken ? maskToken(projectToken) : null }));
      return;
    }

    // POST /api/projects/:id/token — set per-project setup token
    if (req.method === 'POST' && subPath === 'token') {
      if (!requireWrite(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { token } = JSON.parse(body);
          const config = runner.loadConfig();
          if (token) {
            config.setupToken = token;
          } else {
            delete config.setupToken;
          }
          // Write back preserving existing config structure
          const configPath = runner.configPath;
          const existing = fs.existsSync(configPath) ? yaml.load(fs.readFileSync(configPath, 'utf-8')) || {} : {};
          if (token) {
            existing.setupToken = token;
          } else {
            delete existing.setupToken;
          }
          fs.writeFileSync(configPath, yaml.dump(existing));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, hasProjectToken: !!token }));
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
      const prs = await runner.getPRs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prs }));
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reports, total, page, perPage }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reports: [], total: 0, page: 1, perPage: 20 }));
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
      try {
        const issueId = parseInt(commentPostMatch[1], 10);
        const body = await readBody(req);
        const { author, body: commentBody } = JSON.parse(body);
        if (!commentBody?.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Comment body required' }));
          return;
        }
        const db = runner.getDb();
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(issueId, author || 'user', commentBody.trim(), now);
        db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
        db.close();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: result.lastInsertRowid }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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
          // Support both new format (title/body/creator) and legacy (text)
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
      try {
        fs.mkdirSync(runner.agentDir, { recursive: true });
        const result = runner.bootstrap();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/projects/:id/:action (pause, resume, skip, start, stop)
    if (req.method === 'POST' && ['pause', 'resume', 'skip', 'start', 'stop'].includes(subPath)) {
      if (!requireWrite(req, res)) return;
      switch (subPath) {
        case 'pause': runner.pause(); break;
        case 'resume': runner.resume(); break;
        case 'skip': runner.skip(); break;
        case 'start': runner.start(); break;
        case 'stop': runner.stop(); break;
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
