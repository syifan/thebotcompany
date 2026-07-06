import { sendJson } from '../../http.js';
import { jobLogTail, listJobs } from '../../../orchestrator/jobs.js';

export async function handleProjectActivityRoutes(req, res, url, ctx) {
  const { runner, subPath } = ctx;

  if (req.method === 'GET' && subPath === 'comments') {
    const author = url.searchParams.get('author');
    const page = parseInt(url.searchParams.get('page')) || 1;
    const perPage = parseInt(url.searchParams.get('per_page')) || 20;
    sendJson(res, 200, await runner.getComments(author, page, perPage));
    return true;
  }

  if (req.method === 'GET' && subPath === 'prs') {
    const status = ['open', 'merged', 'closed', 'all'].includes(url.searchParams.get('status'))
      ? url.searchParams.get('status')
      : 'open';
    sendJson(res, 200, { prs: await runner.getPRs(status) });
    return true;
  }

  if (req.method === 'GET' && subPath === 'milestones') {
    try {
      const db = runner.getDb();
      const milestones = db.prepare(`
        SELECT id, milestone_id, title, description, cycles_budget, cycles_used, branch_name, parent_milestone_id, linked_pr_id, failure_reason, phase, status, created_at, completed_at
        FROM milestones
        ORDER BY created_at ASC, id ASC
      `).all();
      db.close();
      sendJson(res, 200, { milestones });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && subPath === 'jobs') {
    try {
      const db = runner.getDb();
      const jobs = listJobs(db, runner.projectDbPath);
      db.close();
      sendJson(res, 200, { jobs });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const jobLogMatch = req.method === 'GET' && subPath.match(/^jobs\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/log$/);
  if (jobLogMatch) {
    try {
      const lines = Math.min(parseInt(url.searchParams.get('lines')) || 60, 500);
      sendJson(res, 200, { log: jobLogTail(runner.projectDbPath, jobLogMatch[1], lines) });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  const prDetailMatch = req.method === 'GET' && subPath.match(/^prs\/(\d+)$/);
  if (prDetailMatch) {
    try {
      const pr = await runner.getPR(parseInt(prDetailMatch[1], 10));
      if (!pr) sendJson(res, 404, { error: 'PR not found' });
      else sendJson(res, 200, { pr });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  return false;
}
