/**
 * Model catalog smoke test.
 *
 * Verifies that every model referenced in MODEL_TIERS resolves against the
 * pi-ai model catalog with usable pricing data. This is the guardrail for
 * @earendil-works/pi-ai upgrades: a release that renames or removes a model we
 * depend on fails here instead of at runtime, and a tier default that points
 * at a deprecated model is caught the next time the catalog drops it.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { MODEL_TIERS } from '../src/model-tiers.js';
import { resolveModel } from '../src/providers/index.js';

for (const [provider, tiers] of Object.entries(MODEL_TIERS)) {
  for (const [tier, { model }] of Object.entries(tiers)) {
    test(`MODEL_TIERS ${provider}/${tier} (${model}) resolves in the pi-ai catalog`, () => {
      const { piModel, providerName } = resolveModel(model, provider);

      assert.ok(piModel, `${model} not found in pi-ai catalog for provider ${providerName}`);
      assert.strictEqual(providerName, provider);
      assert.strictEqual(piModel.provider, provider);

      // Pricing must be present so calculateCost() produces real numbers.
      assert.ok(piModel.cost, `${model} has no cost data in pi-ai catalog`);
      assert.strictEqual(typeof piModel.cost.input, 'number');
      assert.strictEqual(typeof piModel.cost.output, 'number');
    });
  }
}

test('resolveModel synthesizes a fallback for unknown models on a known provider', () => {
  const { piModel } = resolveModel('definitely-not-a-real-model-id', 'anthropic');
  assert.ok(piModel, 'unknown model on a known provider should synthesize a fallback');
  assert.strictEqual(piModel.catalogFallback, true);
  assert.strictEqual(piModel.id, 'definitely-not-a-real-model-id');
  assert.strictEqual(piModel.provider, 'anthropic');
  // Request shape borrowed from a real sibling model
  assert.ok(piModel.api, 'fallback must carry the provider API type');
  assert.ok(piModel.baseUrl, 'fallback must carry the provider base URL');
  assert.ok(piModel.maxTokens > 0);
  // Pricing is unknown → cost tracked as zero, never NaN
  assert.deepStrictEqual(piModel.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('known models never get the catalogFallback flag', () => {
  const { piModel } = resolveModel('claude-opus-4-8', 'anthropic');
  assert.ok(piModel);
  assert.strictEqual(piModel.catalogFallback, undefined);
});

test('resolveModel returns undefined piModel for unknown providers', () => {
  // parseTBCModel routes unprefixed unknown IDs to anthropic, so force an
  // explicit provider that pi-ai does not know.
  const { piModel } = resolveModel('some-model', 'no-such-provider');
  assert.strictEqual(piModel, undefined);
});
