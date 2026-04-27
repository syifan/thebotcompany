import fs from 'fs';
import path from 'path';

export function getStatus(runner, deps = {}) {
    return {
      id: runner.id,
      path: runner.path,
      repo: runner.repo,
      enabled: runner.enabled,
      archived: runner.archived,
      running: runner.running,
      paused: runner.isPaused,
      pauseReason: runner.pauseReason || null,
      cycleCount: runner.cycleCount,
      epochCount: runner.epochCount,
      currentAgent: runner.currentAgent,
      currentAgentModel: runner.currentAgentModel,
      currentAgentKeyId: runner.currentAgentKeyId || null,
      currentAgentVisibility: runner.currentAgentVisibility || { mode: 'full', issues: [] },
      currentAgentRuntime: runner.currentAgentStartTime
        ? Math.floor((Date.now() - runner.currentAgentStartTime) / 1000)
        : null,
      sleeping: runner.sleepUntil !== null && !runner.isPaused,
      sleepUntil: runner.isPaused ? null : runner.sleepUntil,
      schedule: runner.currentSchedule || null,
      phase: runner.phase,
      milestoneTitle: runner.milestoneTitle,
      milestone: runner.milestoneDescription,
      milestoneCyclesBudget: runner.milestoneCyclesBudget,
      milestoneCyclesUsed: runner.milestoneCyclesUsed,
      currentMilestoneId: runner.currentMilestoneId,
      pendingMilestoneId: runner.pendingMilestoneId,
      currentEpochId: runner.currentEpochId,
      currentEpochPrId: runner.currentEpochPrId,
      currentMilestoneBranch: runner.currentMilestoneBranch,
      lastMergedMilestoneBranch: runner.lastMergedMilestoneBranch,
      isFixRound: runner.isFixRound,
      isComplete: runner.isComplete || false,
      completionSuccess: runner.completionSuccess || false,
      completionMessage: runner.completionMessage || null,
      config: runner.loadConfig(),
      agents: runner.loadAgents(),
      cost: runner.getCostSummary(),
      budget: runner.getBudgetStatus()
    };
  }

export function bootstrapPreview(runner, deps = {}) {
    const projectDataExists = fs.existsSync(runner.projectDir);
    let projectDataContents = [];
    if (projectDataExists) {
      projectDataContents = fs.readdirSync(runner.projectDir).filter(name => !['repo', 'knowledge', 'skills', 'config.yaml'].includes(name));
    }
    // Read spec.md and check roadmap.md from private knowledge base
    let specContent = null;
    const specPath = path.join(runner.knowledgeDir, 'spec.md');
    try { specContent = fs.readFileSync(specPath, 'utf-8'); } catch {}
    const hasRoadmap = fs.existsSync(path.join(runner.knowledgeDir, 'roadmap.md'));
    return { available: true, projectDataEmpty: projectDataContents.length === 0, repo: runner.repo, specContent, hasRoadmap };
  }

export function bootstrap(runner, deps = {}, options = {}) {
    // 0. Kill any running agent and pause the project
    if (runner.currentAgentProcess) {
      try { runner.currentAgentProcess.kill('SIGKILL'); } catch {}
      deps.log(`Killed running agent ${runner.currentAgent} for bootstrap`, runner.id);
      runner.currentAgentProcess = null;
      runner.currentAgent = null;
      runner.currentAgentStartTime = null;
      runner.currentAgentLog = [];
      runner.currentAgentModel = null; runner.currentAgentCost = 0; runner.currentAgentUsage = null; runner.currentAgentKeyId = null; runner.currentAgentVisibility = null;
    }
    runner.isPaused = true;
    runner.pauseReason = 'Bootstrapping';
    runner.completedAgents = [];
    runner.currentCycleId = null;
    runner.currentSchedule = null;

    // 1. Wipe project operational state only, keep repo/knowledge/skills intact
    for (const target of runner.getOperationalPaths()) {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
    }
    deps.log(`Cleared project operational state`, runner.id);
    fs.mkdirSync(runner.projectDir, { recursive: true });

    // 2. Reset cycle count, phase, and save state
    runner.setState({
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
    deps.log(`Reset cycle count, project paused`, runner.id);

    // 3. Remove roadmap.md from private knowledge base if requested
    if (options.removeRoadmap) {
      const roadmapPath = path.join(runner.knowledgeDir, 'roadmap.md');
      if (fs.existsSync(roadmapPath)) {
        try {
          fs.unlinkSync(roadmapPath);
          deps.log(`Removed private roadmap.md`, runner.id);
        } catch (e) {
          deps.log(`Warning: failed to remove private roadmap.md: ${e.message}`, runner.id);
        }
      }
    }

    // 4. Update private spec.md if requested
    if (options.spec && options.spec.mode !== 'keep') {
      const specPath = path.join(runner.knowledgeDir, 'spec.md');
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
          deps.log(`Updated private knowledge/spec.md`, runner.id);
        } catch (e) {
          deps.log(`Warning: failed to update spec.md: ${e.message}`, runner.id);
        }
      }
    }

    return { bootstrapped: true };
  }

export async function runDoctor(runner, deps = {}) {
    const config = runner.loadConfig();
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
    return await runner.runAgent(doctorAgent, config, 'doctor', task, { mode: 'full', issues: [] });
  }
