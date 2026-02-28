/**
 * Base Provider - Abstract interface for LLM providers.
 *
 * Normalized response format:
 * {
 *   role: 'assistant',
 *   content: string,           // concatenated text
 *   toolCalls: [{ id, name, input }],
 *   stopReason: 'end_turn' | 'tool_use' | 'max_tokens',
 *   usage: { inputTokens, outputTokens },
 *   raw: <provider-specific response for message history>
 * }
 */

export class BaseProvider {
  /**
   * Create the API client instance.
   * @param {Object} opts - { token, isOAuth, ... }
   * @returns {Object} client
   */
  createClient(_opts) {
    throw new Error('createClient() not implemented');
  }

  /**
   * Return tool definitions in this provider's native format.
   * @param {Array} tools - Canonical tool definitions (Anthropic input_schema format)
   * @returns {Array}
   */
  formatTools(_tools) {
    throw new Error('formatTools() not implemented');
  }

  /**
   * Build the request parameters for the API call.
   * @param {Object} opts - { model, systemPrompt, messages, tools, ... }
   * @returns {Object} params ready for the API
   */
  buildRequest(_opts) {
    throw new Error('buildRequest() not implemented');
  }

  /**
   * Call the API and return a normalized response.
   * @param {Object} client
   * @param {Object} params - from buildRequest()
   * @param {AbortSignal} signal
   * @returns {Promise<Object>} normalized response
   */
  async callAPI(_client, _params, _signal) {
    throw new Error('callAPI() not implemented');
  }

  /**
   * Build the assistant message to append to conversation history.
   * @param {Object} normalizedResponse
   * @returns {Object} message object for the messages array
   */
  buildAssistantMessage(_normalizedResponse) {
    throw new Error('buildAssistantMessage() not implemented');
  }

  /**
   * Build tool result messages to append to conversation history.
   * @param {Array} results - [{ toolCallId, content }]
   * @returns {Object} message object(s) for the messages array
   */
  buildToolResultMessage(_results) {
    throw new Error('buildToolResultMessage() not implemented');
  }

  /**
   * Apply caching hints to messages (provider-specific, no-op by default).
   */
  applyCacheHints(_messages) {}

  /**
   * Calculate cost from accumulated usage.
   * @param {Object} usage - { inputTokens, outputTokens, cacheReadTokens }
   * @param {string} model
   * @returns {number} cost in dollars
   */
  calculateCost(_usage, _model) {
    throw new Error('calculateCost() not implemented');
  }
}
