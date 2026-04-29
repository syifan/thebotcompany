import { registerObjectRef } from './object-refs.js';

export function resolveAllowedIssueClosers(runner, deps = {}, issueCreator) {
    if (issueCreator === 'human' || issueCreator === 'chat') {
      return { allowed: new Set(['human', 'chat']), special: 'chat-human' };
    }
    return { allowed: new Set([issueCreator, 'athena']), special: 'agent-athena' };
  }

export async function getIssues(runner, deps = {}) {
    try {
      const db = runner.getDb();
      const issues = db.prepare(`
        SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id) as comment_count
        FROM issues i ORDER BY i.created_at DESC
      `).all();
      db.close();
      return issues;
    } catch {
      return [];
    }
  }

export async function createIssue(runner, deps = {}, title, body = '', creator = 'human', assignee = null) {
    if (!title?.trim()) throw new Error('Missing issue title');
    try {
      const db = runner.getDb();
      const now = new Date().toISOString();
      const result = db.prepare(
        `INSERT INTO issues (title, body, creator, assignee, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(title.trim(), body.trim(), creator, assignee || null, now, now);
      const ref = registerObjectRef(db, 'issue', result.lastInsertRowid, now);
      db.close();
      return { success: true, issueId: result.lastInsertRowid, objectId: ref?.id || result.lastInsertRowid };
    } catch (e) {
      throw new Error(`Failed to create issue: ${e.message}`);
    }
  }
