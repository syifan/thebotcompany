/**
 * Derive the per-provider model list offered in the monitor UI from the
 * pi-ai catalog, replacing the old hand-maintained regex allowlist.
 *
 * The list is a filtered view, not a curated one: stale/tiny models are
 * dropped by capability filters, and the models referenced by the provider's
 * tier defaults are flagged `recommended` so the UI can surface them first.
 * New models arrive automatically with each pi-ai upgrade.
 */

// Models below this context window are too old/small for TBC's agent loops.
const CONTEXT_WINDOW_FLOOR = 32_000;

const EFFORT_LEVELS = ['medium', 'high', 'xhigh'];

/** Strip a "provider/" prefix from a tier model string (e.g. "minimax/MiniMax-M2.7"). */
function bareModelId(model, provider) {
  return model.startsWith(`${provider}/`) ? model.slice(provider.length + 1) : model;
}

/**
 * Build the selectable model list for every provider in modelTiers.
 *
 * @param {object} modelTiers - MODEL_TIERS map (provider → tier → { model })
 * @param {(provider: string) => Array} getPiModels - pi-ai catalog reader
 * @returns {object} provider → [{ id, name, recommended }]
 */
export function buildAvailableModels(modelTiers, getPiModels) {
  const availableModels = {};

  for (const provider of Object.keys(modelTiers)) {
    const tierModelIds = new Set(
      Object.values(modelTiers[provider] || {}).map(t => bareModelId(t.model, provider))
    );

    let models;
    try {
      models = getPiModels(provider) || [];
    } catch {
      models = [];
    }

    const entries = [];
    for (const model of models) {
      if (model.id.includes('latest')) continue;
      if ((model.contextWindow || 0) < CONTEXT_WINDOW_FLOOR) continue;

      const recommended = tierModelIds.has(model.id);
      if (model.reasoning) {
        for (const effort of EFFORT_LEVELS) {
          entries.push({ id: `${model.id}@${effort}`, name: `${model.name} (${effort})`, recommended });
        }
      } else {
        entries.push({ id: model.id, name: model.name, recommended });
      }
    }

    // Recommended first; catalog order otherwise (Array.sort is stable).
    entries.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    availableModels[provider] = entries;
  }

  availableModels.custom = [];
  return availableModels;
}
