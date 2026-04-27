import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import Database from 'better-sqlite3';
import { runAgentWithAPI } from '../agent-runner.js';
import { resolveModel, callModel, buildUserMessage } from '../providers/index.js';
import { resolveKeyForProject, markRateLimited, markKeySucceeded } from '../key-pool.js';

export function createProjectRunnerClass(deps) {
  const {
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
  } = deps;

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


  return ProjectRunner;
}
