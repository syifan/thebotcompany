import fs from 'fs';
import path from 'path';

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
    
    // Load persisted state
    runner.loadState();
    
    runner.running = true;
    deps.log(`Starting project runner (data: ${runner.projectDir}, cycle: ${runner.cycleCount})`, runner.id);
    runner.runLoop();
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
