import { sendJson } from '../../http.js';

export async function handleProjectActionRoutes(req, res, url, ctx) {
  const { runner, projectId, subPath, requireWrite, orchestrator, log } = ctx;

  if (req.method === 'POST' && (subPath === 'archive' || subPath === 'unarchive')) {
    if (!requireWrite(req, res)) return true;
    const archive = subPath === 'archive';
    try {
      orchestrator.setProjectArchived(projectId, archive);
    } catch (error) {
      log(`Failed to update projects.yaml for archive: ${error.message}`);
    }
    if (archive && runner.running) runner.pause('Archived');
    sendJson(res, 200, { success: true, archived: archive });
    return true;
  }

  if (req.method === 'POST' && ['pause', 'resume', 'skip', 'start', 'stop', 'kill-run', 'kill-cycle', 'kill-epoch'].includes(subPath)) {
    if (!requireWrite(req, res)) return true;
    orchestrator.dispatchProjectAction(projectId, subPath);
    sendJson(res, 200, { success: true, action: subPath, projectId });
    return true;
  }

  return false;
}
