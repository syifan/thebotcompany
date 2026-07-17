import fs from 'fs';
import * as yaml from 'js-yaml';
import { readJson, sendJson } from '../../http.js';
import { buildAvailableModels } from './available-models.js';
import { resolveModel, getSupportedThinkingLevels, THINKING_LEVELS } from '../../../providers/index.js';

const VALID_EFFORTS = new Set(THINKING_LEVELS);

/**
 * Validate a "model" or "model@effort" override string. Unknown model IDs are
 * allowed (they run via the catalog-fallback path) but produce a warning;
 * a malformed effort suffix is a hard error, and an effort the model's
 * catalog entry doesn't support warns (pi-ai clamps it at runtime).
 */
function checkModelOverride(tier, value, { skipCatalogCheck = false } = {}) {
  const parts = value.split('@');
  if (parts.length > 2) {
    return { error: `${tier}: malformed model override "${value}" (expected "model" or "model@effort")` };
  }
  const [modelId, effort = null] = parts;
  if (!modelId) {
    return { error: `${tier}: missing model ID in "${value}"` };
  }
  if (effort !== null && !VALID_EFFORTS.has(effort)) {
    return { error: `${tier}: invalid reasoning effort "${effort}" (expected one of ${[...VALID_EFFORTS].join(', ')})` };
  }
  // Custom-provider projects use arbitrary endpoint-specific IDs by design.
  if (skipCatalogCheck) return {};
  const { piModel } = resolveModel(modelId);
  if (!piModel) {
    return { error: `${tier}: could not resolve a provider for "${modelId}"` };
  }
  if (piModel.catalogFallback) {
    return { warning: `${tier}: "${modelId}" is not in the model catalog — it will run untested, with cost tracked as $0` };
  }
  if (effort !== null && !getSupportedThinkingLevels(piModel).includes(effort)) {
    return { warning: `${tier}: "${modelId}" does not support reasoning effort "${effort}" — it will run at the nearest supported level` };
  }
  return {};
}

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

    const availableModels = buildAvailableModels(modelTiers, getPiModels);

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
      const previousKeyId = existing.keySelection?.keyId || null;

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

      // Model overrides are provider-specific; switching to a different key
      // would leave stale overrides behind (e.g. an Opus override on an
      // OpenAI key). Reset to tier defaults whenever the key changes.
      const newKeyId = existing.keySelection?.keyId || null;
      const modelsCleared = newKeyId !== previousKeyId && !!existing.models;
      if (modelsCleared) delete existing.models;

      fs.writeFileSync(configPath, yaml.dump(existing));
      sendJson(res, 200, {
        success: true,
        hasProjectToken: !!(existing.setupToken || existing.keySelection?.keyId),
        keySelection: existing.keySelection || null,
        modelsCleared,
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
      const TIERS = ['high', 'mid', 'low', 'xlow'];
      const warnings = [];
      if (models && TIERS.some(tier => models[tier])) {
        const keyPool = getKeyPoolSafe();
        const selectedKey = config.keySelection?.keyId
          ? keyPool.keys.find(key => key.id === config.keySelection.keyId)
          : null;
        const skipCatalogCheck = selectedKey?.provider === 'custom';
        config.models = {};
        for (const tier of TIERS) {
          if (!models[tier]) continue;
          const result = checkModelOverride(tier, models[tier], { skipCatalogCheck });
          if (result.error) {
            sendJson(res, 400, { error: result.error });
            return true;
          }
          if (result.warning) warnings.push(result.warning);
          config.models[tier] = models[tier];
        }
      } else {
        delete config.models;
      }
      runner.saveConfig(yaml.dump(config, { lineWidth: -1 }));
      sendJson(res, 200, { success: true, models: config.models || null, warnings });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
