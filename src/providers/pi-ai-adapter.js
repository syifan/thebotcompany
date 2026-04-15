/**
 * PI-AI Adapter — wraps @mariozechner/pi-ai to provide TBC's normalized
 * provider interface.  Replaces the per-provider classes (anthropic.js,
 * openai.js, gemini.js, minimax.js, openai-codex.js, base.js).
 */

import {
  getModel,
  getModels,
  getProviders,
  complete,
  completeSimple,
  Type,
} from '@mariozechner/pi-ai';
import { callCustomModel } from './custom-adapter.js';

// ---------------------------------------------------------------------------
// Model resolution — map TBC model strings to pi-ai Model objects
// ---------------------------------------------------------------------------

/**
 * Parse a TBC model string (e.g. "openai/gpt-5.3-codex", "claude-opus-4-6",
 * "google/gemini-3.1-pro-preview", "minimax/MiniMax-M2.5",
 * "openai-codex/gpt-5.3-codex") into a { provider, modelId } pair that pi-ai
 * understands.
 */
function parseTBCModel(rawModel) {
  // Explicit prefix → provider/modelId
  const prefixes = [
    { prefix: 'openai-codex/', provider: 'openai-codex' },
    { prefix: 'openai/',       provider: 'openai' },
    { prefix: 'google/',       provider: 'google' },
    { prefix: 'minimax/',      provider: 'minimax' },
    { prefix: 'anthropic/',    provider: 'anthropic' },
  ];
  for (const { prefix, provider } of prefixes) {
    if (rawModel.startsWith(prefix)) {
      return { provider, modelId: rawModel.slice(prefix.length) };
    }
  }

  // Infer provider from well-known model prefixes / names
  if (rawModel.startsWith('gpt-') || rawModel.startsWith('o3') || rawModel.startsWith('o4-')) {
    return { provider: 'openai', modelId: rawModel };
  }
  if (rawModel.startsWith('gemini-')) {
    return { provider: 'google', modelId: rawModel };
  }
  if (rawModel.startsWith('MiniMax-')) {
    return { provider: 'minimax', modelId: rawModel };
  }

  // Default → Anthropic
  return { provider: 'anthropic', modelId: rawModel };
}

/**
 * Resolve a TBC model string to a pi-ai Model object.
 *
 * @param {string} rawModel - TBC model string (e.g. "claude-opus-4-6")
 * @returns {{ piModel: object, providerName: string }}
 */
export function resolveModel(rawModel, providerOverride = null) {
  if (providerOverride === 'custom') {
    return {
      piModel: {
        id: rawModel,
        name: rawModel,
        provider: 'custom',
        cost: { input: 0, output: 0, cacheRead: 0 },
      },
      providerName: 'custom',
    };
  }

  const hasExplicitProviderPrefix = ['openai-codex/', 'openai/', 'google/', 'minimax/', 'anthropic/']
    .some(prefix => rawModel.startsWith(prefix));

  const { provider, modelId } = hasExplicitProviderPrefix || !providerOverride
    ? parseTBCModel(rawModel)
    : { provider: providerOverride, modelId: rawModel };

  const piModel = getModel(provider, modelId);
  return { piModel, providerName: provider };
}

// ---------------------------------------------------------------------------
// Tool format conversion
// ---------------------------------------------------------------------------

/**
 * Convert TBC's canonical tool definitions (Anthropic input_schema format) to
 * pi-ai's Tool format.
 */
export function formatTools(canonicalTools) {
  return canonicalTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: Type.Unsafe(t.input_schema),
  }));
}

// ---------------------------------------------------------------------------
// API calling
// ---------------------------------------------------------------------------

/**
 * Build pi-ai options from TBC parameters.
 */
function buildOptions({ token, isOAuth, reasoningEffort, signal, provider }) {
  const opts = {};

  if (signal) {
    opts.signal = signal;
  }

  // Map TBC reasoning effort to pi-ai's unified reasoning levels
  if (reasoningEffort) {
    opts.reasoning = reasoningEffort; // pi-ai accepts: 'minimal'|'low'|'medium'|'high'|'xhigh'
  }

  // pi-ai handles OAuth tokens natively for all providers:
  // - Anthropic: detects sk-ant-oat tokens, uses authToken (Bearer) automatically
  // - OpenAI/Codex: uses Bearer auth natively
  // Just pass the token as apiKey — pi-ai does the right thing.
  if (token) {
    opts.apiKey = token;
  }

  return opts;
}

/**
 * Call the LLM via pi-ai and return TBC's normalized response format.
 *
 * @param {object} piModel - pi-ai Model object
 * @param {string} systemPrompt
 * @param {Array} messages - pi-ai message array
 * @param {Array} tools - pi-ai tool definitions
 * @param {object} opts - { token, isOAuth, reasoningEffort, signal }
 * @returns {Promise<object>} TBC normalized response
 */
export async function callModel(piModel, systemPrompt, messages, tools, opts = {}) {
  if (piModel.provider === 'custom') {
    return callCustomModel(piModel, systemPrompt, messages, tools, opts);
  }

  const piOpts = buildOptions(opts);

  const context = {
    systemPrompt,
    messages: [...messages],
    tools,
  };

  const assistantMsg = await completeSimple(piModel, context, piOpts);

  // pi-ai returns error responses instead of throwing — surface them as exceptions
  if (assistantMsg.stopReason === 'error' || assistantMsg.stopReason === 'aborted') {
    const errMsg = assistantMsg.errorMessage || `API call failed (stopReason: ${assistantMsg.stopReason})`;
    const err = new Error(errMsg);
    // Try to extract HTTP status from the error message for retry logic
    const statusMatch = errMsg.match(/status(?:\s+code)?:?\s*(\d{3})/i);
    if (statusMatch) err.status = parseInt(statusMatch[1], 10);
    throw err;
  }

  return normalizeResponse(assistantMsg);
}

/**
 * Normalize a pi-ai AssistantMessage into TBC's response format.
 */
function normalizeResponse(assistantMsg) {
  let textContent = '';
  const toolCalls = [];

  for (const block of assistantMsg.content) {
    if (block.type === 'text') {
      textContent += (textContent ? '\n' : '') + block.text;
    } else if (block.type === 'toolCall') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.arguments,
      });
    }
    // thinking blocks are handled internally by pi-ai
  }

  // Map stop reasons (error/aborted are caught in callModel before reaching here)
  const stopReasonMap = {
    stop: 'end_turn',
    toolUse: 'tool_use',
    length: 'max_tokens',
  };

  return {
    role: 'assistant',
    content: textContent,
    toolCalls,
    stopReason: stopReasonMap[assistantMsg.stopReason] || 'end_turn',
    usage: {
      inputTokens: assistantMsg.usage?.input || 0,
      outputTokens: assistantMsg.usage?.output || 0,
      cacheReadTokens: assistantMsg.usage?.cacheRead || 0,
    },
    cost: assistantMsg.usage?.cost?.total || 0,
    // Keep the raw pi-ai message for building conversation history
    _piMessage: assistantMsg,
  };
}

// ---------------------------------------------------------------------------
// Message history helpers
// ---------------------------------------------------------------------------

/**
 * Build an assistant message for the pi-ai context messages array.
 */
export function buildAssistantMessage(normalizedResponse) {
  return normalizedResponse._piMessage;
}

/**
 * Build tool result messages in pi-ai format.
 *
 * @param {Array} results - [{ toolCallId, toolName, content }]
 * @returns {Array} array of pi-ai ToolResultMessage objects
 */
export function buildToolResultMessages(results) {
  return results.map(r => ({
    role: 'toolResult',
    toolCallId: r.toolCallId,
    toolName: r.toolName || r.name || 'unknown',
    content: [{ type: 'text', text: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) }],
    isError: false,
    timestamp: Date.now(),
  }));
}

/**
 * Build a user message in pi-ai format.
 */
export function buildUserMessage(text) {
  return {
    role: 'user',
    content: text,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

/**
 * Calculate cost from accumulated TBC usage stats using a pi-ai Model.
 */
export function calculateCost(usage, piModel) {
  if (!piModel?.cost) return 0;
  const cost = piModel.cost;
  return (
    (usage.inputTokens * cost.input) +
    (usage.outputTokens * cost.output) +
    ((usage.cacheReadTokens || 0) * cost.cacheRead)
  ) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Re-exports for discoverability
// ---------------------------------------------------------------------------

export { getProviders, getModels, getModel };
