/**
 * Provider registry - resolves model string to the appropriate provider.
 */

import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';

const anthropic = new AnthropicProvider();
const openai = new OpenAIProvider();
const gemini = new GeminiProvider();

const OPENAI_MODELS = ['gpt-4.1', 'o3', 'o4-mini', 'gpt-5.3-codex'];
const GEMINI_MODELS = ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

/**
 * Get provider and cleaned model name from a model string.
 * - "openai/gpt-4.1" → OpenAI provider
 * - "google/gemini-3.1-pro-preview" → Gemini provider
 * - "gemini-3-flash-preview" → Gemini provider
 * - "claude-opus-4-6" → Anthropic provider (default)
 */
export function getProvider(model) {
  if (model.startsWith('openai/')) {
    return { provider: openai, model };
  }
  if (model.startsWith('google/')) {
    return { provider: gemini, model };
  }
  if (OPENAI_MODELS.includes(model)) {
    return { provider: openai, model: `openai/${model}` };
  }
  if (GEMINI_MODELS.includes(model)) {
    return { provider: gemini, model };
  }
  if (model.startsWith('gemini-')) {
    return { provider: gemini, model };
  }
  if (model.startsWith('anthropic/')) {
    return { provider: anthropic, model: model.replace(/^anthropic\//, '') };
  }
  // Default: Anthropic
  return { provider: anthropic, model };
}
