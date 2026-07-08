/**
 * Model catalog smoke test.
 *
 * Verifies that every model referenced in MODEL_TIERS resolves against the
 * pi-ai model catalog with usable pricing data. This is the guardrail for
 * @mariozechner/pi-ai upgrades: a release that renames or removes a model we
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

test('resolveModel returns undefined piModel for unknown models', () => {
  const { piModel } = resolveModel('definitely-not-a-real-model-id', 'anthropic');
  assert.strictEqual(piModel, undefined);
});
