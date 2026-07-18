import test from 'node:test';
import assert from 'node:assert/strict';

import { listOAuthProviders } from '../src/oauth.js';

test('OAuth integration loads providers from the current pi-ai API', () => {
  const providers = listOAuthProviders();

  assert.ok(providers.length > 0);
  assert.ok(providers.some(provider => provider.id === 'anthropic'));
  assert.ok(providers.some(provider => provider.id === 'openai-codex'));
  assert.ok(providers.every(provider => provider.id && provider.name));
});
