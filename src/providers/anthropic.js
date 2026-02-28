/**
 * Anthropic Provider - Claude models via @anthropic-ai/sdk
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base.js';

const MODEL_PRICING = {
  opus:   { input: 15, output: 75, cacheRead: 1.5 },
  sonnet: { input: 3,  output: 15, cacheRead: 0.3 },
  haiku:  { input: 1,  output: 5,  cacheRead: 0.1 },
};

function getPricing(model) {
  if (model.includes('sonnet')) return MODEL_PRICING.sonnet;
  if (model.includes('haiku'))  return MODEL_PRICING.haiku;
  return MODEL_PRICING.opus;
}

export class AnthropicProvider extends BaseProvider {
  createClient({ token }) {
    const isOAuth = token && token.startsWith('sk-ant-oat');
    const clientOpts = {};
    if (isOAuth) {
      clientOpts.apiKey = null;
      clientOpts.authToken = token;
      clientOpts.defaultHeaders = {
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14',
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
        'x-app': 'cli',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    } else if (token) {
      clientOpts.apiKey = token;
    }
    return new Anthropic(clientOpts);
  }

  formatTools(tools) {
    // Anthropic uses the canonical format directly
    return tools;
  }

  buildRequest({ model, systemPrompt, messages, tools, isOAuth }) {
    let sys = systemPrompt;
    if (isOAuth) {
      sys = 'You are Claude Code, Anthropic\'s official CLI for Claude.\n\n' + sys;
    }

    const params = {
      model,
      max_tokens: 16384,
      system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    };

    if (model.includes('opus')) {
      params.temperature = 1;
      params.thinking = { type: 'enabled', budget_tokens: 10000 };
    }

    return params;
  }

  async callAPI(client, params, signal) {
    const response = await client.messages.create(params, { signal });

    const textBlocks = response.content.filter(b => b.type === 'text');
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    return {
      role: 'assistant',
      content: textBlocks.map(b => b.text).join('\n'),
      toolCalls: toolBlocks.map(b => ({ id: b.id, name: b.name, input: b.input })),
      stopReason: response.stop_reason, // 'end_turn' | 'tool_use' | 'max_tokens'
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
      },
      raw: response,
    };
  }

  buildAssistantMessage(normalized) {
    return { role: 'assistant', content: normalized.raw.content };
  }

  buildToolResultMessage(results) {
    return {
      role: 'user',
      content: results.map(r => ({
        type: 'tool_result',
        tool_use_id: r.toolCallId,
        content: r.content,
      })),
    };
  }

  applyCacheHints(messages) {
    // Strip existing cache_control
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }
    }
    // Add to last 2 user messages
    const userMessages = messages.filter(m => m.role === 'user');
    for (const um of userMessages.slice(-2)) {
      if (Array.isArray(um.content) && um.content.length > 0) {
        um.content[um.content.length - 1].cache_control = { type: 'ephemeral' };
      }
    }
  }

  calculateCost(usage, model) {
    const pricing = getPricing(model);
    return (
      (usage.inputTokens * pricing.input) +
      (usage.outputTokens * pricing.output) +
      ((usage.cacheReadTokens || 0) * pricing.cacheRead)
    ) / 1_000_000;
  }
}
