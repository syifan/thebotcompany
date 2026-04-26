import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import { readJson, sendJson } from '../http.js';

export async function handleProjectRegistryRoutes(req, res, url, pathParts, ctx) {
  const { requireWrite, parseGithubUrl, orchestrator, syncProjects, log } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/projects/clone') {
    if (!requireWrite(req, res)) return true;
    try {
      const { url: repoUrl } = await readJson(req);
      if (!repoUrl) {
        sendJson(res, 400, { error: 'Missing url' });
        return true;
      }

      const parsed = parseGithubUrl(repoUrl);
      if (!parsed) {
        sendJson(res, 400, { error: 'Invalid GitHub URL. Expected format: https://github.com/username/reponame' });
        return true;
      }

      if (orchestrator.hasProject(parsed.id)) {
        sendJson(res, 409, { error: `Project "${parsed.id}" is already registered` });
        return true;
      }

      fs.mkdirSync(parsed.projectDir, { recursive: true });

      if (fs.existsSync(path.join(parsed.repoDir, '.git'))) {
        try {
          execSync('git pull', { cwd: parsed.repoDir, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
          log(`Pulled latest for ${parsed.id}`);
        } catch (error) {
          log(`Git pull failed for ${parsed.id}: ${error.message}`);
        }
      } else {
        try {
          execSync(`git clone ${parsed.cloneUrl} repo`, {
            cwd: parsed.projectDir,
            encoding: 'utf-8',
            timeout: 120000,
            stdio: 'pipe',
          });
          log(`Cloned ${parsed.id}`);
        } catch (error) {
          sendJson(res, 500, { error: `Failed to clone repository: ${error.message}` });
          return true;
        }
      }

      const knowledgeSpecPath = path.join(parsed.projectDir, 'knowledge', 'spec.md');
      const repoSpecPath = path.join(parsed.repoDir, 'spec.md');
      const specPath = fs.existsSync(knowledgeSpecPath) ? knowledgeSpecPath : repoSpecPath;
      const hasSpec = fs.existsSync(specPath);
      const specContent = hasSpec ? fs.readFileSync(specPath, 'utf-8') : null;

      sendJson(res, 200, {
        success: true,
        id: parsed.id,
        path: parsed.repoDir,
        hasSpec,
        specContent,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/projects/add') {
    if (!requireWrite(req, res)) return true;
    try {
      const { id, path: projectPath, spec, budgetPer24h } = await readJson(req);
      if (!id || !projectPath) {
        sendJson(res, 400, { error: 'Missing id or path' });
        return true;
      }

      const resolvedPath = projectPath.replace(/^~/, process.env.HOME);

      if (spec && (spec.whatToBuild || spec.successCriteria)) {
        const projectRoot = path.dirname(resolvedPath);
        const knowledgeDir = path.join(projectRoot, 'knowledge');
        const specPath = path.join(knowledgeDir, 'spec.md');
        const specContent = `# Project Specification\n\n## What do you want to build?\n\n${spec.whatToBuild || ''}\n\n## How do you consider the project is success?\n\n${spec.successCriteria || ''}\n`;
        fs.mkdirSync(knowledgeDir, { recursive: true });
        fs.writeFileSync(specPath, specContent);
      }

      orchestrator.addProjectConfig(id, { path: resolvedPath, enabled: true });
      syncProjects();

      if (budgetPer24h !== undefined) {
        const runner = orchestrator.getProject(id);
        if (runner) {
          const config = runner.loadConfig();
          config.budgetPer24h = parseFloat(budgetPer24h) || 0;
          fs.mkdirSync(runner.projectDir, { recursive: true });
          fs.writeFileSync(runner.configPath, yaml.dump(config, { lineWidth: -1 }));
        }
      }

      sendJson(res, 200, { success: true, id, path: resolvedPath });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const isExactProjectDelete = req.method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2] && (
    pathParts.length === 3 ||
    (pathParts.length === 4 && `${pathParts[2]}/${pathParts[3]}` && orchestrator.hasProject(`${pathParts[2]}/${pathParts[3]}`))
  ) && !(pathParts.length > 4);

  if (isExactProjectDelete) {
    const twoSegId = pathParts[3] ? `${pathParts[2]}/${pathParts[3]}` : null;
    const projectId = (twoSegId && orchestrator.hasProject(twoSegId)) ? twoSegId : pathParts[2];
    try {
      if (orchestrator.removeProjectConfig(projectId)) {
        sendJson(res, 200, { success: true, id: projectId });
      } else {
        sendJson(res, 404, { error: 'Project not found' });
      }
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
