import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

function createDbWithTbcPrsSchema(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tbc_prs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        summary TEXT DEFAULT '',
        base_branch TEXT NOT NULL,
        head_branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        issue_ids TEXT DEFAULT '[]',
        test_status TEXT DEFAULT 'unknown',
        github_pr_number INTEGER,
        github_pr_url TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )
    `);
  } finally {
    db.close();
  }
}

describe('TBC local PR staging model', () => {
  it('tbc-db CLI should expose TBC PR commands', () => {
    const cliCode = fs.readFileSync(path.join(process.cwd(), 'bin', 'tbc-db.js'), 'utf-8');
    assert.match(cliCode, /'pr-create'\(\)/, 'Expected tbc-db to support pr-create');
    assert.match(cliCode, /'pr-list'\(\)/, 'Expected tbc-db to support pr-list');
    assert.match(cliCode, /'pr-view'\(\)/, 'Expected tbc-db to support pr-view');
    assert.match(cliCode, /'pr-edit'\(\)/, 'Expected tbc-db to support pr-edit');
  });

  it('agent shared rules should instruct workers to use TBC PRs', () => {
    const everyone = fs.readFileSync(path.join(process.cwd(), 'agent', 'everyone.md'), 'utf-8');
    const worker = fs.readFileSync(path.join(process.cwd(), 'agent', 'worker.md'), 'utf-8');
    assert.match(everyone, /Use TBC PRs, not GitHub PRs/i);
    assert.match(worker, /tbc-db pr-create/i);
  });
  it('server should create a tbc_prs table in project.db schema', () => {
    const serverCode = fs.readFileSync(path.join(process.cwd(), 'src', 'server.js'), 'utf-8');
    assert.match(serverCode, /CREATE TABLE IF NOT EXISTS tbc_prs/,
      'Expected server.js to create a tbc_prs table');
  });

  it('tbc_prs schema should support a private local PR object without GitHub metadata', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-prs-')), 'project.db');
    createDbWithTbcPrsSchema(dbPath);
    const db = new Database(dbPath);
    try {
      const cols = db.prepare(`PRAGMA table_info(tbc_prs)`).all().map(r => r.name);
      for (const required of ['title', 'summary', 'base_branch', 'head_branch', 'status', 'issue_ids', 'test_status']) {
        assert.ok(cols.includes(required), `Missing tbc_prs column: ${required}`);
      }
    } finally {
      db.close();
    }
  });

  it('supports creating a local TBC PR draft without a GitHub PR number', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-prs-')), 'project.db');
    createDbWithTbcPrsSchema(dbPath);
    const db = new Database(dbPath);
    try {
      db.prepare(`INSERT INTO tbc_prs (title, summary, base_branch, head_branch, status, issue_ids, test_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('Fix scheduler race', 'Local staging draft', 'main', 'tbc/change-123', 'draft', JSON.stringify([12, 34]), 'unknown');

      const row = db.prepare(`SELECT * FROM tbc_prs`).get();
      assert.equal(row.title, 'Fix scheduler race');
      assert.equal(row.base_branch, 'main');
      assert.equal(row.head_branch, 'tbc/change-123');
      assert.equal(row.status, 'draft');
      assert.equal(row.issue_ids, JSON.stringify([12, 34]));
      assert.equal(row.github_pr_number, null);
      assert.equal(row.github_pr_url, null);
    } finally {
      db.close();
    }
  });

  it('supports status progression for local review states', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-prs-')), 'project.db');
    createDbWithTbcPrsSchema(dbPath);
    const db = new Database(dbPath);
    try {
      db.prepare(`INSERT INTO tbc_prs (title, base_branch, head_branch, status) VALUES (?, ?, ?, ?)`).run(
        'Feature draft', 'main', 'tbc/feature-1', 'draft'
      );
      db.prepare(`UPDATE tbc_prs SET status = ?, test_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 1`).run(
        'ready_for_ci', 'pending'
      );
      const row = db.prepare(`SELECT status, test_status FROM tbc_prs WHERE id = 1`).get();
      assert.equal(row.status, 'ready_for_ci');
      assert.equal(row.test_status, 'pending');
    } finally {
      db.close();
    }
  });
});
