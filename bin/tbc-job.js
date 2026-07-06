#!/usr/bin/env node

/**
 * tbc-job — CLI for formal offline jobs
 *
 * Long-running commands (builds, benchmark sweeps, simulations) that must
 * outlive a single agent run. Submitted jobs get a DB record, a log file,
 * timeout enforcement, and show up in the monitor UI. Never use `nohup ... &`
 * for long work — informal background processes are invisible and untracked.
 *
 * Usage:
 *   tbc-job submit --name <name> [--timeout-min N] [--cwd path] [--actor who] -- <command...>
 *   tbc-job status <name>
 *   tbc-job list [--status running|succeeded|failed|timeout|killed]
 *   tbc-job logs <name> [--lines N]
 *   tbc-job cancel <name>
 *
 * The TBC_DB environment variable must point to the project's database file.
 * The orchestrator sets this automatically when spawning agents.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import {
  cancelJob,
  getJob,
  jobLogTail,
  listJobs,
  submitJob,
} from '../src/orchestrator/jobs.js';

const dbPath = process.env.TBC_DB;
if (!dbPath) {
  console.error('Error: TBC_DB environment variable not set');
  process.exit(1);
}
if (path.basename(dbPath) !== 'project.db') {
  console.error(`Error: TBC_DB must point to canonical project.db, got ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function describe(job) {
  const started = job.created_at;
  const runtimeMin = job.finished_at
    ? Math.round((Date.parse(job.finished_at) - Date.parse(job.created_at)) / 60000)
    : Math.round((Date.now() - Date.parse(job.created_at)) / 60000);
  const exit = job.exit_code === null || job.exit_code === undefined ? '-' : job.exit_code;
  return `${job.name} | ${job.status} | exit=${exit} | ${runtimeMin}m | started ${started}${job.submitted_by ? ` by ${job.submitted_by}` : ''}\n  command: ${job.command}\n  log: ${job.log_path}`;
}

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === 'submit') {
    const sep = rest.indexOf('--');
    if (sep === -1) fail('submit requires "-- <command...>" after the options');
    const options = rest.slice(0, sep);
    const jobCommand = rest.slice(sep + 1).join(' ').trim();
    const name = flagValue(options, '--name');
    if (!name) fail('submit requires --name');
    const { job, alreadyRunning } = submitJob(db, dbPath, {
      name,
      command: jobCommand,
      cwd: flagValue(options, '--cwd'),
      timeoutMin: flagValue(options, '--timeout-min') || undefined,
      submittedBy: flagValue(options, '--actor'),
    });
    if (alreadyRunning) {
      console.log(`Job "${job.name}" is already running (submitted ${job.created_at}); not starting a duplicate.`);
    } else {
      console.log(`Submitted job "${job.name}" (pid ${job.pid}, timeout ${job.timeout_min}m).`);
    }
    console.log(describe(job));
    console.log('Check later with: tbc-job status ' + job.name + ' — or have your manager emit {"waitFor": {"job": "' + job.name + '"}}.');
  } else if (command === 'status') {
    const name = rest[0];
    if (!name) fail('status requires a job name');
    const job = getJob(db, dbPath, name);
    if (!job) fail(`No job named "${name}"`);
    console.log(describe(job));
  } else if (command === 'list') {
    const jobs = listJobs(db, dbPath, { status: flagValue(rest, '--status') });
    if (!jobs.length) {
      console.log('No jobs.');
    } else {
      for (const job of jobs) console.log(describe(job));
    }
  } else if (command === 'logs') {
    const name = rest[0];
    if (!name) fail('logs requires a job name');
    const job = getJob(db, dbPath, name);
    if (!job) fail(`No job named "${name}"`);
    const lines = parseInt(flagValue(rest, '--lines'), 10) || 40;
    console.log(jobLogTail(dbPath, name, lines));
  } else if (command === 'cancel') {
    const name = rest[0];
    if (!name) fail('cancel requires a job name');
    const job = cancelJob(db, dbPath, name);
    console.log(describe(job));
  } else {
    fail(`Unknown command "${command || ''}". Commands: submit, status, list, logs, cancel`);
  }
} catch (e) {
  fail(e.message);
}
