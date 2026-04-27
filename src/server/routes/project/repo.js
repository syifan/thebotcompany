import fs from 'fs';
import { spawn } from 'child_process';
import { sendJson, readJson } from '../../http.js';

export async function handleProjectRepoRoutes(req, res, url, ctx) {
  const { runner, subPath, requireWrite } = ctx;

  if (req.method === 'GET' && subPath === 'repo') {
    sendJson(res, 200, {
      repo: runner.repo,
      url: runner.repo ? `https://github.com/${runner.repo}` : null,
    });
    return true;
  }

  if (req.method === 'GET' && subPath === 'download') {
    try {
      const projectDataDir = runner.projectDir;
      if (!fs.existsSync(projectDataDir)) {
        sendJson(res, 404, { error: 'Project data not found' });
        return true;
      }
      const filename = `${runner.id.replace(/\//g, '-')}-project.zip`;
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      const zip = spawn('zip', ['-r', '-q', '-', '.'], { cwd: projectDataDir, stdio: ['ignore', 'pipe', 'ignore'] });
      zip.stdout.pipe(res);
      zip.on('error', () => {
        const tar = spawn('tar', ['-czf', '-', '-C', projectDataDir, '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename.replace('.zip', '.tar.gz')}"`,
        });
        tar.stdout.pipe(res);
        tar.on('error', () => { res.end(); });
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && subPath === 'bootstrap') {
    if (!requireWrite(req, res)) return true;
    try {
      sendJson(res, 200, runner.bootstrapPreview());
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && subPath === 'bootstrap') {
    if (!requireWrite(req, res)) return true;
    try {
      const options = await readJson(req) || {};
      fs.mkdirSync(runner.chatsDir, { recursive: true });
      sendJson(res, 200, { success: true, ...runner.bootstrap(options) });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && subPath === 'doctor') {
    if (!requireWrite(req, res)) return true;
    try {
      if (!runner.isPaused || runner.currentAgent) {
        sendJson(res, 409, { error: 'Doctor is only available when the project is fully paused.' });
        return true;
      }
      const result = await runner.runDoctor();
      if (!result.success) {
        sendJson(res, 500, { error: 'Doctor agent failed', ...result });
        return true;
      }
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  return false;
}
