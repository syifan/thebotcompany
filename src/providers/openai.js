/**
 * OpenAI Provider - Using the Responses API (v1/responses)
 * Required for Codex models (gpt-5.3-codex, etc.)
 */

import OpenAI from 'openai';
import { BaseProvider } from './base.js';

const MODEL_PRICING = {
  'gpt-4.1':        { input: 2,   output: 8   },
  'o3':             { input: 2,   output: 8   },
  'o4-mini':        { input: 1.1, output: 4.4 },
  'gpt-5.3-codex':  { input: 1.75, output: 14  },
};

function getPricing(model) {
  const name = model.replace(/^openai\//, '');
  return MODEL_PRICING[name] || MODEL_PRICING['gpt-4.1'];
}

export class OpenAIProvider extends BaseProvider {
  createClient({ token }) {
    return new OpenAI({
      apiKey: token || process.env.OPENAI_API_KEY,
    });
  }

  formatTools(tools) {
    return tools.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
  }

  buildRequest({ model, systemPrompt, messages, tools, reasoningEffort }) {
    const modelName = model.replace(/^openai\//, '');

    // Build flat input list for the Responses API
    const input = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          if (msg.content[0]?.type === 'function_call_output') {
            // Tool results — add as flat items
            for (const item of msg.content) {
              input.push(item);
            }
          } else if (msg.content[0]?.type === 'text') {
            const text = msg.content.map(c => c.text).join('\n');
            input.push({ role: 'user', content: text });
          }
        } else {
          input.push({ role: 'user', content: msg.content || '' });
        }
      } else if (msg.role === 'assistant') {
        // Re-inject assistant content and function calls as flat items
        if (msg._functionCalls && msg._functionCalls.length > 0) {
          // Add text content first if any
          if (msg._textContent) {
            input.push({ role: 'assistant', content: msg._textContent });
          }
          // Add function call items
          for (const fc of msg._functionCalls) {
            input.push({
              type: 'function_call',
              call_id: fc.call_id,
              name: fc.name,
              arguments: fc.arguments,
            });
          }
        } else if (msg._textContent || msg.content) {
          input.push({ role: 'assistant', content: msg._textContent || msg.content || '' });
        }
      }
    }

    const params = {
      model: modelName,
      instructions: systemPrompt,
      input,
      tools,
    };

    if (reasoningEffort) {
      params.reasoning = { effort: reasoningEffort };
    }

    return params;
  }

  async callAPI(client, params, signal) {
    const response = await client.responses.create(params, { signal });

    const outputItems = response.output || [];

    let textContent = '';
    const toolCalls = [];
    const rawFunctionCalls = [];

    for (const item of outputItems) {
      if (item.type === 'message') {
        for (const content of (item.content || [])) {
          if (content.type === 'output_text') {
            textContent += (textContent ? '\n' : '') + content.text;
          }
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id,
          name: item.name,
          input: JSON.parse(item.arguments),
        });
        // Keep raw for re-injection
        rawFunctionCalls.push({
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
      }
    }

    let stopReason = 'end_turn';
    if (toolCalls.length > 0) {
      stopReason = 'tool_use';
    } else if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
      stopReason = 'max_tokens';
    }

    return {
      role: 'assistant',
      content: textContent,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens || 0,
        reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens || 0,
      },
      _textContent: textContent,
      _functionCalls: rawFunctionCalls,
    };
  }

  buildAssistantMessage(normalized) {
    return {
      role: 'assistant',
      content: normalized.content,
      _textContent: normalized._textContent,
      _functionCalls: normalized._functionCalls,
    };
  }

  buildToolResultMessage(results) {
    return {
      role: 'user',
      content: results.map(r => ({
        type: 'function_call_output',
        call_id: r.toolCallId,
        output: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
      })),
    };
  }

  applyCacheHints(messages) {
    // Responses API handles caching automatically
  }

  calculateCost(usage, model) {
    const pricing = getPricing(model);
    const cachedTokens = usage.cacheReadTokens || 0;
    const uncachedInput = usage.inputTokens - cachedTokens;
    return (
      (uncachedInput * pricing.input) +
      (cachedTokens * pricing.input * 0.5) +
      (usage.outputTokens * pricing.output)
    ) / 1_000_000;
  }
}
