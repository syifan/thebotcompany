/**
 * Google Gemini Provider - Using @google/genai SDK
 */

import { GoogleGenAI } from '@google/genai';
import { BaseProvider } from './base.js';

const MODEL_PRICING = {
  'gemini-3.1-pro-preview':         { input: 2,    output: 12   },
  'gemini-3-pro-preview':           { input: 2,    output: 12   },
  'gemini-3-flash-preview':         { input: 0.50, output: 3    },
  'gemini-2.5-pro':                 { input: 1.25, output: 10   },
  'gemini-2.5-flash':               { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite':          { input: 0.10, output: 0.40 },
};

function getPricing(model) {
  const name = model.replace(/^google\//, '');
  return MODEL_PRICING[name] || MODEL_PRICING['gemini-3-flash-preview'];
}

export class GeminiProvider extends BaseProvider {
  createClient({ token }) {
    return new GoogleGenAI({
      apiKey: token || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    });
  }

  formatTools(tools) {
    // Gemini uses functionDeclarations inside a tools array
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.input_schema,
      })),
    }];
  }

  buildRequest({ model, systemPrompt, messages, tools, reasoningEffort }) {
    const modelName = model.replace(/^google\//, '');

    // Convert messages to Gemini contents format
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          // Check for function responses
          if (msg.content[0]?._gemini_function_response) {
            contents.push({
              role: 'user',
              parts: msg.content.map(r => ({
                functionResponse: {
                  name: r.name,
                  response: { result: r.output },
                },
              })),
            });
          } else if (msg.content[0]?.type === 'text') {
            const text = msg.content.map(c => c.text).join('\n');
            contents.push({ role: 'user', parts: [{ text }] });
          }
        } else {
          contents.push({ role: 'user', parts: [{ text: msg.content || '' }] });
        }
      } else if (msg.role === 'assistant' || msg.role === 'model') {
        // Use raw parts if available to preserve thought signatures
        if (msg._rawParts && msg._rawParts.length > 0) {
          contents.push({ role: 'model', parts: msg._rawParts });
        } else {
          const parts = [];
          if (msg._textContent) {
            parts.push({ text: msg._textContent });
          }
          if (msg._functionCalls) {
            for (const fc of msg._functionCalls) {
              parts.push({
                functionCall: {
                  name: fc.name,
                  args: fc.args,
                },
              });
            }
          }
          if (parts.length === 0 && msg.content) {
            parts.push({ text: typeof msg.content === 'string' ? msg.content : '' });
          }
          if (parts.length > 0) {
            contents.push({ role: 'model', parts });
          }
        }
      }
    }

    const config = {};

    // Map reasoning effort to thinking config
    if (reasoningEffort) {
      const thinkingMap = {
        low: 'LOW',
        medium: 'MEDIUM',
        high: 'HIGH',
        xhigh: 'HIGH',
      };
      config.thinkingConfig = {
        thinkingLevel: thinkingMap[reasoningEffort] || 'MEDIUM',
      };
    }

    return {
      model: modelName,
      contents,
      config: {
        ...config,
        systemInstruction: systemPrompt,
        tools,
      },
    };
  }

  async callAPI(client, params, signal) {
    const { model, contents, config } = params;

    // Wrap in abort-aware promise since @google/genai may not support signal natively
    const apiPromise = client.models.generateContent({
      model,
      contents,
      config,
    });

    const response = await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      apiPromise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort));
    });

    // Extract text and function calls
    let textContent = '';
    const toolCalls = [];
    const rawFunctionCalls = [];

    // Preserve raw parts for thought signature support
    let rawParts = [];

    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      rawParts = candidate.content?.parts || [];
      for (const part of rawParts) {
        if (part.text) {
          textContent += (textContent ? '\n' : '') + part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id: `gemini_${part.functionCall.name}_${Date.now()}`,
            name: part.functionCall.name,
            input: part.functionCall.args || {},
          });
          rawFunctionCalls.push({
            name: part.functionCall.name,
            args: part.functionCall.args || {},
          });
        }
      }
    }

    // Also check top-level helpers
    if (!textContent && response.text) {
      textContent = response.text;
    }
    if (toolCalls.length === 0 && response.functionCalls) {
      for (const fc of response.functionCalls) {
        toolCalls.push({
          id: `gemini_${fc.name}_${Date.now()}`,
          name: fc.name,
          input: fc.args || {},
        });
        rawFunctionCalls.push({
          name: fc.name,
          args: fc.args || {},
        });
      }
    }

    let stopReason = 'end_turn';
    if (toolCalls.length > 0) {
      stopReason = 'tool_use';
    } else if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      stopReason = 'max_tokens';
    }

    return {
      role: 'assistant',
      content: textContent,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        cacheReadTokens: response.usageMetadata?.cachedContentTokenCount || 0,
      },
      _textContent: textContent,
      _functionCalls: rawFunctionCalls,
      _rawParts: rawParts,
    };
  }

  buildAssistantMessage(normalized) {
    // If we have raw parts (which include thought/thoughtSignature), use them
    // directly to preserve thought signatures required by Gemini thinking mode.
    if (normalized._rawParts && normalized._rawParts.length > 0) {
      return {
        role: 'model',
        content: normalized.content,
        _textContent: normalized._textContent,
        _functionCalls: normalized._functionCalls,
        _rawParts: normalized._rawParts,
      };
    }
    return {
      role: 'model',
      content: normalized.content,
      _textContent: normalized._textContent,
      _functionCalls: normalized._functionCalls,
    };
  }

  buildToolResultMessage(results) {
    return {
      role: 'user',
      content: results.map(r => {
        // Extract function name from synthetic ID: gemini_<name>_<timestamp>
        const match = r.toolCallId.match(/^gemini_(.+)_\d+$/);
        const name = match ? match[1] : r.toolCallId;
        return {
          _gemini_function_response: true,
          name,
          output: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
        };
      }),
    };
  }

  applyCacheHints(messages) {
    // Gemini handles caching via explicit cache objects, not inline hints
  }

  calculateCost(usage, model) {
    const pricing = getPricing(model);
    const cachedTokens = usage.cacheReadTokens || 0;
    const uncachedInput = usage.inputTokens - cachedTokens;
    return (
      (uncachedInput * pricing.input) +
      (cachedTokens * pricing.input * 0.25) +  // Gemini cache hits are 25% of base
      (usage.outputTokens * pricing.output)
    ) / 1_000_000;
  }
}
