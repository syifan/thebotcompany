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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TBC_HOME = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');
const MONITOR_DIST = path.join(ROOT, 'monitor', 'dist');

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
const startTime = Date.now();

// --- Logging ---
function log(msg, projectId = null) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
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
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      return yaml.load(raw) || {};
    } catch (e) {
      return { cycleIntervalMs: 1800000, agentTimeoutMs: 900000, model: 'claude-sonnet-4-20250514', budgetPer24h: 0 };
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
      // Match "# Name (Role)" anywhere in content (after frontmatter)
      const match = content.match(/^#\s*\w+\s*\(([^)]+)\)/m);
      return match ? match[1] : null;
    };
    
    const parseModel = (content) => {
      // Match "model: xxx" in YAML frontmatter
      const match = content.match(/^model:\s*(.+)$/m);
      if (!match) return null;
      const model = match[1].trim();
      // Shorten common model names, keep version
      // e.g., "claude-opus-4-6" -> "opus 4.6", "claude-sonnet-4-20250514" -> "sonnet 4"
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
    
    if (fs.existsSync(managersDir)) {
      for (const file of fs.readdirSync(managersDir)) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
          managers.push({ name, role: parseRole(content), model: parseModel(content), isManager: true });
        }
      }
    }
    
    if (fs.existsSync(workersDir)) {
      for (const file of fs.readdirSync(workersDir)) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
          workers.push({ name, role: parseRole(content), model: parseModel(content), isManager: false });
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
    
    return { name: agentName, isManager, skill, workspaceFiles, lastResponse, lastRawOutput };
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
      return { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, agents: {} };
    }
    try {
      const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
      if (lines.length <= 1) return { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, agents: {} };

      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      let totalCost = 0;
      let last24hCost = 0;
      const agents = {};
      const cycleCosts = new Map(); // cycle -> total cost

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 4) continue;
        const time = new Date(parts[0]).getTime();
        const cycle = parseInt(parts[1]);
        const agentName = parts[2];
        const cost = parseFloat(parts[3]);
        if (isNaN(cost)) continue;

        totalCost += cost;
        
        // Track cycle costs
        if (!isNaN(cycle)) {
          cycleCosts.set(cycle, (cycleCosts.get(cycle) || 0) + cost);
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

      // Compute last cycle cost and average cycle cost
      let lastCycleCost = 0;
      let avgCycleCost = 0;
      if (cycleCosts.size > 0) {
        const cycles = Array.from(cycleCosts.keys()).sort((a, b) => a - b);
        lastCycleCost = cycleCosts.get(cycles[cycles.length - 1]) || 0;
        const totalCycleCost = Array.from(cycleCosts.values()).reduce((a, b) => a + b, 0);
        avgCycleCost = totalCycleCost / cycleCosts.size;
      }

      return { totalCost, last24hCost, lastCycleCost, avgCycleCost, agents };
    } catch {
      return { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, agents: {} };
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

  async getComments(author, page = 1, perPage = 20) {
    const config = this.loadConfig();
    const issueNumber = config.trackerIssue || 1;
    if (!this.repo) return { comments: [], total: 0 };
    
    try {
      const output = execSync(
        `gh api repos/${this.repo}/issues/${issueNumber}/comments --paginate -q '.[] | {id, author: .user.login, body, created_at, updated_at}'`,
        { cwd: this.path, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
      
      let comments = output.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
          const comment = JSON.parse(line);
          const agentMatch = comment.body.match(/^#{1,2}\s*\[([^\]]+)\]\s*\n*/);
          if (agentMatch) {
            comment.agent = agentMatch[1];
            comment.body = comment.body.slice(agentMatch[0].length).trim();
          } else {
            comment.agent = comment.author;
          }
          return comment;
        })
        .reverse();
      
      if (author) {
        comments = comments.filter(c => c.agent.toLowerCase() === author.toLowerCase());
      }
      
      const startIdx = (page - 1) * perPage;
      return {
        comments: comments.slice(startIdx, startIdx + perPage),
        total: comments.length,
        page,
        perPage,
        hasMore: startIdx + perPage < comments.length
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
    if (!this.repo) return [];
    try {
      const output = execSync(
        'gh issue list --state open --json number,title,createdAt,labels --limit 50',
        { cwd: this.path, encoding: 'utf-8', timeout: 30000 }
      );
      return JSON.parse(output).map(issue => {
        // Match [creator] -> [assignee] title
        const fullMatch = issue.title.match(/^\[([^\]]+)\]\s*->\s*\[([^\]]+)\]\s*(.*)$/);
        if (fullMatch) {
          return { ...issue, creator: fullMatch[1], assignee: fullMatch[2], shortTitle: fullMatch[3] };
        }
        // Match [creator] title (no assignee)
        const creatorMatch = issue.title.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (creatorMatch) {
          return { ...issue, creator: creatorMatch[1], assignee: null, shortTitle: creatorMatch[2] };
        }
        return { ...issue, creator: null, assignee: null, shortTitle: issue.title };
      });
    } catch {
      return [];
    }
  }

  async createIssue(text) {
    if (!this.repo) throw new Error('No repo configured');
    if (!text?.trim()) throw new Error('Missing issue description');
    
    const config = this.loadConfig();
    const model = config.model || 'claude-sonnet-4-20250514';
    
    const prompt = `You are helping create a GitHub issue. The user provided this description:

"${text}"

SAFETY: First verify you are in the correct repo (${this.repo}) by checking the remote URL. If not, abort.

Create a well-formatted GitHub issue with:
1. Title format: [Human] -> [Assignee] Description
   - If the user mentions a specific agent to assign, use that agent name
   - If no assignee is clear from the description, assign to Athena
2. A detailed description with context in the body

Use the gh CLI to create the issue. Run:
gh issue create --title "[Human] -> [Assignee] ..." --body "..."

The body should be markdown formatted. Add a "human-request" label.
Do not ask questions, just create the issue based on the description provided.`;

    execSync(`claude --model ${model} --dangerously-skip-permissions --print "${prompt.replace(/"/g, '\\"')}"`, {
      cwd: this.path,
      encoding: 'utf-8',
      timeout: 120000
    });
    
    return { success: true };
  }

  getStatus() {
    return {
      id: this.id,
      path: this.path,
      repo: this.repo,
      enabled: this.enabled,
      running: this.running,
      paused: this.isPaused,
      cycleCount: this.cycleCount,
      currentAgent: this.currentAgent,
      currentAgentRuntime: this.currentAgentStartTime
        ? Math.floor((Date.now() - this.currentAgentStartTime) / 1000)
        : null,
      sleeping: this.sleepUntil !== null,
      sleepUntil: this.sleepUntil,
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
    // 1. Wipe the entire workspace folder
    if (fs.existsSync(this.agentDir)) {
      fs.rmSync(this.agentDir, { recursive: true });
      log(`Cleared workspace folder`, this.id);
    }
    fs.mkdirSync(this.agentDir, { recursive: true });

    // 2. Create a new tracker issue on GitHub and update config
    let trackerIssue = null;
    if (this.repo) {
      try {
        const issueBody = `# Agent Tracker\n\n## 📋 Task Queues\n\n(No tasks yet)\n\n## 📊 Status\n- **Action count:** 0\n- **Last cycle:** N/A\n`;
        const output = execSync(
          `gh issue create --title "Agent Tracker" --body ${JSON.stringify(issueBody)}`,
          { cwd: this.path, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }
        );
        const match = output.match(/\/issues\/(\d+)/);
        if (match) {
          trackerIssue = parseInt(match[1]);
          const config = this.loadConfig();
          config.trackerIssue = trackerIssue;
          fs.writeFileSync(this.configPath, yaml.dump(config, { lineWidth: -1 }));
          log(`Created tracker issue #${trackerIssue}`, this.id);
        }
      } catch (e) {
        log(`Failed to create tracker issue: ${e.message}`, this.id);
      }
    }

    // 3. Reset cycle count
    this.cycleCount = 0;
    log(`Reset cycle count`, this.id);

    return { bootstrapped: true, trackerIssue };
  }

  async start() {
    if (this.running) return;
    // Ensure project directory exists in TBC_HOME
    fs.mkdirSync(this.agentDir, { recursive: true });
    
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
        log(`Loaded state: cycle ${this.cycleCount}, completed: [${this.completedAgents.join(', ')}]`, this.id);
      } else {
        this.completedAgents = [];
        this.currentCycleId = null;
      }
    } catch (e) {
      log(`Failed to load state: ${e.message}`, this.id);
      this.completedAgents = [];
      this.currentCycleId = null;
    }
  }

  saveState() {
    const statePath = path.join(this.agentDir, 'state.json');
    try {
      const state = {
        cycleCount: this.cycleCount,
        completedAgents: this.completedAgents || [],
        currentCycleId: this.currentCycleId,
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
    log(`Paused`, this.id);
  }

  resume() {
    this.isPaused = false;
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

  async runLoop() {
    while (this.running) {
      while (this.isPaused && this.running) {
        await sleep(1000);
      }
      if (!this.running) break;

      const config = this.loadConfig();
      const { managers, workers } = this.loadAgents();
      const allAgents = [...managers, ...workers];

      // Generate a cycle ID based on agent list to detect if agents changed
      const cycleId = allAgents.map(a => a.name).sort().join(',');
      
      // Check if we're resuming an interrupted cycle or starting fresh
      const isResume = this.currentCycleId === cycleId && this.completedAgents.length > 0;
      
      if (!isResume) {
        // Starting a new cycle
        this.cycleCount++;
        this.completedAgents = [];
        this.currentCycleId = cycleId;
        this.saveState();
        log(`===== CYCLE ${this.cycleCount} (${workers.length} workers) =====`, this.id);
      } else {
        log(`===== RESUMING CYCLE ${this.cycleCount} (completed: ${this.completedAgents.length}/${allAgents.length}) =====`, this.id);
      }

      for (const agent of allAgents) {
        if (!this.running) break;
        
        // Skip agents that already completed in this cycle
        if (this.completedAgents.includes(agent.name)) {
          log(`Skipping ${agent.name} (already completed)`, this.id);
          continue;
        }
        
        while (this.isPaused && this.running) {
          await sleep(1000);
        }
        await this.runAgent(agent, config);
        
        // Mark agent as completed and save state
        if (this.running) {
          this.completedAgents.push(agent.name);
          this.saveState();
        }
      }

      // Cycle complete - clear completed agents for next cycle
      this.completedAgents = [];
      this.currentCycleId = null;
      this.saveState();

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

  async runAgent(agent, config) {
    this.currentAgent = agent.name;
    this.currentAgentStartTime = Date.now();
    log(`Running: ${agent.name}${agent.isManager ? ' (manager)' : ''}`, this.id);

    // Managers come from the TBC repo, workers from the project workspace
    const skillPath = agent.isManager
      ? path.join(ROOT, 'agent', 'managers', `${agent.name}.md`)
      : path.join(this.agentDir, 'workers', `${agent.name}.md`);

    // Ensure workspace directory exists for this agent
    const workspaceDir = path.join(this.agentDir, 'workspace', agent.name);
    fs.mkdirSync(workspaceDir, { recursive: true });

    return new Promise((resolve) => {
      // Build prompt: everyone.md + skill file, with {project_dir} replaced
      let skillContent = fs.readFileSync(skillPath, 'utf-8');
      const everyonePath = path.join(ROOT, 'agent', 'everyone.md');
      let everyone = '';
      try { everyone = fs.readFileSync(everyonePath, 'utf-8') + '\n\n---\n\n'; } catch {}
      skillContent = (everyone + skillContent).replaceAll('{project_dir}', this.agentDir);

      const args = [
        '-p', skillContent,
        '--model', config.model || 'claude-sonnet-4-20250514',
        '--dangerously-skip-permissions',
        '--output-format', 'json'
      ];

      this.currentAgentProcess = spawn('claude', args, {
        cwd: this.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }
      });

      let stdout = '';
      this.currentAgentProcess.stdout.on('data', (d) => stdout += d);
      this.currentAgentProcess.stderr.on('data', (d) => stdout += d);

      const timeout = config.agentTimeoutMs > 0 
        ? setTimeout(() => {
            log(`⏰ Timeout, killing ${agent.name}`, this.id);
            this.currentAgentProcess.kill('SIGTERM');
          }, config.agentTimeoutMs)
        : null;

      this.currentAgentProcess.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        
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
                  cost = ((u.input_tokens * 15) + (u.output_tokens * 75) + (u.cache_read_input_tokens * 1.5)) / 1_000_000;
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
          const timestamp = new Date().toISOString();
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
            const durationMs = Date.now() - this.currentAgentStartTime;
            fs.appendFileSync(csvPath, `${new Date().toISOString()},${this.cycleCount},${agent.name},${cost.toFixed(6)},${durationMs}\n`);
          } catch {}
        }

        log(`${agent.name} done (code ${code})${tokenInfo}`, this.id);
        this.currentAgent = null;
        this.currentAgentProcess = null;
        this.currentAgentStartTime = null;
        resolve();
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

// --- HTTP API ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
    syncProjects();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projectCount: projects.size }));
    return;
  }

  // POST /api/projects/clone - Clone a GitHub repo and check for spec.md
  if (req.method === 'POST' && url.pathname === '/api/projects/clone') {
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
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id, path: projectPath, spec } = JSON.parse(body);
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
        const config = yaml.load(raw) || {};
        if (!config.projects) config.projects = {};

        config.projects[id] = { path: resolvedPath, enabled: true };

        fs.writeFileSync(projectsPath, yaml.dump(config, { lineWidth: -1 }));
        syncProjects();

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

    // GET /api/projects/:id/config
    if (req.method === 'GET' && subPath === 'config') {
      const raw = fs.existsSync(runner.configPath) ? fs.readFileSync(runner.configPath, 'utf-8') : '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ config: runner.loadConfig(), raw }));
      return;
    }

    // POST /api/projects/:id/config
    if (req.method === 'POST' && subPath === 'config') {
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

    // GET /api/projects/:id/issues
    if (req.method === 'GET' && subPath === 'issues') {
      const issues = await runner.getIssues();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issues }));
      return;
    }

    // POST /api/projects/:id/issues/create
    if (req.method === 'POST' && subPath === 'issues/create') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { text } = JSON.parse(body);
          await runner.createIssue(text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
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

// --- Main ---
log('TheBotCompany starting...');
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
