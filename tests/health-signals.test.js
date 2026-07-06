import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
  DEFAULT_HEALTH_THRESHOLDS,
  buildHealthContext,
  computeHealthSignals,
  getHealthThresholds,
  healthTripwire,
  parseHealthVerdict,
} from '../src/orchestrator/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phaseMachinePath = path.join(__dirname, '..', 'src', 'orchestrator', 'phase-machine.js');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-health-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function makeProjectDb(name) {
  const dbPath = path.join(tmpDir, `${name}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, milestone_id TEXT UNIQUE, title TEXT, description TEXT NOT NULL, cycles_budget INTEGER DEFAULT 20, cycles_used INTEGER DEFAULT 0, branch_name TEXT, parent_milestone_id TEXT, linked_pr_id INTEGER, failure_reason TEXT, phase TEXT DEFAULT 'implementation', status TEXT DEFAULT 'active', created_at TEXT, completed_at TEXT);
    CREATE TABLE tbc_prs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', base_branch TEXT DEFAULT 'main', head_branch TEXT DEFAULT 'x', updated_at TEXT);
    CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle INTEGER, agent TEXT, body TEXT, milestone_id TEXT, cost REAL, created_at TEXT);
    CREATE TABLE issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT DEFAULT '', status TEXT DEFAULT 'open', creator TEXT NOT NULL);
  `);
  return { db, dbPath };
}

function fakeRunner(dbPath, overrides = {}) {
  return {
    id: 'test',
    cycleCount: 100,
    lastHealthCheckCycle: 90,
    consecutiveReplans: 0,
    currentMilestoneId: null,
    milestoneTitle: null,
    specPath: path.join(tmpDir, 'no-spec.md'),
    getDb() { return new Database(dbPath); },
    getCostSummary() { return { total: 12.5, last24h: 3.25 }; },
    ...overrides,
  };
}

describe('health thresholds and tripwires', () => {
  it('merges config overrides over defaults, ignoring invalid values', () => {
    const thresholds = getHealthThresholds({ health: { consecutiveReplans: 5, milestoneDepth: -1, bogus: 9 } });
    assert.equal(thresholds.consecutiveReplans, 5);
    assert.equal(thresholds.milestoneDepth, DEFAULT_HEALTH_THRESHOLDS.milestoneDepth);
    assert.equal(thresholds.noMergeStreak, DEFAULT_HEALTH_THRESHOLDS.noMergeStreak);
    assert.equal(thresholds.bogus, undefined);
  });

  it('fires on each signal and stays quiet below thresholds', () => {
    const t = DEFAULT_HEALTH_THRESHOLDS;
    const calm = { consecutiveReplans: 0, milestoneFamilySize: 1, milestoneDepth: 1, noMergeStreak: 0, cyclesSinceLastHealthCheck: 3 };
    assert.equal(healthTripwire(calm, t), null);
    assert.match(healthTripwire({ ...calm, consecutiveReplans: 3 }, t), /consecutiveReplans/);
    assert.match(healthTripwire({ ...calm, milestoneFamilySize: 8 }, t), /milestoneFamilySize/);
    assert.match(healthTripwire({ ...calm, milestoneDepth: 4 }, t), /milestoneDepth/);
    assert.match(healthTripwire({ ...calm, noMergeStreak: 5 }, t), /noMergeStreak/);
    assert.match(healthTripwire({ ...calm, cyclesSinceLastHealthCheck: 50 }, t), /cycleFloor/);
  });
});

describe('computeHealthSignals', () => {
  it('measures the M87-style pathology: big family, deep nesting, no merges', () => {
    const { db, dbPath } = makeProjectDb('pathology');
    const insertMilestone = db.prepare("INSERT INTO milestones (milestone_id, title, description, status, created_at, completed_at) VALUES (?, ?, 'd', ?, ?, ?)");
    insertMilestone.run('M87', 'parent', 'active', '2026-05-14T00:00:00Z', null);
    for (let i = 1; i <= 9; i++) {
      insertMilestone.run(`M87.${i}`, `child ${i}`, i % 3 ? 'completed' : 'failed', `2026-05-${14 + i}T00:00:00Z`, `2026-05-${14 + i}T12:00:00Z`);
    }
    db.prepare("INSERT INTO tbc_prs (title, status, updated_at) VALUES ('old merge', 'merged', '2026-05-14T00:00:00Z')").run();
    db.prepare("INSERT INTO reports (cycle, agent, body, cost, created_at) VALUES (1, 'ares', 'b', 100.5, '2026-05-20T00:00:00Z')").run();
    db.close();

    const signals = computeHealthSignals(fakeRunner(dbPath, { currentMilestoneId: 'M87.9', consecutiveReplans: 2 }));
    assert.equal(signals.consecutiveReplans, 2);
    assert.equal(signals.milestoneFamilySize, 10);
    assert.equal(signals.milestoneDepth, 2);
    assert.equal(signals.noMergeStreak, 9);
    assert.equal(signals.costSinceLastMerge, 100.5);
    assert.equal(signals.cyclesSinceLastHealthCheck, 10);
  });

  it('counts all terminal milestones when nothing was ever merged', () => {
    const { db, dbPath } = makeProjectDb('no-merge');
    db.prepare("INSERT INTO milestones (milestone_id, title, description, status) VALUES ('M1', 't', 'd', 'completed')").run();
    db.close();
    const signals = computeHealthSignals(fakeRunner(dbPath));
    assert.equal(signals.noMergeStreak, 1);
    assert.equal(signals.milestoneFamilySize, 0, 'no current milestone → no family');
  });
});

describe('health context and verdict parsing', () => {
  it('builds a trajectory-level context with milestone history and human decisions', () => {
    const { db, dbPath } = makeProjectDb('context');
    db.prepare("INSERT INTO milestones (milestone_id, title, description, status) VALUES ('M1', 'Do the thing', 'd', 'completed')").run();
    db.prepare("INSERT INTO issues (title, creator, status) VALUES ('HUMAN: accept 28% error?', 'athena', 'open')").run();
    db.prepare("INSERT INTO issues (title, creator, status) VALUES ('Calibrate tier 1', 'human', 'open')").run();
    db.close();
    const context = buildHealthContext(fakeRunner(dbPath), { consecutiveReplans: 1 }, 'cycleFloor');
    assert.match(context, /M1 \| completed \| \$0 \| Do the thing/);
    assert.match(context, /HUMAN: accept 28% error\?/);
    assert.match(context, /Calibrate tier 1/);
    assert.match(context, /judge the trajectory, not the narrative/);
    assert.doesNotMatch(context, /knowledge\//, 'context must not point the auditor at the knowledge base');
  });

  it('parses HEALTH verdicts and rejects malformed ones', () => {
    assert.deepEqual(parseHealthVerdict('<!-- HEALTH -->{"verdict":"warn","diagnosis":"loop"}<!-- /HEALTH -->'),
      { verdict: 'warn', diagnosis: 'loop', decisions: [] });
    const stop = parseHealthVerdict('<!-- HEALTH -->{"verdict":"stop","diagnosis":"d","decisions":[{"question":"q","recommendation":"r"}]}<!-- /HEALTH -->');
    assert.equal(stop.verdict, 'stop');
    assert.equal(stop.decisions.length, 1);
    assert.equal(parseHealthVerdict('<!-- HEALTH -->{"verdict":"panic"}<!-- /HEALTH -->'), null);
    assert.equal(parseHealthVerdict('<!-- HEALTH -->not json<!-- /HEALTH -->'), null);
    assert.equal(parseHealthVerdict('no tag'), null);
  });
});

describe('health wiring in the phase machine', () => {
  const src = fs.readFileSync(phaseMachinePath, 'utf-8');

  it('runs the health audit at the top of the athena phase', () => {
    assert.match(src, /if \(runner\.phase === 'athena'\) \{\s*\n\s*\/\/ Health check[\s\S]{0,200}maybeRunHealthAudit\(runner, deps, config, managers\)/,
      'Expected the athena phase to consult the health auditor first');
  });

  it('injects warn diagnoses as a mandatory-response block and consumes them', () => {
    assert.match(src, /Health audit warning \(mandatory response\)/);
    assert.match(src, /runner\.setState\(\{ healthWarning: null \}\)/);
  });

  it('increments consecutiveReplans on every replan path and resets on verified milestones', () => {
    const increments = src.match(/consecutiveReplans: \(runner\.consecutiveReplans \|\| 0\) \+ 1/g) || [];
    assert.ok(increments.length >= 4,
      `Expected replan increments on deadline-miss (x2) and verify-fail (x2) paths, found ${increments.length}`);
    assert.match(src, /consecutiveReplans: 0/,
      'Expected verified milestones to reset the replan counter');
  });
});
