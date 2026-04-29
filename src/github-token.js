import fs from 'fs';
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
