import { readJson, sendJson } from '../../http.js';
import { registerObjectRef } from '../../../orchestrator/object-refs.js';

export async function handleProjectIssueRoutes(req, res, url, ctx) {
  const { runner, subPath, requireWrite } = ctx;

  const issueDetailMatch = req.method === 'GET' && subPath.match(/^issues\/(\d+)$/);
  if (issueDetailMatch) {
    try {
      const issueId = parseInt(issueDetailMatch[1], 10);
      const db = runner.getDb();
      const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId);
      const comments = issue ? db.prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC').all(issueId) : [];
      db.close();
      if (!issue) sendJson(res, 404, { error: 'Issue not found' });
      else sendJson(res, 200, { issue, comments });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const commentPostMatch = req.method === 'POST' && subPath.match(/^issues\/(\d+)\/comments$/);
  if (commentPostMatch) {
    if (!requireWrite(req, res)) return true;
    try {
      const issueId = parseInt(commentPostMatch[1], 10);
      const { author, body: commentBody } = await readJson(req);
      if (!commentBody?.trim()) {
        sendJson(res, 400, { error: 'Comment body required' });
        return true;
      }
      const db = runner.getDb();
      const now = new Date().toISOString();
      const result = db.prepare('INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(issueId, author || 'human', commentBody.trim(), now);
      const ref = registerObjectRef(db, 'comment', result.lastInsertRowid, now);
      db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
      db.close();
      sendJson(res, 200, { id: ref?.id || result.lastInsertRowid, localId: result.lastInsertRowid });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const issuePatchMatch = req.method === 'PATCH' && subPath.match(/^issues\/(\d+)$/);
  if (issuePatchMatch) {
    if (!requireWrite(req, res)) return true;
    let db = null;
    try {
      const issueId = parseInt(issuePatchMatch[1], 10);
      const { status, actor } = await readJson(req);
      if (!['open', 'closed'].includes(status)) {
        sendJson(res, 400, { error: 'Status must be "open" or "closed"' });
        return true;
      }
      db = runner.getDb();
      const issue = db.prepare('SELECT id, creator, status FROM issues WHERE id = ?').get(issueId);
      if (!issue) {
        sendJson(res, 404, { error: 'Issue not found' });
        return true;
      }
      const actingAs = actor || 'human';
      if (status === 'closed' && issue.status !== 'closed') {
        const { allowed, special } = runner._resolveAllowedIssueClosers(db, issue.creator);
        if (!allowed.has(actingAs)) {
          const error = special === 'chat-human'
            ? `Issue #${issueId} was opened by ${issue.creator} and can only be closed by chat or human`
            : `Issue #${issueId} was opened by ${issue.creator} and can only be closed by ${issue.creator} or athena`;
          sendJson(res, 403, { error });
          return true;
        }
      }
      const now = new Date().toISOString();
      const closedAt = status === 'closed' ? now : null;
      const closedBy = status === 'closed' ? actingAs : null;
      db.prepare('UPDATE issues SET status = ?, updated_at = ?, updated_by = ?, closed_at = ?, closed_by = ? WHERE id = ?').run(status, now, actingAs, closedAt, closedBy, issueId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    } finally {
      try { db?.close(); } catch {}
    }
    return true;
  }

  if (req.method === 'GET' && subPath === 'issues') {
    sendJson(res, 200, { issues: await runner.getIssues() });
    return true;
  }

  if (req.method === 'POST' && subPath === 'issues/create') {
    if (!requireWrite(req, res)) return true;
    try {
      const { title, body: issueBody, creator, assignee, text } = await readJson(req);
      if (title) {
        sendJson(res, 200, await runner.createIssue(title, issueBody, creator, assignee));
      } else if (text) {
        const lines = text.trim().split('\n');
        sendJson(res, 200, await runner.createIssue(lines[0], lines.slice(1).join('\n'), 'human'));
      } else {
        throw new Error('Missing title or text');
      }
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  return false;
}
