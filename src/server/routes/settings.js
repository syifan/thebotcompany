import fs from 'fs';
import path from 'path';
import { readJson, sendJson } from '../http.js';
import { getGithubToken, setGithubTokenInEnvFile } from '../../github-token.js';

function getProviderStatus({ maskToken, loadOAuthCredentials, getKeyPoolSafe }) {
  const anthropicToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
  const openaiToken = process.env.OPENAI_API_KEY || null;
  const googleToken = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  const codexCreds = loadOAuthCredentials('openai-codex');
  const githubToken = getGithubToken();
  return {
    hasGlobalToken: !!anthropicToken,
    globalTokenPreview: anthropicToken ? maskToken(anthropicToken) : null,
    tokenType: anthropicToken ? (anthropicToken.startsWith('sk-ant-oat') ? 'oauth' : 'api_key') : null,
    providers: {
      anthropic: { hasToken: !!anthropicToken, preview: anthropicToken ? maskToken(anthropicToken) : null },
      openai: { hasToken: !!openaiToken, preview: openaiToken ? maskToken(openaiToken) : null },
      google: { hasToken: !!googleToken, preview: googleToken ? maskToken(googleToken) : null },
      'openai-codex': { hasToken: !!codexCreds?.access, type: 'oauth' },
    },
    github: {
      hasToken: !!githubToken,
      preview: githubToken ? maskToken(githubToken) : null,
      required: true,
      envVar: 'TBC_GITHUB_TOKEN',
    },
    keyPool: getKeyPoolSafe(),
  };
}

export async function handleSettingsRoutes(req, res, url, ctx) {
  const {
    requireWrite,
    tbcHome,
    maskToken,
    detectTokenProvider,
    loadOAuthCredentials,
    getKeyPoolSafe,
    addKey,
    loadKeyPool,
    removeKey,
  } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    sendJson(res, 200, getProviderStatus({ maskToken, loadOAuthCredentials, getKeyPoolSafe }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/github-token') {
    if (!requireWrite(req, res)) return true;
    try {
      const { token } = await readJson(req);
      setGithubTokenInEnvFile(tbcHome, token || '');
      const status = getProviderStatus({ maskToken, loadOAuthCredentials, getKeyPoolSafe });
      sendJson(res, 200, { success: true, github: status.github });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/token') {
    if (!requireWrite(req, res)) return true;
    try {
      const { token, provider: forceProvider } = await readJson(req);
      const envPath = path.join(tbcHome, '.env');
      let envContent = '';
      try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch {}

      const provider = forceProvider || detectTokenProvider(token) || 'anthropic';
      const providerEnvVars = {
        anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
        openai: ['OPENAI_API_KEY'],
        google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      };

      for (const envVarName of providerEnvVars[provider] || []) {
        envContent = envContent.replace(new RegExp(`^${envVarName}=.*\\n?`, 'm'), '');
        delete process.env[envVarName];
      }

      if (token) {
        let envVar;
        if (provider === 'anthropic') {
          envVar = token.startsWith('sk-ant-oat') ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
        } else if (provider === 'openai') {
          envVar = 'OPENAI_API_KEY';
        } else if (provider === 'google') {
          envVar = 'GEMINI_API_KEY';
        } else {
          envVar = 'ANTHROPIC_API_KEY';
        }
        envContent = envContent.trimEnd() + `\n${envVar}=${token}\n`;
        process.env[envVar] = token;
        addKey({ label: `${provider.charAt(0).toUpperCase() + provider.slice(1)}`, token, provider });
      } else {
        const pool = loadKeyPool();
        const toRemove = pool.keys.filter(key => key.provider === provider && key.type === 'api_key');
        for (const key of toRemove) removeKey(key.id);
      }

      fs.writeFileSync(envPath, envContent);
      const status = getProviderStatus({ maskToken, loadOAuthCredentials, getKeyPoolSafe });
      sendJson(res, 200, {
        success: true,
        provider,
        hasGlobalToken: status.hasGlobalToken,
        tokenType: status.tokenType,
        providers: status.providers,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
