import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Formal offline jobs: long-running commands (builds, benchmark sweeps,
// simulations) that outlive a single agent run. A job submitted through this
// module gets a DB record, a log file, timeout enforcement, and a card in the
// monitor UI — unlike an informal `nohup ... &`, which is invisible to the
// orchestrator and to the human.
//
// There is no daemon: the job runs as a detached process group that writes an
// exit-code sentinel file when it finishes. Every read path (CLI, waitFor
// polling, the jobs API route) reconciles DB state from the sentinel + pid.

export const DEFAULT_JOB_TIMEOUT_MIN = 240;
export const MAX_JOB_TIMEOUT_MIN = 2880; // 48h
export const JOB_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function ensureJobsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'succeeded', 'failed', 'timeout', 'killed')),
      exit_code INTEGER,
      timeout_min INTEGER NOT NULL DEFAULT ${DEFAULT_JOB_TIMEOUT_MIN},
      submitted_by TEXT,
      log_path TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      finished_at TEXT
    )
  `);
}

export function jobsDir(dbPath) {
  return path.join(path.dirname(dbPath), 'jobs');
}

function exitSentinelPath(dbPath, name) {
  return path.join(jobsDir(dbPath), `${name}.exit`);
}

export function jobLogPath(dbPath, name) {
  return path.join(jobsDir(dbPath), `${name}.log`);
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessGroup(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }, 5000).unref?.();
}

function finishJob(db, job, status, exitCode, finishedAt = null) {
  db.prepare('UPDATE jobs SET status = ?, exit_code = ?, finished_at = COALESCE(?, strftime(\'%Y-%m-%dT%H:%M:%SZ\', \'now\')) WHERE id = ?')
    .run(status, exitCode, finishedAt, job.id);
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
}

// Bring a job row up to date with reality (sentinel file, pid, timeout).
export function reconcileJob(db, dbPath, job) {
  if (!job || job.status !== 'running') return job;

  const sentinel = exitSentinelPath(dbPath, job.name);
  if (fs.existsSync(sentinel)) {
    let exitCode = null;
    let finishedAt = null;
    try {
      exitCode = parseInt(fs.readFileSync(sentinel, 'utf-8').trim(), 10);
      if (Number.isNaN(exitCode)) exitCode = null;
      finishedAt = fs.statSync(sentinel).mtime.toISOString();
    } catch {}
    return finishJob(db, job, exitCode === 0 ? 'succeeded' : 'failed', exitCode, finishedAt);
  }

  const startedMs = Date.parse(job.created_at);
  const timedOut = Number.isFinite(startedMs)
    && Date.now() - startedMs > job.timeout_min * 60000;
  if (timedOut) {
    if (job.pid) killProcessGroup(job.pid);
    return finishJob(db, job, 'timeout', null);
  }

  if (!pidAlive(job.pid)) {
    // Process gone without writing a sentinel: crashed, was killed externally,
    // or the machine rebooted mid-job.
    return finishJob(db, job, 'failed', null);
  }

  return job;
}

export function getJob(db, dbPath, name) {
  ensureJobsTable(db);
  const job = db.prepare('SELECT * FROM jobs WHERE name = ?').get(name);
  return job ? reconcileJob(db, dbPath, job) : null;
}

export function listJobs(db, dbPath, { status = null } = {}) {
  ensureJobsTable(db);
  const rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
  const reconciled = rows.map(job => reconcileJob(db, dbPath, job));
  return status ? reconciled.filter(job => job.status === status) : reconciled;
}

export function submitJob(db, dbPath, { name, command, cwd = null, timeoutMin = DEFAULT_JOB_TIMEOUT_MIN, submittedBy = null }) {
  ensureJobsTable(db);
  if (!JOB_NAME_RE.test(name || '')) {
    throw new Error(`Invalid job name "${name}": use letters, digits, dot, dash, underscore (max 64 chars)`);
  }
  if (!command || !String(command).trim()) {
    throw new Error('Job command is empty');
  }
  const timeout = Math.min(Math.max(parseInt(timeoutMin, 10) || DEFAULT_JOB_TIMEOUT_MIN, 1), MAX_JOB_TIMEOUT_MIN);

  const existing = getJob(db, dbPath, name);
  if (existing && existing.status === 'running') {
    return { job: existing, alreadyRunning: true };
  }

  const dir = jobsDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = jobLogPath(dbPath, name);
  const sentinel = exitSentinelPath(dbPath, name);
  try { fs.unlinkSync(sentinel); } catch {}
  fs.writeFileSync(logPath, `# job: ${name}\n# command: ${command}\n# submitted: ${new Date().toISOString()}${submittedBy ? ` by ${submittedBy}` : ''}\n`);

  const projectDir = path.dirname(dbPath);
  const defaultCwd = fs.existsSync(path.join(projectDir, 'repo')) ? path.join(projectDir, 'repo') : projectDir;
  const jobCwd = cwd || defaultCwd;
  if (!fs.existsSync(jobCwd)) {
    throw new Error(`Job cwd does not exist: ${jobCwd}`);
  }

  const logFd = fs.openSync(logPath, 'a');
  // The wrapper writes the exit code to the sentinel no matter how the command
  // ends; `detached` gives the job its own process group so timeout/cancel can
  // kill the whole tree.
  const wrapped = `(${command})\nprintf '%s' "$?" > ${JSON.stringify(sentinel)}`;
  const proc = spawn('/bin/sh', ['-c', wrapped], {
    cwd: jobCwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  proc.unref();
  fs.closeSync(logFd);

  db.prepare(`
    INSERT INTO jobs (name, command, cwd, pid, status, exit_code, timeout_min, submitted_by, log_path, created_at, finished_at)
    VALUES (?, ?, ?, ?, 'running', NULL, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL)
    ON CONFLICT(name) DO UPDATE SET
      command = excluded.command,
      cwd = excluded.cwd,
      pid = excluded.pid,
      status = 'running',
      exit_code = NULL,
      timeout_min = excluded.timeout_min,
      submitted_by = excluded.submitted_by,
      log_path = excluded.log_path,
      created_at = excluded.created_at,
      finished_at = NULL
  `).run(name, command, jobCwd, proc.pid, timeout, submittedBy, logPath);

  return { job: db.prepare('SELECT * FROM jobs WHERE name = ?').get(name), alreadyRunning: false };
}

export function cancelJob(db, dbPath, name) {
  const job = getJob(db, dbPath, name);
  if (!job) throw new Error(`No job named "${name}"`);
  if (job.status !== 'running') return job;
  if (job.pid) killProcessGroup(job.pid);
  return finishJob(db, job, 'killed', null);
}

export function jobLogTail(dbPath, name, lines = 40) {
  const logPath = jobLogPath(dbPath, name);
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}
