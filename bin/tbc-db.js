#!/usr/bin/env node

/**
 * tbc-db — CLI for agent communication via SQLite
 * 
 * Usage: tbc-db <command> [options]
 * 
 * The DB_PATH environment variable must point to the project's database file.
 * The orchestrator sets this automatically when spawning agents.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { parseArgs } from 'node:util';

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
db.pragma('foreign_keys = ON');

// Ensure schema exists
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    role TEXT,
    reports_to TEXT,
    model TEXT,
    disabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    creator TEXT NOT NULL,
    assignee TEXT,
    labels TEXT DEFAULT '',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_by TEXT,
    closed_at TEXT,
    closed_by TEXT
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT NOT NULL,
    cycles_budget INTEGER DEFAULT 20,
    cycles_used INTEGER DEFAULT 0,
    branch_name TEXT,
    parent_milestone_id TEXT,
    linked_pr_id INTEGER,
    failure_reason TEXT,
    phase TEXT DEFAULT 'implementation',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tbc_prs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    milestone_id TEXT,
    parent_pr_id INTEGER,
    epoch_index TEXT,
    branch_name TEXT,
    base_branch TEXT NOT NULL,
    head_branch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'merged', 'closed')),
    decision TEXT,
    decision_reason TEXT DEFAULT '',
    issue_ids TEXT DEFAULT '[]',
    test_status TEXT DEFAULT 'unknown',
    github_pr_number INTEGER,
    github_pr_url TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  UPDATE tbc_prs
  SET status = CASE
    WHEN status = 'merged' THEN 'merged'
    WHEN status IN ('closed', 'completed', 'superseded') THEN 'closed'
    ELSE 'open'
  END
  WHERE status NOT IN ('open', 'merged', 'closed');

  CREATE TRIGGER IF NOT EXISTS tbc_prs_status_insert_check
  BEFORE INSERT ON tbc_prs
  FOR EACH ROW
  WHEN NEW.status NOT IN ('open', 'merged', 'closed')
  BEGIN
    SELECT RAISE(ABORT, 'invalid tbc_prs.status');
  END;

  CREATE TRIGGER IF NOT EXISTS tbc_prs_status_update_check
  BEFORE UPDATE OF status ON tbc_prs
  FOR EACH ROW
  WHEN NEW.status NOT IN ('open', 'merged', 'closed')
  BEGIN
    SELECT RAISE(ABORT, 'invalid tbc_prs.status');
  END;
`);

const command = process.argv[2];
try { db.exec('ALTER TABLE issues ADD COLUMN updated_by TEXT'); } catch {}
try { db.exec('ALTER TABLE issues ADD COLUMN closed_by TEXT'); } catch {}
try { db.exec('ALTER TABLE milestones ADD COLUMN title TEXT'); } catch {}
try { db.exec('ALTER TABLE milestones ADD COLUMN branch_name TEXT'); } catch {}
try { db.exec('ALTER TABLE milestones ADD COLUMN milestone_id TEXT'); } catch {}
try { db.exec('ALTER TABLE milestones ADD COLUMN parent_milestone_id TEXT'); } catch {}
try { db.exec('ALTER TABLE milestones ADD COLUMN linked_pr_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE milestones ADD COLUMN failure_reason TEXT'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN milestone_id TEXT'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN parent_pr_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN epoch_index TEXT'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN branch_name TEXT'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN decision TEXT'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN decision_reason TEXT DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN actor TEXT'); } catch {}
try { db.exec('ALTER TABLE tbc_prs ADD COLUMN updated_by TEXT'); } catch {}

const args = process.argv.slice(3);

// --- Visibility enforcement ---
const visibility = process.env.TBC_VISIBILITY || 'full';
const focusedIssues = (process.env.TBC_FOCUSED_ISSUES || '').split(',').map(s => s.trim()).filter(Boolean);

if (visibility === 'blind' || visibility === 'focused') {
  const allowedCommands = new Set(['issue-create', 'pr-create']);
  if (command && !allowedCommands.has(command)) {
    const scope = visibility === 'blind' ? 'blind' : 'focused';
    console.error(`Access denied: you are in ${scope} mode and cannot view the issue tracker or PR board.`);
    process.exit(1);
  }
}

const VALID_PR_STATUSES = new Set(['open', 'merged', 'closed']);

function normalizePrStatus(status) {
  if (!status) return 'open';
  if (status === 'merged') return 'merged';
  if (['closed', 'completed', 'superseded'].includes(status)) return 'closed';
  if (['open', 'draft', 'ready_for_review', 'ready_for_ci', 'in_progress'].includes(status)) return 'open';
  throw new Error(`Invalid PR status: ${status}. Allowed: open, merged, closed`);
}

function resolveAllowedIssueCloser(issueCreator) {
  if (issueCreator === 'human' || issueCreator === 'chat') {
    return { allowed: new Set(['human', 'chat']), special: 'chat-human' };
  }

  return { allowed: new Set([issueCreator, 'athena']), special: 'agent-athena' };
}

function jsonOut(data) {
  console.log(JSON.stringify(data, null, 2));
}

function assertPrCreateActor(actor) {
  if (actor !== 'ares') {
    throw new Error(`Only ares may create epoch PRs. Got: ${actor || '(missing actor)'}`);
  }
}

function assertPrDecisionActor(actor, status) {
  if (!status || status === 'open') return;
  if (actor !== 'apollo') {
    throw new Error(`Only apollo may mark an epoch PR as ${status}. Got: ${actor || '(missing actor)'}`);
  }
}

function assertPrEditActor(actor, current, nextStatus) {
  if (!actor) throw new Error('Missing --actor for PR mutation');
  const targetStatus = nextStatus || current.status;
  assertPrDecisionActor(actor, targetStatus);
  if (targetStatus === 'open' && !new Set(['ares', 'apollo', current.actor]).has(actor)) {
    throw new Error(`Only ${current.actor || 'ares'}, ares, or apollo may edit epoch PR #${current.id}. Got: ${actor}`);
  }
}

function textOut(rows, columns) {
  if (!rows || rows.length === 0) {
    console.log('(no results)');
    return;
  }
  // Simple table output
  for (const row of rows) {
    const parts = columns.map(c => `${c}: ${row[c] ?? ''}`);
    console.log(parts.join(' | '));
  }
}

const commands = {
  // ===== ISSUES =====
  'issue-create'() {
    const { values } = parseArgs({
      args,
      options: {
        actor: { type: 'string' },
        title: { type: 'string', short: 't' },
        body: { type: 'string', short: 'b', default: '' },
        actor: { type: 'string' },
        creator: { type: 'string', short: 'c' },
        assignee: { type: 'string', short: 'a' },
        labels: { type: 'string', short: 'l', default: '' },
      },
      strict: false,
    });
    const actor = values.actor || values.creator;
    if (!values.title || !actor) {
      console.error('Usage: tbc-db issue-create --title "..." --actor name [--body "..."] [--assignee name] [--labels "label1,label2"]');
      process.exit(1);
    }
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO issues (title, body, creator, assignee, labels, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(values.title, values.body || '', actor, values.assignee || null, values.labels || '', now, now, actor);
    console.log(`Created issue #${result.lastInsertRowid}`);
  },

  'issue-list'() {
    const { values } = parseArgs({
      args,
      options: {
        status: { type: 'string', short: 's', default: 'open' },
        assignee: { type: 'string', short: 'a' },
        actor: { type: 'string' },
        creator: { type: 'string', short: 'c' },
        label: { type: 'string', short: 'l' },
        json: { type: 'boolean', default: false },
      },
      strict: false,
    });
    let query = 'SELECT * FROM issues WHERE 1=1';
    const params = [];
    if (values.status && values.status !== 'all') {
      query += ' AND status = ?'; params.push(values.status);
    }
    if (values.assignee) {
      query += ' AND assignee = ?'; params.push(values.assignee);
    }
    if (values.creator) {
      query += ' AND creator = ?'; params.push(values.creator);
    }
    if (values.label) {
      query += ' AND labels LIKE ?'; params.push(`%${values.label}%`);
    }
    // Focused mode: only show issues in the focused set
    if (visibility === 'focused' && focusedIssues.length > 0) {
      query += ` AND id IN (${focusedIssues.map(() => '?').join(',')})`;
      params.push(...focusedIssues);
    }
    query += ' ORDER BY id DESC';
    const rows = db.prepare(query).all(...params);
    if (values.json) {
      jsonOut(rows);
    } else {
      for (const r of rows) {
        const assignee = r.assignee ? ` → ${r.assignee}` : '';
        const labels = r.labels ? ` [${r.labels}]` : '';
        console.log(`#${r.id} [${r.status}] ${r.title}${assignee}${labels} (by ${r.creator})`);
      }
      if (rows.length === 0) console.log('(no issues)');
    }
  },

  'issue-view'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db issue-view <id>'); process.exit(1); }
    if (visibility === 'focused' && focusedIssues.length > 0 && !focusedIssues.includes(String(id))) {
      console.error(`Access denied: issue #${id} is not in your focused set.`);
      process.exit(1);
    }
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id);
    if (!issue) { console.error(`Issue #${id} not found`); process.exit(1); }
    console.log(`# Issue #${issue.id}: ${issue.title}`);
    console.log(`Status: ${issue.status} | Creator: ${issue.creator} | Assignee: ${issue.assignee || 'none'}`);
    if (issue.labels) console.log(`Labels: ${issue.labels}`);
    console.log(`Created: ${issue.created_at} | Updated: ${issue.updated_at}`);
    if (issue.body) { console.log(`\n${issue.body}`); }
    // Show comments
    const comments = db.prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at').all(id);
    if (comments.length > 0) {
      console.log(`\n--- Comments (${comments.length}) ---`);
      for (const c of comments) {
        console.log(`\n[${c.author}] (${c.created_at}):`);
        console.log(c.body);
      }
    }
  },

  'issue-close'() {
    const id = args[0];
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        actor: { type: 'string' },
        closer: { type: 'string', short: 'c' },
      },
      strict: false,
    });
    const actor = values.actor || values.closer;
    if (!id || !actor) { console.error('Usage: tbc-db issue-close <id> --actor name'); process.exit(1); }
    const issue = db.prepare('SELECT id, creator, status FROM issues WHERE id = ?').get(id);
    if (!issue) { console.error(`Issue #${id} not found`); process.exit(1); }
    if (issue.status === 'closed') { console.log(`Issue #${id} already closed`); return; }
    const closer = actor;
    const { allowed, special } = resolveAllowedIssueCloser(issue.creator);
    if (!allowed.has(closer)) {
      if (special === 'chat-human') {
        console.error(`Blocked: issue #${id} was opened by ${issue.creator} and can only be closed by chat or human`);
      } else {
        console.error(`Blocked: issue #${id} was opened by ${issue.creator} and can only be closed by ${issue.creator} or athena`);
      }
      process.exit(1);
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE issues SET status = 'closed', closed_at = ?, closed_by = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(now, closer, now, closer, id);
    console.log(`Closed issue #${id}`);
  },

  'issue-edit'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db issue-edit <id> --actor name [--title "..."] [--body "..."] [--assignee name] [--labels "..."]'); process.exit(1); }
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        actor: { type: 'string' },
        editor: { type: 'string', short: 'e' },
        title: { type: 'string', short: 't' },
        body: { type: 'string', short: 'b' },
        assignee: { type: 'string', short: 'a' },
        labels: { type: 'string', short: 'l' },
      },
      strict: false,
    });
    const actor = values.actor || values.editor;
    if (!actor) { console.error('Usage: tbc-db issue-edit <id> --actor name [--title "..."] [--body "..."] [--assignee name] [--labels "..."]'); process.exit(1); }
    if (!values.actor) { console.error('Usage: tbc-db pr-edit <id> --actor name [--title "..."] [--summary "..."] [--base main] [--head branch] [--status ready_for_review] [--issues "1,2"] [--test pass]'); process.exit(1); }
    const sets = [];
    const params = [];
    if (values.title) { sets.push('title = ?'); params.push(values.title); }
    if (values.body !== undefined) { sets.push('body = ?'); params.push(values.body); }
    if (values.assignee !== undefined) { sets.push('assignee = ?'); params.push(values.assignee); }
    if (values.labels !== undefined) { sets.push('labels = ?'); params.push(values.labels); }
    if (sets.length === 0) { console.error('Nothing to update'); process.exit(1); }
    sets.push("updated_at = ?"); params.push(new Date().toISOString());
    sets.push('updated_by = ?'); params.push(actor);
    params.push(id);
    db.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    console.log(`Updated issue #${id}`);
  },

  // ===== COMMENTS =====
  'comment'() {
    const { values } = parseArgs({
      args,
      options: {
        issue: { type: 'string', short: 'i' },
        actor: { type: 'string' },
        author: { type: 'string', short: 'a' },
        body: { type: 'string', short: 'b' },
      },
      strict: false,
    });
    const actor = values.actor || values.author;
    if (!values.issue || !actor || !values.body) {
      console.error('Usage: tbc-db comment --issue <id> --actor name --body "..."');
      process.exit(1);
    }
    if (visibility === 'focused' && focusedIssues.length > 0 && !focusedIssues.includes(String(values.issue))) {
      console.error(`Access denied: issue #${values.issue} is not in your focused set.`);
      process.exit(1);
    }
    const result = db.prepare('INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(values.issue, actor, values.body, new Date().toISOString());
    db.prepare("UPDATE issues SET updated_at = ?, updated_by = ? WHERE id = ?").run(new Date().toISOString(), actor, values.issue);
    console.log(`Added comment #${result.lastInsertRowid} to issue #${values.issue}`);
  },

  'comments'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db comments <issue_id>'); process.exit(1); }
    if (visibility === 'focused' && focusedIssues.length > 0 && !focusedIssues.includes(String(id))) {
      console.error(`Access denied: issue #${id} is not in your focused set.`);
      process.exit(1);
    }
    const comments = db.prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at').all(id);
    for (const c of comments) {
      console.log(`[${c.author}] (${c.created_at}):`);
      console.log(c.body);
      console.log('');
    }
    if (comments.length === 0) console.log('(no comments)');
  },

  // ===== TBC PRS =====
  'pr-create'() {
    const { values } = parseArgs({
      args,
      options: {
        title: { type: 'string', short: 't' },
        summary: { type: 'string', short: 's', default: '' },
        milestone: { type: 'string', default: '' },
        parent: { type: 'string', default: '' },
        epoch: { type: 'string', default: '' },
        branch: { type: 'string', default: '' },
        base: { type: 'string', default: 'main' },
        head: { type: 'string' },
        status: { type: 'string', default: 'draft' },
        issues: { type: 'string', default: '' },
        test: { type: 'string', default: 'unknown' },
        actor: { type: 'string' },
        github_number: { type: 'string' },
        github_url: { type: 'string' },
      },
      strict: false,
    });
    if (!values.title || !values.head || !values.actor) {
      console.error('Usage: tbc-db pr-create --title "..." --head branch --actor name [--summary "..."] [--base main] [--milestone <id>] [--epoch <n>] [--branch <name>] [--issues "1,2"] [--test unknown]');
      process.exit(1);
    }
    try {
      assertPrCreateActor(values.actor);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    if ((values.base || 'main') === values.head) {
      console.error('Error: base and head branches must differ for a TBC PR record.');
      process.exit(1);
    }
    const now = new Date().toISOString();
    const normalizedStatus = normalizePrStatus(values.status);
    if (normalizedStatus !== 'open') {
      console.error('Error: epoch PRs must be created in open status. Apollo decides merged/closed later.');
      process.exit(1);
    }
    const issueIds = values.issues
      ? JSON.stringify(values.issues.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite))
      : '[]';
    const result = db.prepare(`INSERT INTO tbc_prs
      (title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, actor, updated_by, github_pr_number, github_pr_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        values.title,
        values.summary || '',
        values.milestone || null,
        values.parent ? Number(values.parent) : null,
        values.epoch || null,
        values.branch || values.head,
        values.base || 'main',
        values.head,
        normalizedStatus,
        null,
        '',
        issueIds,
        values.test || 'unknown',
        values.actor,
        values.actor,
        values.github_number ? Number(values.github_number) : null,
        values.github_url || null,
        now,
        now,
      );
    console.log(`Created TBC PR #${result.lastInsertRowid}`);
  },

  'pr-list'() {
    const { values } = parseArgs({
      args,
      options: {
        status: { type: 'string', default: 'open' },
        json: { type: 'boolean', default: false },
      },
      strict: false,
    });
    let query = 'SELECT * FROM tbc_prs';
    const params = [];
    if (values.status && values.status !== 'all') {
      const normalizedStatus = normalizePrStatus(values.status);
      query += ' WHERE status = ?';
      params.push(normalizedStatus);
    }
    query += ' ORDER BY updated_at DESC, id DESC';
    const rows = db.prepare(query).all(...params).map(row => ({
      ...row,
      issue_ids: (() => { try { return JSON.parse(row.issue_ids || '[]'); } catch { return []; } })(),
    }));
    if (values.json) {
      jsonOut(rows);
    } else {
      for (const row of rows) {
        const issues = row.issue_ids.length ? ` issues=${row.issue_ids.join(',')}` : '';
        const milestone = row.milestone_id ? ` milestone=${row.milestone_id}` : '';
        const epoch = row.epoch_index ? ` epoch=${row.epoch_index}` : '';
        const actor = row.actor ? ` actor=${row.actor}` : '';
        console.log(`#${row.id} [${row.status}] ${row.title} (${row.head_branch} -> ${row.base_branch}) test=${row.test_status}${issues}${milestone}${epoch}${actor}`);
      }
      if (rows.length === 0) console.log('(no TBC PRs)');
    }
  },

  'pr-view'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db pr-view <id>'); process.exit(1); }
    const pr = db.prepare('SELECT * FROM tbc_prs WHERE id = ?').get(id);
    if (!pr) { console.error(`TBC PR #${id} not found`); process.exit(1); }
    console.log(`# TBC PR #${pr.id}: ${pr.title}`);
    console.log(`Status: ${pr.status} | Base: ${pr.base_branch} | Head: ${pr.head_branch} | Test: ${pr.test_status}`);
    console.log(`Created: ${pr.created_at} | Updated: ${pr.updated_at}`);
    if (pr.epoch_index != null) console.log(`Epoch: ${pr.epoch_index}`);
    if (pr.milestone_id != null) console.log(`Milestone: ${pr.milestone_id}`);
    if (pr.parent_pr_id != null) console.log(`Parent PR: ${pr.parent_pr_id}`);
    if (pr.branch_name) console.log(`Branch: ${pr.branch_name}`);
    if (pr.decision) console.log(`Decision: ${pr.decision}`);
    if (pr.decision_reason) console.log(`Decision Reason: ${pr.decision_reason}`);
    const issueIds = (() => { try { return JSON.parse(pr.issue_ids || '[]'); } catch { return []; } })();
    if (issueIds.length) console.log(`Issues: ${issueIds.join(', ')}`);
    if (pr.github_pr_number || pr.github_pr_url) {
      console.log(`GitHub mirror: #${pr.github_pr_number || '?'} ${pr.github_pr_url || ''}`.trim());
    }
    if (pr.summary) console.log(`\n${pr.summary}`);
  },

  'pr-edit'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db pr-edit <id> --actor name [--title "..."] [--summary "..."] [--milestone <id>] [--parent <prId>] [--epoch <n>] [--branch <name>] [--base main] [--head branch] [--status open|merged|closed] [--decision merge|close] [--decision-reason "..."] [--issues "1,2"] [--test pass]'); process.exit(1); }
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        actor: { type: 'string' },
        title: { type: 'string', short: 't' },
        summary: { type: 'string', short: 's' },
        milestone: { type: 'string' },
        parent: { type: 'string' },
        epoch: { type: 'string' },
        branch: { type: 'string' },
        base: { type: 'string' },
        head: { type: 'string' },
        status: { type: 'string' },
        decision: { type: 'string' },
        'decision-reason': { type: 'string' },
        issues: { type: 'string' },
        test: { type: 'string' },
        github_number: { type: 'string' },
        github_url: { type: 'string' },
      },
      strict: false,
    });
    if (!values.actor) { console.error('Usage: tbc-db pr-edit <id> --actor name [--title "..."] [--summary "..."] [--milestone <id>] [--parent <prId>] [--epoch <n>] [--branch <name>] [--base main] [--head branch] [--status open|merged|closed] [--decision merge|close] [--decision-reason "..."] [--issues "1,2"] [--test pass]'); process.exit(1); }
    const current = db.prepare('SELECT id, base_branch, head_branch, actor, status FROM tbc_prs WHERE id = ?').get(id);
    if (!current) { console.error(`TBC PR #${id} not found`); process.exit(1); }
    const nextStatus = values.status !== undefined ? normalizePrStatus(values.status) : null;
    try {
      assertPrEditActor(values.actor, current, nextStatus);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    const sets = [];
    const params = [];
    if (values.title !== undefined) { sets.push('title = ?'); params.push(values.title); }
    if (values.summary !== undefined) { sets.push('summary = ?'); params.push(values.summary); }
    if (values.milestone !== undefined) { sets.push('milestone_id = ?'); params.push(values.milestone || null); }
    if (values.parent !== undefined) { sets.push('parent_pr_id = ?'); params.push(values.parent ? Number(values.parent) : null); }
    if (values.epoch !== undefined) { sets.push('epoch_index = ?'); params.push(values.epoch || null); }
    if (values.branch !== undefined) { sets.push('branch_name = ?'); params.push(values.branch || null); }
    if (values.base !== undefined) { sets.push('base_branch = ?'); params.push(values.base); }
    const nextBase = values.base;
    const nextHead = values.head;
    if (values.head !== undefined) { sets.push('head_branch = ?'); params.push(values.head); }
    if (values.status !== undefined) { sets.push('status = ?'); params.push(nextStatus); }
    if (values.decision !== undefined) { sets.push('decision = ?'); params.push(values.decision || null); }
    if (values['decision-reason'] !== undefined) { sets.push('decision_reason = ?'); params.push(values['decision-reason'] || ''); }
    if (values.issues !== undefined) {
      const issueIds = JSON.stringify(values.issues.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite));
      sets.push('issue_ids = ?'); params.push(issueIds);
    }
    if (values.test !== undefined) { sets.push('test_status = ?'); params.push(values.test); }
    if (values.github_number !== undefined) { sets.push('github_pr_number = ?'); params.push(values.github_number ? Number(values.github_number) : null); }
    if (values.github_url !== undefined) { sets.push('github_pr_url = ?'); params.push(values.github_url || null); }
    if (sets.length === 0) { console.error('Nothing to update'); process.exit(1); }
    const finalBase = nextBase !== undefined ? nextBase : current.base_branch;
    const finalHead = nextHead !== undefined ? nextHead : current.head_branch;
    if (finalBase === finalHead) {
      console.error('Error: base and head branches must differ for a TBC PR record.');
      process.exit(1);
    }
    sets.push('updated_at = ?'); params.push(new Date().toISOString());
    sets.push('updated_by = ?'); params.push(values.actor);
    params.push(id);
    db.prepare(`UPDATE tbc_prs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    console.log(`Updated TBC PR #${id}`);
  },

  // ===== QUERY =====
  'query'() {
    const sql = args.join(' ');
    if (!sql) { console.error('Usage: tbc-db query "SELECT ..."'); process.exit(1); }
    try {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const rows = db.prepare(sql).all();
        jsonOut(rows);
      } else {
        const result = db.prepare(sql).run();
        console.log(`Changes: ${result.changes}`);
      }
    } catch (e) {
      console.error(`SQL error: ${e.message}`);
      process.exit(1);
    }
  },

  'help'() {
    console.log(`tbc-db — Agent communication database

Issues:
  issue-create  --title "..." --creator name [--body "..."] [--assignee name] [--labels "..."]
  issue-list    [--status open|closed|all] [--assignee name] [--creator name] [--label name] [--json]
  issue-view    <id>
  issue-edit    <id> --editor name [--title "..."] [--body "..."] [--assignee name] [--labels "..."]
  issue-close   <id> --closer name

Comments:
  comment       --issue <id> --author name --body "..."
  comments      <issue_id>

TBC PRs:
  pr-create     --title "..." --head branch --actor ares [--summary "..."] [--milestone <id>] [--parent <prId>] [--epoch <n>] [--branch <name>] [--base main] [--issues "1,2"] [--test unknown]
  pr-list       [--status open|merged|closed|all] [--json]
  pr-view       <id>
  pr-edit       <id> --actor name [--title "..."] [--summary "..."] [--milestone <id>] [--parent <prId>] [--epoch <n>] [--branch <name>] [--base main] [--head branch] [--status open|merged|closed] [--decision merge|close] [--decision-reason "..."] [--issues "1,2"] [--test pass]

Advanced:
  query         "SQL statement"
  help          Show this help
`);
  }
};

if (!command || !commands[command]) {
  if (command) console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(command ? 1 : 0);
}

commands[command]();
db.close();
