import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { readJson, sendJson } from '../http.js';
import { getGithubToken } from '../../github-token.js';

function githubEnv() {
  const token = getGithubToken();
  if (!token) return null;
  return { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token, GIT_TERMINAL_PROMPT: '0' };
}

function withGitAskpass(env) {
  const token = getGithubToken();
  if (!token) return { env, cleanup: () => {} };
  const askpassDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-git-askpass-'));
  const askpassPath = path.join(askpassDir, 'askpass.sh');
  fs.writeFileSync(askpassPath, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$TBC_GIT_TOKEN" ;;\nesac\n', { mode: 0o700 });
  return {
    env: { ...env, GIT_ASKPASS: askpassPath, TBC_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' },
    cleanup: () => { try { fs.rmSync(askpassDir, { recursive: true, force: true }); } catch {} },
  };
}

function requireGithubToken(res) {
  const env = githubEnv();
  if (!env) {
    sendJson(res, 400, { error: 'GitHub personal access token is not configured. Add a fine-grained token in Settings > Credentials.' });
    return null;
  }
  return env;
}

export async function handleGithubRoutes(req, res, url, ctx) {
  const { requireWrite, tbcHome } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/github/orgs') {
    try {
      const env = requireGithubToken(res);
      if (!env) return true;
      const user = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 15000, env }).trim();
      let orgs = [];
      try {
        orgs = execSync('gh api user/orgs --jq ".[].login"', { encoding: 'utf-8', timeout: 15000, env })
          .trim().split('\n').filter(Boolean);
      } catch {}
      sendJson(res, 200, { user, orgs: [user, ...orgs] });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }


  if (req.method === 'GET' && url.pathname === '/api/github/repos') {
    const owner = url.searchParams.get('owner');
    if (!owner) {
      sendJson(res, 400, { error: 'Missing owner parameter' });
      return true;
    }
    try {
      const env = requireGithubToken(res);
      if (!env) return true;
      const output = execSync(
        `gh repo list ${owner} --json nameWithOwner,name,description --limit 100`,
        { encoding: 'utf-8', timeout: 30000, env }
      );
      sendJson(res, 200, { repos: JSON.parse(output) });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/github/create-repo') {
    if (!requireWrite(req, res)) return true;
    try {
      const { name, owner, isPrivate, description } = await readJson(req);
      if (!name) {
        sendJson(res, 400, { error: 'Missing repo name' });
        return true;
      }

      const env = requireGithubToken(res);
      if (!env) return true;
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
      const gitAuth = withGitAskpass(env);
      try {
        execSync(`git clone ${cloneUrl} repo`, { cwd: projectDir, encoding: 'utf-8', timeout: 60000, stdio: 'pipe', env: gitAuth.env });
      } finally {
        gitAuth.cleanup();
      }

      sendJson(res, 200, { success: true, id: repoId, path: repoDir });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  return false;
}
