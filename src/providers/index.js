/**
 * Provider registry — delegates to pi-ai adapter.
 *
 * Re-exports the adapter's public API so that the rest of the codebase can
 * import from './providers/index.js' without knowing about pi-ai directly.
 */

export {
  resolveModel,
  formatTools,
  callModel,
  buildAssistantMessage,
  buildToolResultMessages,
  buildUserMessage,
  getProviders,
  getModels,
  getModel,
  getSupportedThinkingLevels,
  THINKING_LEVELS,
} from './pi-ai-adapter.js';
