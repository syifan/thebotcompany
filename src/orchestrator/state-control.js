import fs from 'fs';
import path from 'path';
import { renderBlockedDigest } from './phase-machine.js';

export async function startRunner(runner, deps = {}) {
    if (runner.running) return;
    // Validate project path exists
    if (!fs.existsSync(runner.path)) {
      deps.log(`ERROR: Project path does not exist: ${runner.path}`, runner.id);
      return;
    }

    // Ensure project directories exist
    fs.mkdirSync(runner.projectDir, { recursive: true });
    fs.mkdirSync(runner.chatsDir, { recursive: true });
    fs.mkdirSync(runner.agentsDir, { recursive: true });
    fs.mkdirSync(runner.responsesDir, { recursive: true });
    fs.mkdirSync(runner.skillsDir, { recursive: true });
    fs.mkdirSync(runner.knowledgeDir, { recursive: true });
    fs.mkdirSync(path.join(runner.projectDir, 'knowledge', 'analysis'), { recursive: true });
    fs.mkdirSync(path.join(runner.projectDir, 'knowledge', 'decisions'), { recursive: true });
    fs.mkdirSync(runner.workerSkillsDir, { recursive: true });

    // Migrate legacy agent-writable knowledge/spec.md to human-owned project spec.md.
    const legacySpecPath = path.join(runner.knowledgeDir, 'spec.md');
    if (!fs.existsSync(runner.specPath) && fs.existsSync(legacySpecPath)) {
      try {
        fs.renameSync(legacySpecPath, runner.specPath);
        deps.log(`Migrated knowledge/spec.md to project spec.md`, runner.id);
      } catch (error) {
        deps.log(`Warning: failed to migrate knowledge/spec.md: ${error.message}`, runner.id);
      }
    }
    
    // Load persisted state
    runner.loadState();
    
    runner.running = true;
    deps.log(`Starting project runner (data: ${runner.projectDir}, cycle: ${runner.cycleCount})`, runner.id);
    runner.runLoop().catch((err) => {
      const message = err?.stack || err?.message || String(err);
      deps.log(`Project runner crashed: ${message}`, runner.id);
      runner.running = false;
      runner.setState({ isPaused: true, pauseReason: `Project runner crashed: ${err?.message || String(err)}` });
      runner.currentAgent = null;
      runner.currentAgentProcess = null;
      runner.currentAgentStartTime = null;
      runner.currentAgentLog = [];
      runner.currentAgentModel = null;
      runner.currentAgentCost = 0;
      runner.currentAgentUsage = null;
      runner.currentAgentKeyId = null;
      runner.currentAgentVisibility = null;
      deps.broadcastEvent?.({ type: 'error', project: runner.id, message: `Project runner crashed: ${err?.message || String(err)}` });
      deps.broadcastStatusUpdate?.(runner.id);
    });
  }

export function loadRunnerState(runner, deps = {}) {
    const statePath = runner.statePath;
    try {
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        runner.cycleCount = state.cycleCount || 0;
        runner.epochCount = state.epochCount || 0;
        runner.completedAgents = state.completedAgents || [];
        runner.currentCycleId = state.currentCycleId || null;
        runner.currentSchedule = state.currentSchedule || null;
        if (state.isPaused !== undefined) runner.isPaused = state.isPaused;
        // Phase state
        runner.phase = state.phase || 'athena';
        runner.milestoneTitle = state.milestoneTitle || null;
        runner.milestoneDescription = state.milestoneDescription || null;
        runner.milestoneCyclesBudget = state.milestoneCyclesBudget || 0;
        runner.milestoneCyclesUsed = state.milestoneCyclesUsed || 0;
        runner.currentMilestoneId = state.currentMilestoneId || null;
        runner.pendingMilestoneId = state.pendingMilestoneId || null;
        runner.currentEpochId = state.currentEpochId || null;
        runner.currentEpochPrId = state.currentEpochPrId || null;
        runner.currentMilestoneBranch = state.currentMilestoneBranch || null;
        runner.lastMergedMilestoneBranch = state.lastMergedMilestoneBranch || null;
        runner.aresGraceCycleUsed = state.aresGraceCycleUsed || false;
        runner.verificationFeedback = state.verificationFeedback || null;
        runner.examinationFeedback = state.examinationFeedback || null;
        runner.pendingCompletionMessage = state.pendingCompletionMessage || null;
        runner.isFixRound = state.isFixRound || false;
        runner.isComplete = state.isComplete || false;
        runner.completionSuccess = state.completionSuccess || false;
        runner.completionMessage = state.completionMessage || null;
        runner.lastWaitResult = state.lastWaitResult || null;
        runner.isBlocked = state.isBlocked || false;
        runner.blockedDecisions = state.blockedDecisions || null;
        runner.pendingUnblockDigest = state.pendingUnblockDigest || null;
        runner.consecutiveReplans = state.consecutiveReplans || 0;
        runner.healthWarning = state.healthWarning || null;
        runner.healthSnoozeUntilCycle = state.healthSnoozeUntilCycle || 0;
        runner.lastHealthCheckCycle = state.lastHealthCheckCycle || 0;
        deps.log(`Loaded state: cycle ${runner.cycleCount}, phase: ${runner.phase}, completed: [${runner.completedAgents.join(', ')}]${runner.isPaused ? ', paused' : ''}`, runner.id);
      } else {
        // New project — start paused
        runner.setState({ isPaused: true, pauseReason: 'New project (paused by default)' }, { save: false });
        runner.completedAgents = [];
        runner.currentCycleId = null;
        runner.currentSchedule = null;
      }
    } catch (e) {
      deps.log(`Failed to load state: ${e.message}`, runner.id);
      runner.completedAgents = [];
      runner.currentCycleId = null;
      runner.currentSchedule = null;
    }
  }

export function saveRunnerState(runner, deps = {}) {
    const statePath = runner.statePath;
    try {
      const state = {
        cycleCount: runner.cycleCount,
        epochCount: runner.epochCount || 0,
        completedAgents: runner.completedAgents || [],
        currentCycleId: runner.currentCycleId,
        currentSchedule: runner.currentSchedule || null,
        isPaused: runner.isPaused || false,
        phase: runner.phase,
        milestoneTitle: runner.milestoneTitle,
        milestoneDescription: runner.milestoneDescription,
        milestoneCyclesBudget: runner.milestoneCyclesBudget,
        milestoneCyclesUsed: runner.milestoneCyclesUsed,
        currentMilestoneId: runner.currentMilestoneId || null,
        pendingMilestoneId: runner.pendingMilestoneId || null,
        currentEpochId: runner.currentEpochId || null,
        currentEpochPrId: runner.currentEpochPrId || null,
        currentMilestoneBranch: runner.currentMilestoneBranch || null,
        lastMergedMilestoneBranch: runner.lastMergedMilestoneBranch || null,
        aresGraceCycleUsed: runner.aresGraceCycleUsed || false,
        verificationFeedback: runner.verificationFeedback,
        examinationFeedback: runner.examinationFeedback,
        pendingCompletionMessage: runner.pendingCompletionMessage,
        isFixRound: runner.isFixRound,
        isComplete: runner.isComplete || false,
        completionSuccess: runner.completionSuccess || false,
        completionMessage: runner.completionMessage || null,
        lastWaitResult: runner.lastWaitResult || null,
        isBlocked: runner.isBlocked || false,
        blockedDecisions: runner.blockedDecisions || null,
        pendingUnblockDigest: runner.pendingUnblockDigest || null,
        consecutiveReplans: runner.consecutiveReplans || 0,
        healthWarning: runner.healthWarning || null,
        healthSnoozeUntilCycle: runner.healthSnoozeUntilCycle || 0,
        lastHealthCheckCycle: runner.lastHealthCheckCycle || 0,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (e) {
      deps.log(`Failed to save state: ${e.message}`, runner.id);
    }
  }

export function stopRunner(runner, deps = {}) {
    runner.running = false;
    if (runner.currentAgentProcess) {
      runner.currentAgentProcess.kill('SIGTERM');
    }
    deps.log(`Stopped project runner`, runner.id);
  }

export function pauseRunner(runner, deps = {}) {
    runner.setState({ isPaused: true, pauseReason: null });
    deps.log(`Paused`, runner.id);
  }

export function resumeRunner(runner, deps = {}) {
    if (runner.isComplete) {
      deps.log(`Reopening completed project`, runner.id);
      runner.setState({
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
    } else if (runner.isBlocked) {
      deps.log(`Resuming blocked project — Athena will intake the human's decision replies`, runner.id);
      const digest = runner.blockedDecisions
        ? renderBlockedDigest(runner.blockedDecisions)
        : (runner.pauseReason || 'Project was blocked on human decisions.');
      runner.setState({
        isBlocked: false,
        blockedDecisions: null,
        pendingUnblockDigest: digest,
        isPaused: false,
        pauseReason: null,
        phase: 'athena',
      });
    } else {
      runner.setState({ isPaused: false, pauseReason: null });
    }
    runner.wakeNow = true;
    deps.log(`Resumed`, runner.id);
  }

export function skipRunner(runner, deps = {}) {
    if (runner.currentAgentProcess) {
      deps.log(`Skipping current agent`, runner.id);
      runner.currentAgentProcess.kill('SIGTERM');
    } else if (runner.sleepUntil) {
      deps.log(`Skipping sleep`, runner.id);
      runner.wakeNow = true;
    }
  }

export function killRunnerRun(runner, deps = {}) {
    if (runner.currentAgentProcess) {
      deps.log(`🔴 Kill Run: terminating current agent`, runner.id);
      runner.currentAgentProcess.kill('SIGTERM');
    }
  }

export function killRunnerCycle(runner, deps = {}) {
    deps.log(`🔴 Kill Cycle: terminating agent and clearing schedule`, runner.id);
    if (runner.currentAgentProcess) {
      runner.currentAgentProcess.kill('SIGTERM');
    }
    runner.currentSchedule = null;
    runner.completedAgents = [];
    runner.saveState();
  }

export function killRunnerEpoch(runner, deps = {}) {
    deps.log(`🔴 Kill Epoch: terminating agent, clearing schedule, returning to Athena`, runner.id);
    runner.abortCurrentCycle = true;
    if (runner.currentAgentProcess) {
      runner.currentAgentProcess.kill('SIGTERM');
    }
    runner.currentSchedule = null;
    runner.completedAgents = [];
    runner.setState({
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
