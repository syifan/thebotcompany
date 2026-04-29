import fs from 'fs';
import os from 'os';
import path from 'path';

export const GITHUB_TOKEN_ENV = 'TBC_GITHUB_TOKEN';

export function getGithubToken() {
  return process.env.TBC_GITHUB_TOKEN
    || process.env.GITHUB_TOKEN
    || process.env.GH_TOKEN
    || process.env.GITHUB_PAT
    || null;
}

export function setGithubTokenInEnvFile(tbcHome, token) {
  const envPath = path.join(tbcHome, '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch {}

  for (const name of ['TBC_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT']) {
    envContent = envContent.replace(new RegExp(`^${name}=.*\\n?`, 'm'), '');
    if (name === 'TBC_GITHUB_TOKEN') delete process.env[name];
  }

  const clean = String(token || '').trim();
  if (clean) {
    envContent = envContent.trimEnd() + `\nTBC_GITHUB_TOKEN=${clean}\n`;
    process.env.TBC_GITHUB_TOKEN = clean;
  }

  fs.mkdirSync(tbcHome, { recursive: true });
  fs.writeFileSync(envPath, envContent);
}

export function createGithubAuthEnv(baseEnv = process.env, { tempParent = os.tmpdir() } = {}) {
  const token = getGithubToken();
  if (!token) return { env: { ...baseEnv }, cleanup: () => {}, hasToken: false };

  const askpassDir = fs.mkdtempSync(path.join(tempParent || os.tmpdir(), '.tbc-git-askpass-'));
  const askpassPath = path.join(askpassDir, 'askpass.sh');
  fs.writeFileSync(askpassPath, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$TBC_GIT_TOKEN" ;;\nesac\n', { mode: 0o700 });

  return {
    env: {
      ...baseEnv,
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
      TBC_GIT_TOKEN: token,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: askpassPath,
    },
    cleanup: () => { try { fs.rmSync(askpassDir, { recursive: true, force: true }); } catch {} },
    hasToken: true,
  };
}
