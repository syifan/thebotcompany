/**
 * Tests for the catalog-derived model list served to the monitor UI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAvailableModels } from '../src/server/routes/project/available-models.js';
import { MODEL_TIERS } from '../src/model-tiers.js';
import { getModels } from '../src/providers/index.js';

const FAKE_TIERS = {
  acme: {
    high: { model: 'acme-big', reasoningEffort: 'high' },
    low:  { model: 'acme/acme-small' },
  },
};

function fakeCatalog(provider) {
  assert.equal(provider, 'acme');
  return [
    { id: 'acme-big', name: 'Acme Big', reasoning: true, contextWindow: 200000 },
    { id: 'acme-small', name: 'Acme Small', reasoning: false, contextWindow: 128000 },
    { id: 'acme-new', name: 'Acme New', reasoning: false, contextWindow: 1000000 },
    { id: 'acme-big-latest', name: 'Acme Big (latest)', reasoning: true, contextWindow: 200000 },
    { id: 'acme-ancient', name: 'Acme Ancient', reasoning: false, contextWindow: 8000 },
  ];
}

describe('buildAvailableModels', () => {
  const result = buildAvailableModels(FAKE_TIERS, fakeCatalog);
  const entries = result.acme;

  it('always exposes an empty list for the custom provider', () => {
    assert.deepEqual(result.custom, []);
  });

  it('drops "latest" aliases and models below the context-window floor', () => {
    const ids = entries.map(e => e.id);
    assert.ok(!ids.some(id => id.includes('latest')));
    assert.ok(!ids.some(id => id.startsWith('acme-ancient')));
  });

  it('includes catalog models without any hand-maintained allowlist', () => {
    assert.ok(entries.some(e => e.id === 'acme-new'), 'new catalog models appear automatically');
  });

  it('lists reasoning models as a bare entry plus effort variants', () => {
    const bigIds = entries.filter(e => e.id.startsWith('acme-big')).map(e => e.id);
    assert.deepEqual(bigIds.sort(), ['acme-big', 'acme-big@high', 'acme-big@medium', 'acme-big@xhigh']);
  });

  it('flags tier-default models as recommended (including prefixed tier entries) and sorts them first', () => {
    const byId = Object.fromEntries(entries.map(e => [e.id, e]));
    assert.equal(byId['acme-big@high'].recommended, true);
    assert.equal(byId['acme-small'].recommended, true, 'provider-prefixed tier entry matches');
    assert.equal(byId['acme-new'].recommended, false);
    const firstNonRecommended = entries.findIndex(e => !e.recommended);
    assert.ok(entries.slice(0, firstNonRecommended).every(e => e.recommended));
  });

  it('yields an empty list when the catalog reader throws', () => {
    const out = buildAvailableModels({ broken: {} }, () => { throw new Error('boom'); });
    assert.deepEqual(out.broken, []);
  });
});

describe('buildAvailableModels against the real catalog', () => {
  const result = buildAvailableModels(MODEL_TIERS, getModels);

  it('every provider tier default is selectable in the UI list', () => {
    for (const [provider, tiers] of Object.entries(MODEL_TIERS)) {
      const ids = new Set(result[provider].map(e => e.id.split('@', 2)[0]));
      for (const [tier, { model }] of Object.entries(tiers)) {
        const bare = model.startsWith(`${provider}/`) ? model.slice(provider.length + 1) : model;
        assert.ok(ids.has(bare), `${provider}/${tier} default ${bare} missing from UI list`);
      }
    }
  });

  it('recommended entries exist for every provider', () => {
    for (const provider of Object.keys(MODEL_TIERS)) {
      assert.ok(result[provider].some(e => e.recommended), `${provider} has no recommended models`);
    }
  });
});
