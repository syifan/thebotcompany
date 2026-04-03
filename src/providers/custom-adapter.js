function joinEndpoint(baseUrl, suffix) {
  if (baseUrl.endsWith(suffix)) return baseUrl;
  return `${baseUrl}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function toError(message, status = 0) {
  const err = new Error(message);
  if (status) err.status = status;
  return err;
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block?.type === 'text' && block.text)
    .map(block => block.text)
    .join('\n');
}

function mapUserContentToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text });
      continue;
    }
    if (block?.type === 'image' && block.data && block.mimeType) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.mimeType};base64,${block.data}`,
        },
      });
    }
  }
  return parts.length > 0 ? parts : '';
}

function mapMessagesToOpenAI(messages, systemPrompt) {
  const mapped = [];
  if (systemPrompt) {
    mapped.push({ role: 'system', content: systemPrompt });
  }
  for (const message of messages) {
    if (message.role === 'user') {
      mapped.push({ role: 'user', content: mapUserContentToOpenAI(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const toolCalls = content
        .filter(block => block.type === 'toolCall')
        .map(block => ({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.arguments || {}),
          },
        }));
      const assistantMessage = { role: 'assistant' };
      if (text) assistantMessage.content = text;
      if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
      if (!assistantMessage.content && !assistantMessage.tool_calls) assistantMessage.content = '';
      mapped.push(assistantMessage);
      continue;
    }
    if (message.role === 'toolResult') {
      mapped.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: normalizeTextContent(message.content),
      });
    }
  }
  return mapped;
}

function mapToolsToOpenAI(tools) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseOpenAIResponse(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const textParts = [];
  if (typeof message.content === 'string') {
    textParts.push(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === 'text' && part.text) textParts.push(part.text);
    }
  }

  const toolCalls = (message.tool_calls || []).map(toolCall => ({
    id: toolCall.id,
    name: toolCall.function?.name || 'unknown',
    input: (() => {
      try {
        return JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        return {};
      }
    })(),
  }));

  return {
    role: 'assistant',
    content: textParts.join('\n'),
    toolCalls,
    stopReason: toolCalls.length > 0 ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: {
      inputTokens: data?.usage?.prompt_tokens || 0,
      outputTokens: data?.usage?.completion_tokens || 0,
      cacheReadTokens: 0,
    },
    cost: 0,
    _piMessage: {
      role: 'assistant',
      content: [
        ...textParts.map(text => ({ type: 'text', text })),
        ...toolCalls.map(toolCall => ({
          type: 'toolCall',
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.input,
        })),
      ],
      stopReason: toolCalls.length > 0 ? 'toolUse' : choice?.finish_reason === 'length' ? 'length' : 'stop',
      usage: {
        input: data?.usage?.prompt_tokens || 0,
        output: data?.usage?.completion_tokens || 0,
        cacheRead: 0,
        cost: { total: 0 },
      },
    },
  };
}

function mapMessagesToAnthropic(messages) {
  const mapped = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const content = typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content.map(block => {
              if (block?.type === 'text') return { type: 'text', text: block.text };
              if (block?.type === 'image' && block.data && block.mimeType) {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: block.mimeType,
                    data: block.data,
                  },
                };
              }
              return null;
            }).filter(Boolean)
          : [];
      mapped.push({
        role: 'user',
        content,
      });
      continue;
    }
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      mapped.push({
        role: 'assistant',
        content: content.map(block => {
          if (block.type === 'text') return { type: 'text', text: block.text };
          if (block.type === 'toolCall') {
            return {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.arguments || {},
            };
          }
          return block;
        }),
      });
      continue;
    }
    if (message.role === 'toolResult') {
      mapped.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: normalizeTextContent(message.content),
          is_error: false,
        }],
      });
    }
  }
  return mapped;
}

function mapToolsToAnthropic(tools) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function parseAnthropicResponse(data) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const textParts = [];
  const toolCalls = [];
  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text || '');
      continue;
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input || {},
      });
    }
  }

  return {
    role: 'assistant',
    content: textParts.join('\n'),
    toolCalls,
    stopReason: data?.stop_reason === 'tool_use' ? 'tool_use' : data?.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
    usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      cacheReadTokens: 0,
    },
    cost: 0,
    _piMessage: {
      role: 'assistant',
      content: [
        ...textParts.map(text => ({ type: 'text', text })),
        ...toolCalls.map(toolCall => ({
          type: 'toolCall',
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.input,
        })),
      ],
      stopReason: data?.stop_reason === 'tool_use' ? 'toolUse' : data?.stop_reason === 'max_tokens' ? 'length' : 'stop',
      usage: {
        input: data?.usage?.input_tokens || 0,
        output: data?.usage?.output_tokens || 0,
        cacheRead: 0,
        cost: { total: 0 },
      },
    },
  };
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw toError(`Custom provider returned non-JSON response (${response.status})`, response.status);
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `Custom provider request failed (${response.status})`;
    throw toError(message, response.status);
  }
  return data;
}

export async function callCustomModel(model, systemPrompt, messages, tools, opts = {}) {
  const customConfig = opts.customConfig;
  if (!customConfig) {
    throw new Error('customConfig is required for custom provider calls');
  }
  if (!opts.token) {
    throw new Error('API key is required for custom provider calls');
  }

  if (customConfig.apiStyle === 'anthropic') {
    const body = {
      model: model.id || model.name,
      system: systemPrompt,
      messages: mapMessagesToAnthropic(messages),
      max_tokens: 8192,
    };
    if (tools.length > 0) body.tools = mapToolsToAnthropic(tools);
    const data = await fetchJson(joinEndpoint(customConfig.baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.token,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    return parseAnthropicResponse(data);
  }

  const body = {
    model: model.id || model.name,
    messages: mapMessagesToOpenAI(messages, systemPrompt),
    stream: false,
  };
  if (tools.length > 0) body.tools = mapToolsToOpenAI(tools);
  const data = await fetchJson(joinEndpoint(customConfig.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  return parseOpenAIResponse(data);
}
