import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import { getAgentDetailsForRunner, loadAgentsForRunner } from './agent-loading.js';
import { decideProjectEpochPr, getOpenEpochPrForBranch, getProjectComments, getProjectCostSummary, getProjectPr, getProjectPrs, openProjectDb, writeRunnerReport } from './project-db.js';
import { computeSleepInterval, getBudgetStatus } from './budget.js';
import { createIssue, getIssues, resolveAllowedIssueClosers } from './issues.js';
import { bootstrap, bootstrapPreview, getStatus, runDoctor } from './lifecycle.js';
import { postProcessAgentRun, runAgentForRunner } from './agent-runtime.js';
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
    detectProviderFromToken,
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
    return computeSleepInterval(this, { log });
  }

  getBudgetStatus() {
    return getBudgetStatus(this);
  }

  _resolveAllowedIssueClosers(db, issueCreator) {
    return resolveAllowedIssueClosers(this, {}, issueCreator);
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
    const pr = this.currentEpochPrId
      ? await this.getPR(this.currentEpochPrId)
      : await this.getOpenEpochPRForCurrentMilestone();
    if (pr?.status === status) return pr;
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
    return getIssues(this);
  }

  async createIssue(title, body = '', creator = 'human', assignee = null) {
    return createIssue(this, {}, title, body, creator, assignee);
  }

  getStatus() {
    return getStatus(this);
  }

  bootstrapPreview() {
    return bootstrapPreview(this);
  }

  bootstrap(options = {}) {
    return bootstrap(this, { log }, options);
  }

  _writeReport(agentName, body, { success = true, durationMs = 0 } = {}) {
    const { reportId } = writeRunnerReport(this, agentName, body, { success, durationMs });
    log(`Saved report for ${agentName}`, this.id);
    broadcastReportUpdate(this.id, reportId, agentName, this.cycleCount);
    return { reportId };
  }

  async runDoctor() {
    return runDoctor(this);
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
    return runRunnerLoop(this, { broadcastEvent, getKeyPoolSafe, log, sleep });
  }

  // Build the full prompt for an agent (shared across CLI and API paths)
  _getAgentFilesystemPolicy(agent, visibility = null) {
    return getAgentFilesystemPolicy(this, agent, visibility);
  }

  _buildAgentPrompt(agent, task, visibility) {
    return buildAgentPrompt(this, agent, task, visibility, { root: ROOT });
  }

  // Post-processing shared by both CLI and API agent runs
  _postProcessAgentRun(agent, config, result) {
    return postProcessAgentRun(this, { broadcastEvent, broadcastReportUpdate, broadcastStatusUpdate, log, stripMetaBlocks }, agent, config, result);
  }

  async runAgent(agent, config, mode = null, task = null, visibility = null) {
    return runAgentForRunner(this, { broadcastEvent, broadcastLiveAgentEvent, broadcastReportUpdate, broadcastStatusUpdate, detectProviderFromToken, getOAuthAccessToken, getProviderRuntimeSelection, log, root: ROOT, stripMetaBlocks }, agent, config, mode, task, visibility);
  }
}


  return ProjectRunner;
}
