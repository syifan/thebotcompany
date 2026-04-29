import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

function syncAgentRegistry(db, runner, { root }) {
  const upsert = db.prepare(`
    INSERT INTO agents (name, role, reports_to, model, disabled)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      role = excluded.role,
      reports_to = excluded.reports_to,
      model = excluded.model,
      disabled = excluded.disabled
  `);
  const managersDir = path.join(root, 'agent', 'managers');
  const workersDir = runner.workerSkillsDir;
  const parseRole = (content) => (content.match(/^role:\s*(.+)$/m) || [])[1]?.trim() || null;
  const parseModel = (content) => (content.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null;

  if (fs.existsSync(managersDir)) {
    for (const file of fs.readdirSync(managersDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
      const name = file.replace('.md', '');
      const disabled = /^disabled:\s*true$/m.test(content) ? 1 : 0;
      upsert.run(name, parseRole(content), null, parseModel(content), disabled);
    }
  }

  if (fs.existsSync(workersDir)) {
    for (const file of fs.readdirSync(workersDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
      const name = file.replace('.md', '');
      const disabled = /^disabled:\s*true$/m.test(content) ? 1 : 0;
      const reportsTo = (content.match(/^reports_to:\s*(.+)$/m) || [])[1]?.trim() || null;
      upsert.run(name, parseRole(content), reportsTo, parseModel(content), disabled);
    }
  }
}

export function openProjectDb(runner, { root }) {
  const db = new Database(runner.projectDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, role TEXT, reports_to TEXT, model TEXT, disabled INTEGER DEFAULT 0, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
    CREATE TABLE IF NOT EXISTS issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT DEFAULT '', status TEXT DEFAULT 'open', creator TEXT NOT NULL, assignee TEXT, labels TEXT DEFAULT '', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_by TEXT, closed_at TEXT, closed_by TEXT);
    CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL REFERENCES issues(id), author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
    CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, milestone_id TEXT UNIQUE, title TEXT, description TEXT NOT NULL, cycles_budget INTEGER DEFAULT 20, cycles_used INTEGER DEFAULT 0, branch_name TEXT, parent_milestone_id TEXT, linked_pr_id INTEGER, failure_reason TEXT, phase TEXT DEFAULT 'implementation', status TEXT DEFAULT 'active', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS tbc_prs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, summary TEXT DEFAULT '', milestone_id TEXT, parent_pr_id INTEGER, epoch_index TEXT, branch_name TEXT, base_branch TEXT NOT NULL, head_branch TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'merged', 'closed')), decision TEXT, decision_reason TEXT DEFAULT '', issue_ids TEXT DEFAULT '[]', test_status TEXT DEFAULT 'unknown', github_pr_number INTEGER, github_pr_url TEXT, actor TEXT, updated_by TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
  `);
  try { db.exec('ALTER TABLE issues ADD COLUMN updated_by TEXT'); } catch {}
  try { db.exec('ALTER TABLE issues ADD COLUMN closed_by TEXT'); } catch {}
  try { db.exec('ALTER TABLE milestones ADD COLUMN milestone_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE milestones ADD COLUMN title TEXT'); } catch {}
  try { db.exec('ALTER TABLE milestones ADD COLUMN branch_name TEXT'); } catch {}
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
  db.exec(`
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
  syncAgentRegistry(db, runner, { root });
  return db;
}

export function getProjectCostSummary(runner) {
  const empty = { totalCost: 0, last24hCost: 0, lastCycleCost: 0, avgCycleCost: 0, lastCycleDuration: 0, avgCycleDuration: 0, agents: {} };
  try {
    const db = runner.getDb();
    try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
    try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const totalCost = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports').get().v;
    const last24hCost = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports WHERE created_at > ?').get(cutoff).v;
    const cycles = db.prepare('SELECT cycle, SUM(cost) as cost, SUM(duration_ms) as duration FROM reports WHERE cost IS NOT NULL GROUP BY cycle ORDER BY cycle ASC').all();
    let lastCycleCost = 0, avgCycleCost = 0, lastCycleDuration = 0, avgCycleDuration = 0;
    if (cycles.length > 0) {
      const last = cycles[cycles.length - 1];
      lastCycleCost = last.cost || 0;
      lastCycleDuration = last.duration || 0;
      const totalCycleCost = cycles.reduce((s, c) => s + (c.cost || 0), 0);
      const totalCycleDuration = cycles.reduce((s, c) => s + (c.duration || 0), 0);
      avgCycleCost = totalCycleCost / cycles.length;
      avgCycleDuration = totalCycleDuration / cycles.length;
    }
    const agentRows = db.prepare(`SELECT agent,
      COALESCE(SUM(cost), 0) as totalCost,
      COALESCE(SUM(CASE WHEN created_at > ? THEN cost ELSE 0 END), 0) as last24hCost,
      COUNT(*) as callCount
      FROM reports WHERE cost IS NOT NULL GROUP BY agent`).all(cutoff);
    const agents = {};
    for (const row of agentRows) {
      const lastCall = db.prepare('SELECT cost FROM reports WHERE agent = ? AND cost IS NOT NULL ORDER BY id DESC LIMIT 1').get(row.agent);
      agents[row.agent] = {
        totalCost: row.totalCost,
        last24hCost: row.last24hCost,
        callCount: row.callCount,
        lastCallCost: lastCall?.cost || 0,
        avgCallCost: row.callCount > 0 ? row.totalCost / row.callCount : 0,
      };
    }
    db.close();
    return { totalCost, last24hCost, lastCycleCost, avgCycleCost, lastCycleDuration, avgCycleDuration, agents };
  } catch {
    return empty;
  }
}

function ensureReportsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle INTEGER NOT NULL,
    agent TEXT NOT NULL,
    body TEXT NOT NULL,
    summary TEXT,
    milestone_id TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN input_tokens INTEGER'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN output_tokens INTEGER'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN cache_read_tokens INTEGER'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN success INTEGER'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN model TEXT'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN timed_out INTEGER'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN key_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}
  try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
}

export function writeRunnerReport(runner, agentName, body, metadata = {}) {
  const {
    cost = null,
    durationMs = 0,
    inputTokens = null,
    outputTokens = null,
    cacheReadTokens = null,
    success = true,
    model = null,
    timedOut = false,
    keyId = null,
    visibilityMode = 'full',
    visibilityIssues = [],
    preformatted = false,
  } = metadata;
  const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
  const startedAt = new Date();
  const endedAt = new Date();
  const reportBody = preformatted
    ? body.trim()
    : `> ⏱ Started: ${startedAt.toLocaleString('sv-SE')} | Ended: ${endedAt.toLocaleString('sv-SE')} | Duration: ${durationStr}\n\n${body.trim()}`;
  const db = runner.getDb();
  ensureReportsTable(db);
  db.prepare(`INSERT INTO reports (cycle, agent, body, created_at, cost, duration_ms, input_tokens, output_tokens, cache_read_tokens, success, model, timed_out, key_id, visibility_mode, visibility_issues, milestone_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    runner.cycleCount, agentName, reportBody, new Date().toISOString(),
    cost, durationMs,
    inputTokens, outputTokens, cacheReadTokens,
    success ? 1 : 0, model, timedOut ? 1 : 0,
    keyId,
    visibilityMode, JSON.stringify(visibilityIssues), runner.currentMilestoneId || null,
  );
  const reportId = db.prepare('SELECT last_insert_rowid() as id').get().id;
  db.close();
  return { reportId, reportBody };
}


function normalizePrRow(pr) {
  if (!pr) return null;
  return {
    ...pr,
    number: pr.id,
    headRefName: pr.head_branch,
    baseRefName: pr.base_branch,
    shortTitle: pr.title,
    issueIds: (() => { try { return JSON.parse(pr.issue_ids || '[]'); } catch { return []; } })(),
  };
}

export function getProjectComments(runner, author, page = 1, perPage = 20) {
  try {
    const db = runner.getDb();
    let query, countQuery, params;
    if (author) {
      query = `SELECT c.id, c.issue_id, c.author, c.body, c.created_at FROM comments c WHERE c.author = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM comments WHERE author = ?`;
      params = [author, perPage, (page - 1) * perPage];
    } else {
      query = `SELECT c.id, c.issue_id, c.author, c.body, c.created_at FROM comments c ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM comments`;
      params = [perPage, (page - 1) * perPage];
    }
    const comments = db.prepare(query).all(...params).map(c => ({ ...c, agent: c.author }));
    const { total } = author ? db.prepare(countQuery).get(author) : db.prepare(countQuery).get();
    db.close();
    return { comments, total, page, perPage, hasMore: page * perPage < total };
  } catch (e) {
    return { comments: [], total: 0, error: e.message };
  }
}

export function getProjectPrs(runner, status = 'open') {
  try {
    const db = runner.getDb();
    let query = `
      SELECT id, title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, github_pr_number, github_pr_url, actor, updated_by, created_at, updated_at
      FROM tbc_prs
    `;
    const params = [];
    if (status === 'open' || status === 'merged' || status === 'closed') {
      query += ` WHERE status = ?`;
      params.push(status);
    }
    query += `
      ORDER BY updated_at DESC, id DESC
      LIMIT 50
    `;
    const prs = db.prepare(query).all(...params);
    db.close();
    return prs.map(normalizePrRow);
  } catch {
    return [];
  }
}

export function getProjectPr(runner, prId) {
  try {
    const db = runner.getDb();
    const pr = db.prepare(`
      SELECT id, title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, github_pr_number, github_pr_url, actor, updated_by, created_at, updated_at
      FROM tbc_prs
      WHERE id = ?
    `).get(prId);
    db.close();
    return normalizePrRow(pr);
  } catch {
    return null;
  }
}

export function getOpenEpochPrForBranch(runner, branchName) {
  try {
    const db = runner.getDb();
    const pr = db.prepare(`
      SELECT * FROM tbc_prs
      WHERE status = 'open'
        AND (
          (branch_name IS NOT NULL AND branch_name = ?)
          OR head_branch = ?
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(branchName || '', branchName || '');
    db.close();
    return pr || null;
  } catch {
    return null;
  }
}

export function decideProjectEpochPr(runner, pr, status, { actor = 'apollo', reason = '' } = {}) {
  if (!pr) return null;
  try {
    const db = runner.getDb();
    const normalizedStatus = status === 'merged' ? 'merged' : 'closed';
    db.prepare(`
      UPDATE tbc_prs
      SET status = ?, decision = ?, decision_reason = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      normalizedStatus,
      normalizedStatus === 'merged' ? 'merge' : 'close',
      reason || '',
      actor,
      new Date().toISOString(),
      pr.id,
    );
    db.close();
    return { ...pr, status: normalizedStatus, decision: normalizedStatus === 'merged' ? 'merge' : 'close', decision_reason: reason || '' };
  } catch {
    return null;
  }
}
