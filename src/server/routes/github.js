import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { readJson, sendJson } from '../http.js';
import { createGithubAuthEnv } from '../../github-token.js';

function requireGithubToken(res, baseEnv = process.env) {
  const auth = createGithubAuthEnv(baseEnv);
  if (!auth.hasToken) {
    sendJson(res, 400, { error: 'GitHub personal access token is not configured. Add a fine-grained token in Settings > GitHub Access.' });
    return null;
  }
  return auth;
}

export async function handleGithubRoutes(req, res, url, ctx) {
  const { requireWrite, tbcHome } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/github/orgs') {
    let auth = null;
    try {
      auth = requireGithubToken(res);
      if (!auth) return true;
      const { env } = auth;
      const user = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 15000, env }).trim();
      let orgs = [];
      try {
        orgs = execSync('gh api user/orgs --jq ".[].login"', { encoding: 'utf-8', timeout: 15000, env })
          .trim().split('\n').filter(Boolean);
      } catch {}
      sendJson(res, 200, { user, orgs: [user, ...orgs] });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    } finally {
      auth?.cleanup?.();
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/github/repos') {
    const owner = url.searchParams.get('owner');
    if (!owner) {
      sendJson(res, 400, { error: 'Missing owner parameter' });
      return true;
    }
    let auth = null;
    try {
      auth = requireGithubToken(res);
      if (!auth) return true;
      const { env } = auth;
      const output = execSync(
        `gh repo list ${owner} --json nameWithOwner,name,description --limit 100`,
        { encoding: 'utf-8', timeout: 30000, env }
      );
      sendJson(res, 200, { repos: JSON.parse(output) });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    } finally {
      auth?.cleanup?.();
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/github/create-repo') {
    if (!requireWrite(req, res)) return true;
    let auth = null;
    try {
      const { name, owner, isPrivate, description } = await readJson(req);
      if (!name) {
        sendJson(res, 400, { error: 'Missing repo name' });
        return true;
      }

      auth = requireGithubToken(res);
      if (!auth) return true;
      const { env } = auth;
      const currentUser = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 15000, env }).trim();
      const resolvedOwner = owner || currentUser;
      const isOrg = owner && owner !== currentUser;

      let cmd = 'gh repo create';
      cmd += isOrg ? ` ${owner}/${name}` : ` ${name}`;
      cmd += isPrivate ? ' --private' : ' --public';
      if (description) cmd += ` --description ${JSON.stringify(description)}`;

      const repoId = `${resolvedOwner}/${name}`;
      const projectDir = path.join(tbcHome, 'dev', 'src', 'github.com', resolvedOwner, name);
      fs.mkdirSync(projectDir, { recursive: true });
      const repoDir = path.join(projectDir, 'repo');

      execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe', env });
      const cloneUrl = `https://github.com/${resolvedOwner}/${name}.git`;
      execSync(`git clone ${cloneUrl} repo`, { cwd: projectDir, encoding: 'utf-8', timeout: 60000, stdio: 'pipe', env });

      sendJson(res, 200, { success: true, id: repoId, path: repoDir });
    } catch (error) {
      let message = error.message;
      if (/not found|resource not accessible|403|404|permission|access/i.test(message)) {
        message += ' If this token is a fine-grained PAT limited to selected repositories, GitHub will not automatically add newly created repos to it. Use repository access: All repositories, or edit the PAT in GitHub and add the new repo manually.';
      }
      sendJson(res, 500, { error: message });
    } finally {
      auth?.cleanup?.();
    }
    return true;
  }

  return false;
}
