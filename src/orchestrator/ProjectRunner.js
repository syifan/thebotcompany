import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import { runAgentWithAPI } from '../agent-runner.js';
import { resolveModel, callModel, buildUserMessage } from '../providers/index.js';
import { resolveKeyForProject, markRateLimited, markKeySucceeded } from '../key-pool.js';
import { getAgentDetailsForRunner, loadAgentsForRunner } from './agent-loading.js';
import { decideProjectEpochPr, getOpenEpochPrForBranch, getProjectComments, getProjectCostSummary, getProjectPr, getProjectPrs, openProjectDb, writeRunnerReport } from './project-db.js';
import { allocateNextEpochId, allocateNextMilestoneId, ensureEpochPRForCurrentMilestone, getMilestoneRecord, getParentMilestoneId, makeMilestoneBranchPrefix, markCurrentMilestoneCompleted, markCurrentMilestoneFailed, normalizeResetTargetMilestone, slugifyMilestoneTitle, upsertMilestoneRecord } from './milestones.js';
import { buildAgentPrompt, getAgentFilesystemPolicy } from './agent-prompt.js';
import { killRunnerCycle, killRunnerEpoch, killRunnerRun, loadRunnerState, pauseRunner, resumeRunner, saveRunnerState, skipRunner, startRunner, stopRunner } from './state-control.js';
import { autoPauseWait, executeSchedule, parseSchedule, parseVisibility, sleepDelay } from './scheduler.js';
import { runRunnerLoop } from './phase-machine.js';

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
    return loadAgentsForRunner(this, { root: ROOT });
  }

  getAgentDetails(agentName) {
    return getAgentDetailsForRunner(this, agentName, { root: ROOT });
  }

  getLogs(lines = 50) {
    const logPath = this.orchestratorLogPath;
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).slice(-lines);
  }

  getCostSummary() {
    return getProjectCostSummary(this);
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

  _resolveAllowedIssueClosers(db, issueCreator) {
    if (issueCreator === 'human' || issueCreator === 'chat') {
      return { allowed: new Set(['human', 'chat']), special: 'chat-human' };
    }
    return { allowed: new Set([issueCreator, 'athena']), special: 'agent-athena' };
  }

  getDb() {
    return openProjectDb(this, { root: ROOT });
  }

  async getComments(author, page = 1, perPage = 20) {
    return getProjectComments(this, author, page, perPage);
  }

  async getPRs(status = 'open') {
    return getProjectPrs(this, status);
  }

  async getPR(prId) {
    return getProjectPr(this, prId);
  }

  async getOpenEpochPRForCurrentMilestone() {
    return getOpenEpochPrForBranch(this, this.currentMilestoneBranch || '');
  }

  async decideEpochPR(status, { actor = 'apollo', reason = '' } = {}) {
    const pr = await this.getOpenEpochPRForCurrentMilestone();
    return decideProjectEpochPr(this, pr, status, { actor, reason });
  }

  closeOpenEpochPRForBranch(branchName, { actor = 'apollo', reason = '' } = {}) {
    const pr = getOpenEpochPrForBranch(this, branchName);
    return decideProjectEpochPr(this, pr, 'closed', { actor, reason });
  }

  normalizeResetTargetMilestone(resetTo) {
    return normalizeResetTargetMilestone.call(this, resetTo);
  }

  getParentMilestoneId(milestoneId = null) {
    return getParentMilestoneId.call(this, milestoneId);
  }

  async getMilestoneRecord(milestoneId) {
    return getMilestoneRecord.call(this, milestoneId);
  }

  makeMilestoneBranchPrefix(milestoneId) {
    return makeMilestoneBranchPrefix.call(this, milestoneId);
  }

  slugifyMilestoneTitle(title, options = {}) {
    return slugifyMilestoneTitle.call(this, title, options);
  }

  async allocateNextMilestoneId(parentMilestoneId = null) {
    return allocateNextMilestoneId.call(this, parentMilestoneId);
  }

  async allocateNextEpochId() {
    return allocateNextEpochId.call(this);
  }

  async upsertMilestoneRecord(record) {
    return upsertMilestoneRecord.call(this, record);
  }

  async ensureEpochPRForCurrentMilestone() {
    return ensureEpochPRForCurrentMilestone.call(this);
  }

  async markCurrentMilestoneFailed(reason) {
    return markCurrentMilestoneFailed.call(this, reason);
  }

  async markCurrentMilestoneCompleted() {
    return markCurrentMilestoneCompleted.call(this);
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
    const { reportId } = writeRunnerReport(this, agentName, body, { success, durationMs });
    log(`Saved report for ${agentName}`, this.id);
    broadcastReportUpdate(this.id, reportId, agentName, this.cycleCount);
    return { reportId };
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
    return await startRunner(this, { log });
  }

  loadState() {
    return loadRunnerState(this, { log });
  }

  saveState() {
    return saveRunnerState(this, { log });
  }

  stop() {
    return stopRunner(this, { log });
  }

  pause() {
    return pauseRunner(this, { log });
  }

  resume() {
    return resumeRunner(this, { log });
  }

  skip() {
    return skipRunner(this, { log });
  }

  // Kill Run: terminate the current agent, move to next in schedule
  killRun() {
    return killRunnerRun(this, { log });
  }

  // Kill Cycle: terminate current agent + skip remaining workers in schedule
  killCycle() {
    return killRunnerCycle(this, { log });
  }

  // Kill Epoch: terminate everything + force back to Athena
  killEpoch() {
    return killRunnerEpoch(this, { log });
  }

  // Wait while paused, auto-resuming after intervalMs. Optional condition check to resume early.
  async _autoPauseWait(intervalMs, resumeCondition = null) {
    return autoPauseWait(this, { log, sleep }, intervalMs, resumeCondition);
  }

  async sleepDelay(minutes, label) {
    return sleepDelay(this, { log, sleep }, minutes, label);
  }

  _parseVisibility(value, task) {
    return parseVisibility(this, {}, value, task);
  }

  parseSchedule(resultText) {
    return parseSchedule(this, { log }, resultText);
  }

  async executeSchedule(schedule, config, managerName = null) {
    return executeSchedule(this, { log, sleep }, schedule, config, managerName);
  }

  async runLoop() {
    return runRunnerLoop(this, { getKeyPoolSafe, log, sleep });
  }

  // Build the full prompt for an agent (shared across CLI and API paths)
  _getAgentFilesystemPolicy(agent, visibility = null) {
    return getAgentFilesystemPolicy(this, agent, visibility);
  }

  _buildAgentPrompt(agent, task, visibility) {
    return buildAgentPrompt(this, agent, task, visibility, { root: ROOT });
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
        const { reportId } = writeRunnerReport(this, agent.name, reportBody, {
          cost: cost ?? null,
          durationMs: durationMs ?? null,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cacheReadTokens: usage?.cacheReadTokens ?? null,
          success,
          model: this.currentAgentModel ?? null,
          timedOut: killedByTimeout,
          keyId: this.currentAgentKeyId ?? null,
          visibilityMode: this.currentAgentVisibility?.mode || 'full',
          visibilityIssues: this.currentAgentVisibility?.issues || [],
          preformatted: true,
        });
        log(`Saved report for ${agent.name}`, this.id);
        broadcastReportUpdate(this.id, reportId, agent.name, this.cycleCount);
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
