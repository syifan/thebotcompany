/**
 * MiniMax Provider - Using OpenAI-compatible Chat Completions API
 * Base URL: https://api.minimax.io/v1
 */

import OpenAI from 'openai';
import { BaseProvider } from './base.js';

const MODEL_PRICING = {
  'MiniMax-M2.5':           { input: 0.3,  output: 1.2 },
  'MiniMax-M2.5-highspeed': { input: 0.6,  output: 2.4 },
  'MiniMax-M2.1':           { input: 0.3,  output: 1.2 },
  'MiniMax-M2.1-highspeed': { input: 0.6,  output: 2.4 },
  'MiniMax-M2':             { input: 0.3,  output: 1.2 },
};

function getPricing(model) {
  const name = model.replace(/^minimax\//, '');
  return MODEL_PRICING[name] || MODEL_PRICING['MiniMax-M2.1'];
}

export class MiniMaxProvider extends BaseProvider {
  createClient({ token }) {
    return new OpenAI({
      apiKey: token || process.env.MINIMAX_API_KEY,
      baseURL: 'https://api.minimax.io/v1',
    });
  }

  formatTools(tools) {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  buildRequest({ model, systemPrompt, messages, tools, reasoningEffort }) {
    const modelName = model.replace(/^minimax\//, '');

    // Build OpenAI chat completions format
    const chatMessages = [];

    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          if (msg.content[0]?._minimax_tool_result) {
            // Tool results
            for (const r of msg.content) {
              chatMessages.push({
                role: 'tool',
                tool_call_id: r.tool_call_id,
                content: r.output,
              });
            }
          } else if (msg.content[0]?.type === 'text') {
            const text = msg.content.map(c => c.text).join('\n');
            chatMessages.push({ role: 'user', content: text });
          }
        } else {
          chatMessages.push({ role: 'user', content: msg.content || '' });
        }
      } else if (msg.role === 'assistant') {
        const assistantMsg = { role: 'assistant' };
        if (msg._textContent) {
          assistantMsg.content = msg._textContent;
        }
        if (msg._functionCalls && msg._functionCalls.length > 0) {
          assistantMsg.tool_calls = msg._functionCalls.map(fc => ({
            id: fc.id,
            type: 'function',
            function: {
              name: fc.name,
              arguments: fc.arguments,
            },
          }));
          // OpenAI format requires content to be null or string when tool_calls present
          if (!assistantMsg.content) assistantMsg.content = null;
        }
        if (assistantMsg.content !== undefined || assistantMsg.tool_calls) {
          chatMessages.push(assistantMsg);
        }
      }
    }

    const params = {
      model: modelName,
      messages: chatMessages,
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    return params;
  }

  async callAPI(client, params, signal) {
    const response = await client.chat.completions.create(params, { signal });

    const choice = response.choices?.[0];
    const message = choice?.message || {};

    let textContent = message.content || '';
    const toolCalls = [];
    const rawFunctionCalls = [];

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let input;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          input,
        });
        rawFunctionCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    let stopReason = 'end_turn';
    if (toolCalls.length > 0) {
      stopReason = 'tool_use';
    } else if (choice?.finish_reason === 'length') {
      stopReason = 'max_tokens';
    }

    return {
      role: 'assistant',
      content: textContent,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        cacheReadTokens: 0,
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
        _minimax_tool_result: true,
        tool_call_id: r.toolCallId,
        output: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
      })),
    };
  }

  applyCacheHints(messages) {
    // MiniMax supports prompt caching but we don't add hints for now
  }

  calculateCost(usage, model) {
    const pricing = getPricing(model);
    const cachedTokens = usage.cacheReadTokens || 0;
    const uncachedInput = usage.inputTokens - cachedTokens;
    return (
      (uncachedInput * pricing.input) +
      (cachedTokens * pricing.input * 0.1) +
      (usage.outputTokens * pricing.output)
    ) / 1_000_000;
  }
}
