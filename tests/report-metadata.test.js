/**
 * Tests for storing agent run metadata in the reports SQLite table.
 *
 * Bug: cost and duration are stored in cost.csv (flat file), while
 * reports are in SQLite. Token usage, model, success, and timed_out
 * are not persisted at all. All metadata should be in the reports table.
 *
 * These tests verify that the ACTUAL report-saving code in ProjectRunner.js
 * writes metadata columns. They will FAIL until ProjectRunner.js is updated.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-report-meta-'));

/**
 * Simulate what ProjectRunner.js _postProcessAgentRun does when saving a report.
 * This mirrors the ACTUAL code at src/ProjectRunner.js line ~1800.
 */
function saveReportLikeServer(dbPath, { cycle, agent, body, cost, durationMs, inputTokens, outputTokens, cacheReadTokens, success, model, timedOut, visibilityMode, visibilityIssues }) {
  const db = new Database(dbPath);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle INTEGER NOT NULL,
      agent TEXT NOT NULL,
      body TEXT NOT NULL,
      summary TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )`);
    // Migration: add columns if they don't exist
    try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN input_tokens INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN output_tokens INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN cache_read_tokens INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN success INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN model TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN timed_out INTEGER'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}

    // THIS IS THE LINE THAT MATTERS — currently ProjectRunner.js only writes 4 fields:
    // db.prepare('INSERT INTO reports (cycle, agent, body, created_at) VALUES (?, ?, ?, ?)').run(...)
    //
    // After the fix, it should write all metadata fields:
    db.prepare(`INSERT INTO reports (cycle, agent, body, created_at, cost, duration_ms, input_tokens, output_tokens, cache_read_tokens, success, model, timed_out, visibility_mode, visibility_issues)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      cycle, agent, body, new Date().toISOString(),
      cost ?? null, durationMs ?? null, inputTokens ?? null, outputTokens ?? null,
      cacheReadTokens ?? null, success ? 1 : 0, model ?? null, timedOut ? 1 : 0,
      visibilityMode ?? 'full', JSON.stringify(visibilityIssues ?? [])
    );
  } finally {
    db.close();
  }
}

/**
 * Read the ACTUAL ProjectRunner.js INSERT statement and check if it includes
 * the metadata columns. This is the real failing test.
 */
function getServerInsertColumns() {
  const serverPath = path.join(process.cwd(), 'src', 'orchestrator', 'ProjectRunner.js');
  const serverCode = fs.readFileSync(serverPath, 'utf-8');
  // Find the INSERT INTO reports statement
  const match = serverCode.match(/INSERT INTO reports\s*\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split(',').map(c => c.trim());
}

describe('Report metadata in SQLite', () => {
  describe('ProjectRunner.js INSERT includes metadata columns', () => {
    const requiredColumns = ['cost', 'duration_ms', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'success', 'model', 'timed_out', 'visibility_mode', 'visibility_issues'];

    it('ProjectRunner.js INSERT INTO reports should include cost', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('cost'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'cost'. ` +
        `Currently writes to cost.csv instead of SQLite.`);
    });

    it('ProjectRunner.js INSERT INTO reports should include duration_ms', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('duration_ms'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'duration_ms'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include input_tokens', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('input_tokens'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'input_tokens'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include output_tokens', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('output_tokens'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'output_tokens'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include model', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('model'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'model'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include success', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('success'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'success'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include timed_out', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('timed_out'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'timed_out'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include visibility_mode', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('visibility_mode'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'visibility_mode'`);
    });

    it('ProjectRunner.js INSERT INTO reports should include visibility_issues', () => {
      const cols = getServerInsertColumns();
      assert.ok(cols.includes('visibility_issues'),
        `ProjectRunner.js INSERT only has [${cols.join(', ')}] — missing 'visibility_issues'`);
    });
  });

  describe('getCostSummary reads from SQLite (not cost.csv)', () => {
    it('ProjectRunner.js getCostSummary should query reports table', () => {
      const serverPath = path.join(process.cwd(), 'src', 'orchestrator', 'ProjectRunner.js');
      const serverCode = fs.readFileSync(serverPath, 'utf-8');

      // Find getCostSummary function
      const fnMatch = serverCode.match(/getCostSummary\(\)\s*\{[\s\S]*?\n  \}/);
      assert.ok(fnMatch, 'getCostSummary function not found');

      const fnBody = fnMatch[0];

      // Should query from SQLite, not read cost.csv
      assert.ok(
        !fnBody.includes('cost.csv') || fnBody.includes('SELECT'),
        'getCostSummary should query reports table (SELECT), not read cost.csv'
      );
    });
  });

  describe('data integrity', () => {
    let dbPath;

    beforeEach(() => {
      dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    });

    afterEach(() => {
      try { fs.unlinkSync(dbPath); } catch {}
    });

    it('metadata is stored and retrievable', () => {
      saveReportLikeServer(dbPath, {
        cycle: 42, agent: 'ares', body: 'Fixed the bug',
        cost: 0.5432, durationMs: 120000,
        inputTokens: 50000, outputTokens: 2000, cacheReadTokens: 10000,
        success: true, model: 'claude-opus-4-7', timedOut: false,
        visibilityMode: 'focused', visibilityIssues: ['123', '456'],
      });

      const db = new Database(dbPath);
      const row = db.prepare('SELECT * FROM reports WHERE cycle = 42').get();
      db.close();

      assert.strictEqual(row.cost, 0.5432);
      assert.strictEqual(row.duration_ms, 120000);
      assert.strictEqual(row.input_tokens, 50000);
      assert.strictEqual(row.output_tokens, 2000);
      assert.strictEqual(row.cache_read_tokens, 10000);
      assert.strictEqual(row.success, 1);
      assert.strictEqual(row.model, 'claude-opus-4-7');
      assert.strictEqual(row.timed_out, 0);
      assert.strictEqual(row.visibility_mode, 'focused');
      assert.strictEqual(row.visibility_issues, JSON.stringify(['123', '456']));
    });

    it('old reports without metadata have null columns (backward compat)', () => {
      const db = new Database(dbPath);
      db.exec(`CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle INTEGER NOT NULL, agent TEXT NOT NULL, body TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`);
      db.prepare('INSERT INTO reports (cycle, agent, body) VALUES (?, ?, ?)').run(1, 'ares', 'old report');
      // Migrate
      try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN model TEXT'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}

      const row = db.prepare('SELECT cost, model, visibility_mode, visibility_issues FROM reports WHERE cycle = 1').get();
      db.close();
      assert.strictEqual(row.cost, null);
      assert.strictEqual(row.model, null);
      assert.strictEqual(row.visibility_mode, null);
      assert.strictEqual(row.visibility_issues, null);
    });

    it('cost summary queries work on reports table', () => {
      const now = new Date();
      saveReportLikeServer(dbPath, { cycle: 1, agent: 'ares', body: 'r1', cost: 0.50, durationMs: 60000, success: true });
      saveReportLikeServer(dbPath, { cycle: 1, agent: 'felix', body: 'r2', cost: 0.30, durationMs: 30000, success: true });
      saveReportLikeServer(dbPath, { cycle: 2, agent: 'ares', body: 'r3', cost: 1.00, durationMs: 120000, success: false });

      const db = new Database(dbPath);
      const total = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports').get().v;
      const perAgent = db.prepare('SELECT agent, SUM(cost) as total FROM reports GROUP BY agent ORDER BY total DESC').all();
      db.close();

      assert.strictEqual(total, 1.80);
      assert.strictEqual(perAgent[0].agent, 'ares');
      assert.strictEqual(perAgent[0].total, 1.50);
    });
  });
});


describe('report milestone metadata UI', () => {
  it('renders a milestone pill in the report header when milestone_id is present', () => {
    const card = fs.readFileSync(path.resolve('monitor/src/components/project/AgentReportsCard.jsx'), 'utf8');
    assert.match(card, /report\.milestone_id/);
    assert.match(card, /StatusPill variant="meta" className="shrink-0 normal-case text-indigo-700 dark:text-indigo-300"/);
  });
});
