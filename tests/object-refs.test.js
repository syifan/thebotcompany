import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { extractFocusedRefIds, registerObjectRef, resolveReferencedObjectJson } from '../src/orchestrator/object-refs.js';

describe('global TBC object refs', () => {
  it('keeps bare #id global but resolves typed legacy Issue/PR mentions by local table id', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT, status TEXT, creator TEXT, assignee TEXT, labels TEXT, created_at TEXT, updated_at TEXT, updated_by TEXT, closed_at TEXT, closed_by TEXT);
      CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, author TEXT, body TEXT, created_at TEXT);
      CREATE TABLE tbc_prs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, summary TEXT, milestone_id TEXT, parent_pr_id INTEGER, epoch_index TEXT, branch_name TEXT, base_branch TEXT, head_branch TEXT, status TEXT, decision TEXT, decision_reason TEXT, issue_ids TEXT, test_status TEXT, github_pr_number INTEGER, github_pr_url TEXT, actor TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE tbc_pr_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, pr_id INTEGER, author TEXT, body TEXT, created_at TEXT);
    `);
    db.prepare('INSERT INTO issues (id, title, body, status, creator) VALUES (35, ?, ?, ?, ?)').run('issue local 35', '', 'open', 'athena');
    db.prepare('INSERT INTO tbc_prs (id, title, summary, base_branch, head_branch, status) VALUES (35, ?, ?, ?, ?, ?)').run('pr local 35', '', 'main', 'branch', 'open');
    registerObjectRef(db, 'issue', 35, '2026-01-01T00:00:00Z');
    registerObjectRef(db, 'tbc_pr', 35, '2026-01-01T00:00:01Z');

    const typed = resolveReferencedObjectJson(db, 'Review Issue #35 and PR 35');
    assert.deepEqual(typed.map(x => x.type).sort(), ['issue', 'tbc_pr']);
    assert.equal(typed.find(x => x.type === 'issue').issue.title, 'issue local 35');
    assert.equal(typed.find(x => x.type === 'tbc_pr').pr.title, 'pr local 35');

    const bare = resolveReferencedObjectJson(db, 'Review #1');
    assert.equal(bare.length, 1);
    assert.equal(bare[0].type, 'issue');
  });

  it('extracts focused refs as both global bare ids and typed local ids', () => {
    assert.deepEqual(
      extractFocusedRefIds('Issue #301, TBC PR 35, and #77').sort(),
      ['301', '77', 'issue:301', 'tbc_pr:35'].sort(),
    );
  });
});
