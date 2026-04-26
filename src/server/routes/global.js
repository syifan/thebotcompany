import { sendJson } from '../http.js';

export async function handleGlobalRoutes(req, res, url, ctx) {
  const { orchestrator, startTime, requireWrite, syncProjects } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, {
      uptime: Math.floor((Date.now() - startTime) / 1000),
      projectCount: orchestrator.projectCount(),
      projects: orchestrator.listProjectStatuses(),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    sendJson(res, 200, {
      projects: orchestrator.listProjectStatuses(),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/reload') {
    if (!requireWrite(req, res)) return true;
    syncProjects();
    sendJson(res, 200, { success: true, projectCount: orchestrator.projectCount() });
    return true;
  }

  return false;
}
