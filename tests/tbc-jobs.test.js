import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
  cancelJob,
  getJob,
  jobLogTail,
  listJobs,
  submitJob,
} from '../src/orchestrator/jobs.js';
import { normalizeWaitForSpec, WAIT_FOR_JOB_DEFAULT_POLL_MIN } from '../src/orchestrator/scheduler.js';
import { trustedTbcJobArgsForCommand } from '../src/agent-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schedulerPath = path.join(__dirname, '..', 'src', 'orchestrator', 'scheduler.js');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-jobs-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function makeProject(name) {
  const projectDir = path.join(tmpDir, name);
  fs.mkdirSync(projectDir, { recursive: true });
  const dbPath = path.join(projectDir, 'project.db');
  return { dbPath, db: new Database(dbPath) };
}

async function waitUntil(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error('waitUntil timed out');
}

describe('formal offline jobs', () => {
  it('runs a job to success and reconciles exit code and log', async () => {
    const { db, dbPath } = makeProject('success');
    const { job, alreadyRunning } = submitJob(db, dbPath, {
      name: 'hello',
      command: 'echo hi-there',
      submittedBy: 'leo',
    });
    assert.equal(alreadyRunning, false);
    assert.equal(job.status, 'running');
    assert.ok(job.pid > 0);

    const done = await waitUntil(() => {
      const current = getJob(db, dbPath, 'hello');
      return current.status !== 'running' ? current : null;
    });
    assert.equal(done.status, 'succeeded');
    assert.equal(done.exit_code, 0);
    assert.equal(done.submitted_by, 'leo');
    assert.ok(done.finished_at, 'finished_at recorded');
    assert.match(jobLogTail(dbPath, 'hello'), /hi-there/);
    db.close();
  });

  it('records failure exit codes', async () => {
    const { db, dbPath } = makeProject('failure');
    submitJob(db, dbPath, { name: 'boom', command: 'exit 3' });
    const done = await waitUntil(() => {
      const current = getJob(db, dbPath, 'boom');
      return current.status !== 'running' ? current : null;
    });
    assert.equal(done.status, 'failed');
    assert.equal(done.exit_code, 3);
    db.close();
  });

  it('deduplicates a running job by name and allows re-running a finished one', async () => {
    const { db, dbPath } = makeProject('dedup');
    submitJob(db, dbPath, { name: 'work', command: 'sleep 5' });
    const second = submitJob(db, dbPath, { name: 'work', command: 'echo other' });
    assert.equal(second.alreadyRunning, true);
    assert.equal(second.job.command, 'sleep 5', 'running job is not replaced');

    cancelJob(db, dbPath, 'work');
    const cancelled = getJob(db, dbPath, 'work');
    assert.equal(cancelled.status, 'killed');

    const rerun = submitJob(db, dbPath, { name: 'work', command: 'echo again' });
    assert.equal(rerun.alreadyRunning, false, 'finished job can be re-run under the same name');
    await waitUntil(() => getJob(db, dbPath, 'work').status !== 'running' ? getJob(db, dbPath, 'work') : null);
    assert.equal(getJob(db, dbPath, 'work').status, 'succeeded');
    db.close();
  });

  it('marks a job failed when its process dies without a sentinel', async () => {
    const { db, dbPath } = makeProject('crash');
    const { job } = submitJob(db, dbPath, { name: 'crashy', command: 'sleep 30' });
    process.kill(-job.pid, 'SIGKILL'); // simulate crash/reboot: whole group dies, no sentinel
    const done = await waitUntil(() => {
      const current = getJob(db, dbPath, 'crashy');
      return current.status !== 'running' ? current : null;
    });
    assert.equal(done.status, 'failed');
    assert.equal(done.exit_code, null);
    db.close();
  });

  it('enforces the job timeout on reconcile', async () => {
    const { db, dbPath } = makeProject('timeout');
    submitJob(db, dbPath, { name: 'slow', command: 'sleep 60', timeoutMin: 1 });
    // Backdate the start so the next reconcile sees it as expired
    db.prepare("UPDATE jobs SET created_at = '2020-01-01T00:00:00Z' WHERE name = 'slow'").run();
    const done = getJob(db, dbPath, 'slow');
    assert.equal(done.status, 'timeout');
    db.close();
  });

  it('validates names and rejects empty commands', () => {
    const { db, dbPath } = makeProject('invalid');
    assert.throws(() => submitJob(db, dbPath, { name: 'bad name!', command: 'echo x' }), /Invalid job name/);
    assert.throws(() => submitJob(db, dbPath, { name: 'ok', command: '  ' }), /command is empty/);
    db.close();
  });

  it('lists jobs with reconciliation and status filter', async () => {
    const { db, dbPath } = makeProject('list');
    submitJob(db, dbPath, { name: 'a', command: 'echo a' });
    submitJob(db, dbPath, { name: 'b', command: 'sleep 30' });
    await waitUntil(() => getJob(db, dbPath, 'a').status === 'succeeded');
    const running = listJobs(db, dbPath, { status: 'running' });
    assert.deepEqual(running.map(job => job.name), ['b']);
    cancelJob(db, dbPath, 'b');
    db.close();
  });
});

describe('trusted tbc-job command routing', () => {
  it('routes simple status/list/logs/cancel commands', () => {
    assert.deepEqual(trustedTbcJobArgsForCommand('tbc-job status gem5-oracle-build'), ['status', 'gem5-oracle-build']);
    assert.deepEqual(trustedTbcJobArgsForCommand('tbc-job list --status running'), ['list', '--status', 'running']);
    assert.deepEqual(trustedTbcJobArgsForCommand('cd repo && tbc-job logs build --lines 60'), ['logs', 'build', '--lines', '60']);
  });

  it('passes the submit tail through verbatim as one argument', () => {
    const args = trustedTbcJobArgsForCommand(
      'tbc-job submit --name gem5-oracle-build --timeout-min 240 --actor leo -- docker build -t gem5-pinned tools/gem5 && echo done');
    assert.deepEqual(args, [
      'submit', '--name', 'gem5-oracle-build', '--timeout-min', '240', '--actor', 'leo',
      '--', 'docker build -t gem5-pinned tools/gem5 && echo done',
    ]);
  });

  it('does not confuse option flags with the -- separator', () => {
    assert.equal(trustedTbcJobArgsForCommand('tbc-job submit --name x'), null,
      'submit without a -- tail is rejected');
    const args = trustedTbcJobArgsForCommand('tbc-job submit --name x -- sh -c "sleep 1"');
    assert.deepEqual(args, ['submit', '--name', 'x', '--', 'sh -c "sleep 1"']);
  });

  it('rejects shell syntax around (not inside) the tbc-job invocation', () => {
    assert.equal(trustedTbcJobArgsForCommand('tbc-job status x && rm -rf /'), null);
    assert.equal(trustedTbcJobArgsForCommand('X=$(tbc-job status y)'), null);
    assert.equal(trustedTbcJobArgsForCommand('tbc-job submit --name `evil` -- echo hi'), null);
    assert.equal(trustedTbcJobArgsForCommand('echo tbc-job'), null);
    assert.equal(trustedTbcJobArgsForCommand('docker build .'), null);
  });

  it('dispatches trusted tbc-job invocations outside the sandbox in agent-runner', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent-runner.js'), 'utf-8');
    assert.match(src, /const trustedTbcJobArgs = trustedTbcJobArgsForCommand\(command\);/,
      'Bash execution should detect tbc-job commands');
    assert.match(src, /executeTrustedTbcDb\(trustedTbcJobArgs, cwd, timeout, bashEnv, runtime, TBC_JOB_CLI_PATH\)/,
      'tbc-job should run through the trusted boundary with its own CLI path');
    assert.match(src, /tbc-job must be run as a simple command/,
      'non-routable tbc-job usage should get a corrective error, not a sandbox EPERM');
  });
});

describe('waitFor job specs', () => {
  it('normalizes job waits with their own poll defaults', () => {
    assert.deepEqual(normalizeWaitForSpec({ job: 'gem5-oracle-build' }), {
      job: 'gem5-oracle-build',
      timeoutMin: 720,
      pollMin: WAIT_FOR_JOB_DEFAULT_POLL_MIN,
    });
  });

  it('rejects specs naming both run and job, or bad job names', () => {
    assert.equal(normalizeWaitForSpec({ run: 1, job: 'x' }), null);
    assert.equal(normalizeWaitForSpec({ job: 'bad name!' }), null);
    assert.equal(normalizeWaitForSpec({ job: '' }), null);
  });

  it('polls local jobs without shelling out to gh', () => {
    const src = fs.readFileSync(schedulerPath, 'utf-8');
    assert.match(src, /const check = job \? localJobStatus\(runner, job\) : await ghRunStatus\(repoDir, run\);/,
      'waitForCondition should branch to local job polling');
    assert.match(src, /if \(check\.job\.status !== 'running'\) break;/,
      'job waits should end on any terminal job status');
  });
});
