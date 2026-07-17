/**
 * Model tier system — maps abstract tiers to provider-specific models.
 *
 * These are the default models used when a project selects a tier
 * ('high'|'mid'|'low'|'xlow') instead of a concrete model ID. Every entry
 * must resolve against the pi-ai model catalog — tests/model-catalog.test.js
 * verifies this so that pi-ai upgrades that rename or drop a model fail CI
 * instead of failing at runtime.
 */

export const MODEL_TIERS = {
  anthropic: {
    high:  { model: 'claude-opus-4-8', reasoningEffort: 'high' },
    mid:   { model: 'claude-sonnet-5', reasoningEffort: 'high' },
    low:   { model: 'claude-sonnet-5' },
    xlow:  { model: 'claude-haiku-4-5-20251001' },
  },
  openai: {
    high:  { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' },
    mid:   { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    low:   { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    xlow:  { model: 'gpt-5.6-luna' },
  },
  google: {
    high:  { model: 'gemini-3.1-pro-preview', reasoningEffort: 'high' },
    // gemini-3.1-pro-preview only supports low/high (its catalog map nulls
    // the rest); "medium" was silently clamped to high anyway, so label it.
    mid:   { model: 'gemini-3.1-pro-preview', reasoningEffort: 'high' },
    low:   { model: 'gemini-3-flash-preview' },
    xlow:  { model: 'gemini-3-flash-preview' },
  },
  minimax: {
    high:  { model: 'minimax/MiniMax-M2.7' },
    mid:   { model: 'minimax/MiniMax-M2.7' },
    low:   { model: 'minimax/MiniMax-M2.7' },
    xlow:  { model: 'minimax/MiniMax-M2.7' },
  },
  'openai-codex': {
    high:  { model: 'openai-codex/gpt-5.6-sol', reasoningEffort: 'xhigh' },
    mid:   { model: 'openai-codex/gpt-5.6-sol', reasoningEffort: 'high' },
    low:   { model: 'openai-codex/gpt-5.6-terra', reasoningEffort: 'medium' },
    // Unlike the plain openai provider (whose bare entry runs reasoning-off
    // via thinkingLevelMap.off), codex has no "off" mapping — an unset effort
    // would fall back to the backend default (medium), so keep it explicit.
    xlow:  { model: 'openai-codex/gpt-5.6-luna', reasoningEffort: 'low' },
  },
};
