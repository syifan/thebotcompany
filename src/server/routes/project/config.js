import fs from 'fs';
import yaml from 'js-yaml';
import { readJson, sendJson } from '../../http.js';

export async function handleProjectConfigRoutes(req, res, url, ctx) {
  const {
    runner,
    projectId,
    subPath,
    requireWrite,
    getKeyPoolSafe,
    buildCustomTierMap,
    modelTiers,
    getPiModels,
    maskToken,
    allowCustomProvider,
    addKey,
  } = ctx;

  if (req.method === 'GET' && subPath === 'config') {
    const raw = fs.existsSync(runner.configPath) ? fs.readFileSync(runner.configPath, 'utf-8') : '';
    const config = runner.loadConfig();
    const projectToken = config.setupToken;
    const hasProjectToken = !!projectToken;
    const safeConfig = { ...config };
    delete safeConfig.setupToken;
    const keyPool = getKeyPoolSafe();
    const keySelection = config.keySelection || null;

    let detectedKey = null;
    if (keySelection?.keyId) detectedKey = keyPool.keys.find(key => key.id === keySelection.keyId) || null;
    if (!detectedKey) detectedKey = keyPool.keys.find(key => key.enabled) || null;
    const detectedProvider = detectedKey?.provider || 'anthropic';
    const detectedTiers = detectedProvider === 'custom' && detectedKey?.customConfig
      ? buildCustomTierMap(detectedKey.customConfig)
      : (modelTiers[detectedProvider] || {});

    const EFFORT_LEVELS = ['medium', 'high', 'xhigh'];
    const ALLOWED_MODELS = {
      anthropic: /^(claude-opus-4-7|claude-sonnet-4-6)$|^claude-haiku-4-5-/,
      openai: /^(gpt-5\.5|o[34])/,
      'openai-codex': /^(gpt-5\.5)/,
      google: /^gemini-[23]/,
      minimax: /MiniMax/,
    };
    const availableModels = {};
    for (const provider of Object.keys(modelTiers)) {
      try {
        const models = getPiModels(provider);
        const filter = ALLOWED_MODELS[provider];
        const entries = [];
        for (const model of models) {
          if (filter && !filter.test(model.id)) continue;
          if (model.id.includes('latest')) continue;
          if (model.reasoning) {
            for (const effort of EFFORT_LEVELS) entries.push({ id: `${model.id}@${effort}`, name: `${model.name} (${effort})` });
          } else {
            entries.push({ id: model.id, name: model.name });
          }
        }
        availableModels[provider] = entries;
      } catch {
        availableModels[provider] = [];
      }
    }
    availableModels.custom = [];

    sendJson(res, 200, {
      config: safeConfig,
      raw,
      hasProjectToken,
      projectTokenPreview: projectToken ? maskToken(projectToken) : null,
      provider: detectedProvider,
      tiers: detectedTiers,
      allTiers: detectedProvider === 'custom' ? { ...modelTiers, custom: detectedTiers } : modelTiers,
      availableModels,
      keyPool,
      keySelection,
      allowCustomProvider,
    });
    return true;
  }

  if (req.method === 'POST' && subPath === 'token') {
    if (!requireWrite(req, res)) return true;
    try {
      const { keyId, fallback, token, provider: explicitProvider, customConfig } = await readJson(req);
      const configPath = runner.configPath;
      const existing = fs.existsSync(configPath) ? yaml.load(fs.readFileSync(configPath, 'utf-8')) || {} : {};

      if (keyId !== undefined) {
        delete existing.setupToken;
        delete existing.setupTokenProvider;
        if (keyId) existing.keySelection = { keyId, fallback: fallback !== false };
        else delete existing.keySelection;
      } else {
        if (token) {
          existing.setupToken = token;
          if (explicitProvider) existing.setupTokenProvider = explicitProvider;
          const entry = addKey({ label: `${explicitProvider || 'API'} (from ${projectId})`, token, provider: explicitProvider, customConfig });
          existing.keySelection = { keyId: entry.id, fallback: true };
        } else {
          delete existing.setupToken;
          delete existing.setupTokenProvider;
          delete existing.keySelection;
        }
      }

      fs.writeFileSync(configPath, yaml.dump(existing));
      sendJson(res, 200, {
        success: true,
        hasProjectToken: !!(existing.setupToken || existing.keySelection?.keyId),
        keySelection: existing.keySelection || null,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && subPath === 'config') {
    if (!requireWrite(req, res)) return true;
    try {
      const { content } = await readJson(req);
      runner.saveConfig(content);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && subPath === 'models') {
    if (!requireWrite(req, res)) return true;
    try {
      const { models } = await readJson(req);
      const config = runner.loadConfig();
      if (models && (models.high || models.mid || models.low)) {
        config.models = {};
        if (models.high) config.models.high = models.high;
        if (models.mid) config.models.mid = models.mid;
        if (models.low) config.models.low = models.low;
      } else {
        delete config.models;
      }
      runner.saveConfig(yaml.dump(config, { lineWidth: -1 }));
      sendJson(res, 200, { success: true, models: config.models || null });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
