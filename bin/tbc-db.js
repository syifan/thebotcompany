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
import { parseArgs } from 'node:util';

const dbPath = process.env.TBC_DB;
if (!dbPath) {
  console.error('Error: TBC_DB environment variable not set');
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
    closed_at TEXT
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
    description TEXT NOT NULL,
    cycles_budget INTEGER DEFAULT 20,
    cycles_used INTEGER DEFAULT 0,
    phase TEXT DEFAULT 'implementation',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at TEXT
  );

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
  );
`);

const command = process.argv[2];
const args = process.argv.slice(3);

// --- Visibility enforcement ---
const visibility = process.env.TBC_VISIBILITY || 'full';
const focusedIssues = (process.env.TBC_FOCUSED_ISSUES || '').split(',').map(s => s.trim()).filter(Boolean);

if (visibility === 'blind') {
  // Blind agents cannot use tbc-db at all (except issue-create for escalation)
  if (command && command !== 'issue-create') {
    console.error('Access denied: you are in blind mode and cannot query the tracker.');
    process.exit(1);
  }
}

// For focused mode, we filter after query execution (see below)

function jsonOut(data) {
  console.log(JSON.stringify(data, null, 2));
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
        title: { type: 'string', short: 't' },
        body: { type: 'string', short: 'b', default: '' },
        creator: { type: 'string', short: 'c' },
        assignee: { type: 'string', short: 'a' },
        labels: { type: 'string', short: 'l', default: '' },
      },
      strict: false,
    });
    if (!values.title || !values.creator) {
      console.error('Usage: tbc-db issue-create --title "..." --creator agent_name [--body "..."] [--assignee name] [--labels "label1,label2"]');
      process.exit(1);
    }
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO issues (title, body, creator, assignee, labels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(values.title, values.body || '', values.creator, values.assignee || null, values.labels || '', now, now);
    console.log(`Created issue #${result.lastInsertRowid}`);
  },

  'issue-list'() {
    const { values } = parseArgs({
      args,
      options: {
        status: { type: 'string', short: 's', default: 'open' },
        assignee: { type: 'string', short: 'a' },
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
    if (!id) { console.error('Usage: tbc-db issue-close <id>'); process.exit(1); }
    const now = new Date().toISOString();
    db.prepare("UPDATE issues SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    console.log(`Closed issue #${id}`);
  },

  'issue-edit'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db issue-edit <id> [--title "..."] [--body "..."] [--assignee name] [--labels "..."]'); process.exit(1); }
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        title: { type: 'string', short: 't' },
        body: { type: 'string', short: 'b' },
        assignee: { type: 'string', short: 'a' },
        labels: { type: 'string', short: 'l' },
      },
      strict: false,
    });
    const sets = [];
    const params = [];
    if (values.title) { sets.push('title = ?'); params.push(values.title); }
    if (values.body !== undefined) { sets.push('body = ?'); params.push(values.body); }
    if (values.assignee !== undefined) { sets.push('assignee = ?'); params.push(values.assignee); }
    if (values.labels !== undefined) { sets.push('labels = ?'); params.push(values.labels); }
    if (sets.length === 0) { console.error('Nothing to update'); process.exit(1); }
    sets.push("updated_at = ?"); params.push(new Date().toISOString());
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
        author: { type: 'string', short: 'a' },
        body: { type: 'string', short: 'b' },
      },
      strict: false,
    });
    if (!values.issue || !values.author || !values.body) {
      console.error('Usage: tbc-db comment --issue <id> --author agent_name --body "..."');
      process.exit(1);
    }
    if (visibility === 'focused' && focusedIssues.length > 0 && !focusedIssues.includes(String(values.issue))) {
      console.error(`Access denied: issue #${values.issue} is not in your focused set.`);
      process.exit(1);
    }
    const result = db.prepare('INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(values.issue, values.author, values.body, new Date().toISOString());
    db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), values.issue);
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
        base: { type: 'string', default: 'main' },
        head: { type: 'string' },
        status: { type: 'string', default: 'draft' },
        issues: { type: 'string', default: '' },
        test: { type: 'string', default: 'unknown' },
        github_number: { type: 'string' },
        github_url: { type: 'string' },
      },
      strict: false,
    });
    if (!values.title || !values.head) {
      console.error('Usage: tbc-db pr-create --title "..." --head branch [--summary "..."] [--base main] [--status draft] [--issues "1,2"] [--test unknown]');
      process.exit(1);
    }
    const now = new Date().toISOString();
    const issueIds = values.issues
      ? JSON.stringify(values.issues.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite))
      : '[]';
    const result = db.prepare(`INSERT INTO tbc_prs
      (title, summary, base_branch, head_branch, status, issue_ids, test_status, github_pr_number, github_pr_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        values.title,
        values.summary || '',
        values.base || 'main',
        values.head,
        values.status || 'draft',
        issueIds,
        values.test || 'unknown',
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
    if (values.status === 'open') {
      query += ` WHERE status != 'completed'`;
    } else if (values.status && values.status !== 'all') {
      query += ' WHERE status = ?';
      params.push(values.status);
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
        console.log(`#${row.id} [${row.status}] ${row.title} (${row.head_branch} -> ${row.base_branch}) test=${row.test_status}${issues}`);
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
    const issueIds = (() => { try { return JSON.parse(pr.issue_ids || '[]'); } catch { return []; } })();
    if (issueIds.length) console.log(`Issues: ${issueIds.join(', ')}`);
    if (pr.github_pr_number || pr.github_pr_url) {
      console.log(`GitHub mirror: #${pr.github_pr_number || '?'} ${pr.github_pr_url || ''}`.trim());
    }
    if (pr.summary) console.log(`\n${pr.summary}`);
  },

  'pr-edit'() {
    const id = args[0];
    if (!id) { console.error('Usage: tbc-db pr-edit <id> [--title "..."] [--summary "..."] [--base main] [--head branch] [--status ready_for_review] [--issues "1,2"] [--test pass]'); process.exit(1); }
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        title: { type: 'string', short: 't' },
        summary: { type: 'string', short: 's' },
        base: { type: 'string' },
        head: { type: 'string' },
        status: { type: 'string' },
        issues: { type: 'string' },
        test: { type: 'string' },
        github_number: { type: 'string' },
        github_url: { type: 'string' },
      },
      strict: false,
    });
    const sets = [];
    const params = [];
    if (values.title !== undefined) { sets.push('title = ?'); params.push(values.title); }
    if (values.summary !== undefined) { sets.push('summary = ?'); params.push(values.summary); }
    if (values.base !== undefined) { sets.push('base_branch = ?'); params.push(values.base); }
    if (values.head !== undefined) { sets.push('head_branch = ?'); params.push(values.head); }
    if (values.status !== undefined) { sets.push('status = ?'); params.push(values.status); }
    if (values.issues !== undefined) {
      const issueIds = JSON.stringify(values.issues.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite));
      sets.push('issue_ids = ?'); params.push(issueIds);
    }
    if (values.test !== undefined) { sets.push('test_status = ?'); params.push(values.test); }
    if (values.github_number !== undefined) { sets.push('github_pr_number = ?'); params.push(values.github_number ? Number(values.github_number) : null); }
    if (values.github_url !== undefined) { sets.push('github_pr_url = ?'); params.push(values.github_url || null); }
    if (sets.length === 0) { console.error('Nothing to update'); process.exit(1); }
    sets.push('updated_at = ?'); params.push(new Date().toISOString());
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
  issue-edit    <id> [--title "..."] [--body "..."] [--assignee name] [--labels "..."]
  issue-close   <id>

Comments:
  comment       --issue <id> --author name --body "..."
  comments      <issue_id>

TBC PRs:
  pr-create     --title "..." --head branch [--summary "..."] [--base main] [--status draft] [--issues "1,2"] [--test unknown]
  pr-list       [--status open|all|draft|ready_for_review|completed] [--json]
  pr-view       <id>
  pr-edit       <id> [--title "..."] [--summary "..."] [--base main] [--head branch] [--status ready_for_review] [--issues "1,2"] [--test pass]

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
