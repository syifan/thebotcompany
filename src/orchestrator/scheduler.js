import { extractObjectRefIds } from './object-refs.js';

export async function autoPauseWait(runner, deps = {}, intervalMs, resumeCondition = null) {
    const retryAt = Date.now() + intervalMs;
    while (runner.isPaused && runner.running && !runner.wakeNow) {
      await deps.sleep(5000);
      // Check if it's time to auto-retry
      if (Date.now() >= retryAt) {
        if (resumeCondition && !resumeCondition()) {
          // Condition not met, keep waiting (check again in 2h)
          deps.log(`Auto-retry check: condition not met, waiting another 2h`, runner.id);
          return runner._autoPauseWait(intervalMs, resumeCondition);
        }
        deps.log(`Auto-resuming after ${Math.round(intervalMs / 60000)}m pause`, runner.id);
        runner.isPaused = false;
        runner.pauseReason = null;
        return;
      }
    }
    // Manually resumed or stopped
    if (!runner.isPaused) {
      runner.pauseReason = null;
    }
  }

export async function sleepDelay(runner, deps = {}, minutes, label) {
    const ms = Math.min(Math.max(parseFloat(minutes) || 0, 0), 120) * 60000;
    if (ms <= 0) return;
    deps.log(`⏳ Waiting ${Math.round(ms / 60000)}m after ${label}...`, runner.id);
    runner.sleepUntil = Date.now() + ms;
    let slept = 0;
    while (slept < ms && !runner.wakeNow && runner.running && !runner.abortCurrentCycle) {
      await deps.sleep(5000);
      slept += 5000;
      while (runner.isPaused && !runner.wakeNow && runner.running && !runner.abortCurrentCycle) { await deps.sleep(1000); }
    }
    runner.sleepUntil = null;
  }

export function parseVisibility(runner, deps = {}, value, task) {
    const visMode = typeof value === 'object' ? value.visibility : undefined;
    if (!visMode || visMode === 'full') return null;
    if (visMode === 'blind') return { mode: 'blind', issues: [] };
    if (visMode === 'focused') {
      return { mode: 'focused', issues: extractObjectRefIds(task).map(String) };
    }
    return null;
  }

export function parseSchedule(runner, deps = {}, resultText) {
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
      deps.log(`Failed to parse schedule: ${e.message}`, runner.id);
      return null;
    }
  }

export async function executeSchedule(runner, deps = {}, schedule, config, managerName = null) {
    if (!schedule || !schedule._steps) return { total: 0, failures: 0 };
    
    let total = 0;
    let failures = 0;
    const ownerName = typeof managerName === 'string' ? managerName.toLowerCase() : null;
    const freshWorkers = runner.loadAgents().workers.filter(worker => {
      if (!ownerName) return true;
      return (worker.reportsTo || '').toLowerCase() === ownerName;
    });
    
    for (const step of schedule._steps) {
      if (!runner.running || runner.abortCurrentCycle) break;
      
      // Delay step
      if (step.delay !== undefined) {
        await runner.sleepDelay(step.delay, 'schedule');
        if (runner.abortCurrentCycle) break;
        continue;
      }
      
      // Agent step: { "agentName": taskValue }
      const name = Object.keys(step).find(k => k !== 'delay');
      if (!name) continue;

      // Skip agents already completed (supports resume after reboot)
      if (runner.completedAgents.includes(name.toLowerCase())) {
        deps.log(`Skipping ${name} (already completed this cycle)`, runner.id);
        continue;
      }
      
      const value = step[name];
      const worker = freshWorkers.find(w => w.name.toLowerCase() === name.toLowerCase());
      if (!worker) {
        const available = freshWorkers.map(w => w.name).sort().join(', ') || '(none)';
        const message = `Invalid schedule: worker "${name}" does not exist or does not report to ${managerName || 'this manager'}. Available workers: ${available}`;
        deps.log(message, runner.id);
        runner.setState({ isPaused: true, pauseReason: message, currentSchedule: null, completedAgents: [] });
        return { total: 1, failures: 1, invalidSchedule: true, message };
      }
      
      while (runner.isPaused && runner.running && !runner.abortCurrentCycle) { await deps.sleep(1000); }
      if (runner.abortCurrentCycle) break;
      
      const task = typeof value === 'string' ? value : value.task || null;
      const vis = runner._parseVisibility(value, task);
      
      // Retry on timeout/failure (up to 2 retries)
      const maxRetries = 2;
      let attempt = 0;
      let succeeded = false;
      while (attempt <= maxRetries && !succeeded && runner.running && !runner.abortCurrentCycle) {
        if (attempt > 0) {
          deps.log(`Retrying ${worker.name} (attempt ${attempt + 1}/${maxRetries + 1})`, runner.id);
        }
        const wResult = await runner.runAgent(worker, config, null, task, vis);
        if (runner.abortCurrentCycle) break;
        total++;
        if (wResult && wResult.success) {
          succeeded = true;
          runner.completedAgents.push(name.toLowerCase());
          runner.saveState();
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
