import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { extractFocusedRefIds } from './object-refs.js';
import { getJob, JOB_NAME_RE } from './jobs.js';

export const WAIT_FOR_DEFAULT_TIMEOUT_MIN = 720;
export const WAIT_FOR_MAX_TIMEOUT_MIN = 1440;
export const WAIT_FOR_DEFAULT_POLL_MIN = 5;
export const WAIT_FOR_MIN_POLL_MIN = 3;
// Local job polls are free (no API call), so they can be tighter than gh polls.
export const WAIT_FOR_JOB_MAX_TIMEOUT_MIN = 2880;
export const WAIT_FOR_JOB_DEFAULT_POLL_MIN = 2;
export const WAIT_FOR_JOB_MIN_POLL_MIN = 1;

export function normalizeWaitForSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const knownKeys = new Set(['run', 'job', 'timeoutMin', 'pollMin']);
  if (Object.keys(spec).some(key => !knownKeys.has(key))) return null;
  if (spec.run !== undefined && spec.job !== undefined) return null;

  if (spec.job !== undefined) {
    if (typeof spec.job !== 'string' || !JOB_NAME_RE.test(spec.job.trim())) return null;
    const timeoutMin = Math.min(
      Math.max(parseFloat(spec.timeoutMin) || WAIT_FOR_DEFAULT_TIMEOUT_MIN, 1),
      WAIT_FOR_JOB_MAX_TIMEOUT_MIN
    );
    const pollMin = Math.max(parseFloat(spec.pollMin) || WAIT_FOR_JOB_DEFAULT_POLL_MIN, WAIT_FOR_JOB_MIN_POLL_MIN);
    return { job: spec.job.trim(), timeoutMin, pollMin };
  }

  const runId = spec.run;
  const isValidId = typeof runId === 'number'
    ? Number.isInteger(runId) && runId > 0
    : typeof runId === 'string' && /^\d+$/.test(runId.trim());
  if (!isValidId) return null;
  const timeoutMin = Math.min(
    Math.max(parseFloat(spec.timeoutMin) || WAIT_FOR_DEFAULT_TIMEOUT_MIN, 1),
    WAIT_FOR_MAX_TIMEOUT_MIN
  );
  const pollMin = Math.max(parseFloat(spec.pollMin) || WAIT_FOR_DEFAULT_POLL_MIN, WAIT_FOR_MIN_POLL_MIN);
  return { run: String(runId).trim(), timeoutMin, pollMin };
}

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
    const ms = Math.min(Math.max(parseFloat(minutes) || 0, 0), 360) * 60000;
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
      return { mode: 'focused', issues: extractFocusedRefIds(task) };
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
      if (step.waitFor !== undefined) {
        if (Object.keys(step).length !== 1) return null;
        const waitFor = normalizeWaitForSpec(step.waitFor);
        return waitFor ? { waitFor } : null;
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

function ghRunStatus(repoDir, runId) {
  return new Promise((resolve) => {
    execFile('gh', ['run', 'view', runId, '--json', 'status,conclusion'], {
      cwd: repoDir,
      timeout: 60_000,
    }, (error, stdout) => {
      if (error) {
        resolve({ error: error.message });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ status: parsed.status || null, conclusion: parsed.conclusion || null });
      } catch (e) {
        resolve({ error: `Unparseable gh output: ${e.message}` });
      }
    });
  });
}

function localJobStatus(runner, name) {
  let db;
  try {
    db = runner.getDb();
  } catch (e) {
    return { error: e.message };
  }
  try {
    const job = getJob(db, runner.projectDbPath, name);
    if (!job) return { error: `no job named "${name}"` };
    return { job };
  } catch (e) {
    return { error: e.message };
  } finally {
    try { db.close(); } catch {}
  }
}

// Token-free wait: poll a GitHub Actions run (gh CLI) or a local tbc-job until
// it reaches a terminal state or the timeout expires. Managers see the outcome
// via runner.lastWaitResult in their next cycle context.
export async function waitForCondition(runner, deps = {}, spec) {
  const normalized = normalizeWaitForSpec(spec);
  if (!normalized) return null;
  const { run, job, timeoutMin, pollMin } = normalized;
  const repoCheckout = path.join(runner.projectDir, 'repo');
  const repoDir = fs.existsSync(repoCheckout) ? repoCheckout : runner.path;
  const deadline = Date.now() + timeoutMin * 60000;
  const startedAt = Date.now();
  const target = job ? `job "${job}"` : `run ${run}`;
  deps.log(`⏳ waitFor: polling ${target} every ${pollMin}m (timeout ${timeoutMin}m)...`, runner.id);

  let last = { status: null, conclusion: null };
  while (runner.running && !runner.abortCurrentCycle && !runner.wakeNow) {
    const check = job ? localJobStatus(runner, job) : await ghRunStatus(repoDir, run);
    if (check.error) {
      deps.log(`waitFor: ${target} check failed (${check.error}) — will retry`, runner.id);
    } else if (check.job) {
      last = { status: check.job.status, conclusion: check.job.exit_code === null ? null : `exit=${check.job.exit_code}` };
      if (check.job.status !== 'running') break;
    } else {
      last = check;
      if (check.status === 'completed') break;
    }
    if (Date.now() >= deadline) break;
    // Sleep one poll interval in small increments so pause/abort stay responsive
    const pollMs = Math.min(pollMin * 60000, deadline - Date.now());
    runner.sleepUntil = Date.now() + pollMs;
    let slept = 0;
    while (slept < pollMs && !runner.wakeNow && runner.running && !runner.abortCurrentCycle) {
      await deps.sleep(5000);
      slept += 5000;
      while (runner.isPaused && !runner.wakeNow && runner.running && !runner.abortCurrentCycle) { await deps.sleep(1000); }
    }
    runner.sleepUntil = null;
  }
  runner.sleepUntil = null;

  const waitedMin = Math.round((Date.now() - startedAt) / 60000);
  const terminal = job ? (last.status !== null && last.status !== 'running') : last.status === 'completed';
  const result = {
    ...(job ? { jobName: job } : { runId: run }),
    status: last.status,
    conclusion: last.conclusion,
    waitedMin,
    timedOut: !terminal,
  };
  runner.lastWaitResult = result;
  runner.saveState();
  deps.log(`waitFor: ${target} → ${result.status || 'unknown'}/${result.conclusion || '-'} after ${waitedMin}m${result.timedOut ? ' (timed out)' : ''}`, runner.id);
  return result;
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

      // waitFor step: token-free poll of an external condition (e.g. a GitHub Actions run)
      if (step.waitFor !== undefined) {
        await waitForCondition(runner, deps, step.waitFor);
        if (runner.abortCurrentCycle) break;
        continue;
      }

      // Agent step: { "agentName": taskValue }
      const name = Object.keys(step).find(k => k !== 'delay' && k !== 'waitFor');
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
