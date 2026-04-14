/**
 * Tests for report summarization key fallback behavior.
 *
 * The summarize endpoint should:
 * 1. Use the key returned by resolveKeyForProject (which skips rate-limited keys)
 * 2. Resolve the model based on the actual key's provider (not a hardcoded provider)
 * 3. On rate-limit errors, mark the key and retry with a fallback key
 * 4. On fallback to a different provider, use the correct model for that provider
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set TBC_HOME to a temp dir before importing key-pool
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-summarize-test-'));
process.env.TBC_HOME = tmpDir;

const {
  addKey,
  markRateLimited,
  isRateLimited,
  resolveKeyForProject,
  getRateLimitCooldown,
  loadKeyPool,
} = await import('../src/key-pool.js');

describe('Summarize fallback', () => {
  const poolPath = path.join(tmpDir, 'key-pool.json');

  beforeEach(() => {
    try { fs.unlinkSync(poolPath); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(poolPath); } catch {}
  });

  describe('resolveKeyForProject skips rate-limited keys', () => {
    it('returns fallback key when primary is rate-limited', async () => {
      const primary = addKey({ label: 'OpenAI', token: 'sk-proj-primary', provider: 'openai-codex' });
      const fallback = addKey({ label: 'Anthropic', token: 'sk-ant-api03-fallback', provider: 'anthropic' });

      markRateLimited(primary.id, 60 * 60_000);

      const config = {
        keySelection: { keyId: primary.id, fallback: true },
      };

      const result = await resolveKeyForProject(config, 'openai-codex', null);
      assert.ok(result, 'Should return a key');
      assert.strictEqual(result.keyId, fallback.id, 'Should return fallback key');
      assert.strictEqual(result.provider, 'anthropic', 'Fallback key should be anthropic');
      assert.strictEqual(result.type, 'api_key', 'Fallback key type should be api_key');
    });

    it('returns null when primary is rate-limited and fallback is disabled', async () => {
      const primary = addKey({ label: 'OpenAI', token: 'sk-proj-primary', provider: 'openai-codex' });
      addKey({ label: 'Anthropic', token: 'sk-ant-api03-fallback', provider: 'anthropic' });

      markRateLimited(primary.id, 60 * 60_000);

      const config = {
        keySelection: { keyId: primary.id, fallback: false },
      };

      const result = await resolveKeyForProject(config, 'openai-codex', null);
      assert.strictEqual(result, null, 'Should return null when fallback disabled');
    });

    it('returns primary key when it is NOT rate-limited', async () => {
      const primary = addKey({ label: 'OpenAI', token: 'sk-proj-primary', provider: 'openai-codex' });
      addKey({ label: 'Anthropic', token: 'sk-ant-api03-fallback', provider: 'anthropic' });

      const config = {
        keySelection: { keyId: primary.id, fallback: true },
      };

      const result = await resolveKeyForProject(config, 'openai-codex', null);
      assert.ok(result);
      assert.strictEqual(result.keyId, primary.id, 'Should return primary key when not rate-limited');
    });

    it('skips all rate-limited keys and returns first available', async () => {
      const k1 = addKey({ label: 'Key1', token: 'sk-proj-k1', provider: 'openai-codex' });
      const k2 = addKey({ label: 'Key2', token: 'sk-ant-api03-k2', provider: 'anthropic' });
      const k3 = addKey({ label: 'Key3', token: 'AIzaSy-k3', provider: 'google' });

      markRateLimited(k1.id, 60_000);
      markRateLimited(k2.id, 60_000);

      const result = await resolveKeyForProject({}, null, null);
      assert.ok(result);
      assert.strictEqual(result.keyId, k3.id, 'Should return third key when first two are rate-limited');
      assert.strictEqual(result.provider, 'google');
    });
  });

  describe('rate limit cooldown tracking', () => {
    it('marks key rate-limited with correct duration', () => {
      const key = addKey({ label: 'Test', token: 'sk-proj-test', provider: 'openai-codex' });
      markRateLimited(key.id, 162 * 60_000);
      assert.ok(isRateLimited(key.id), 'Key should be rate-limited');
      const cooldown = getRateLimitCooldown(key.id);
      assert.ok(cooldown > 161 * 60_000, `Cooldown ${cooldown}ms should be > 161min`);
      assert.ok(cooldown <= 162 * 60_000, `Cooldown ${cooldown}ms should be <= 162min`);
    });

    it('key becomes available after cooldown expires', () => {
      const originalNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;
      try {
        const key = addKey({ label: 'Test', token: 'sk-proj-test', provider: 'openai-codex' });
        markRateLimited(key.id, 1_000);
        assert.ok(isRateLimited(key.id), 'Key should be rate-limited during cooldown');
        now += 1_001;
        assert.ok(!isRateLimited(key.id), 'Key should NOT be rate-limited after cooldown expires');
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('summarize must use fallback key provider for model resolution', () => {
    // This test documents the bug: the summarize endpoint was using
    // providerName from the first pool key (or config) instead of
    // keyResult.provider to resolve the model tier.
    //
    // When the primary key (openai-codex) is rate-limited and fallback
    // returns an anthropic key, the model should be resolved for anthropic
    // (e.g. claude-haiku), not for openai-codex (e.g. gpt-5.3-codex).

    it('fallback key provider differs from primary — model must match fallback', async () => {
      const primary = addKey({ label: 'OpenAI', token: 'sk-proj-primary', provider: 'openai-codex' });
      const fallback = addKey({ label: 'Anthropic', token: 'sk-ant-api03-fallback', provider: 'anthropic' });

      markRateLimited(primary.id, 162 * 60_000);

      const config = {
        keySelection: { keyId: primary.id, fallback: true },
      };

      const keyResult = await resolveKeyForProject(config, 'openai-codex', null);
      assert.ok(keyResult);
      assert.strictEqual(keyResult.provider, 'anthropic',
        'Fallback key is anthropic — summarize must use anthropic model (e.g. claude-haiku), not openai model');

      // BUG: server.js summarize endpoint does:
      //   const providerName = config.setupTokenProvider || firstKey?.provider || 'anthropic';
      //   const resolved = resolveModelTier('low', providerName);
      //
      // This uses the FIRST key's provider (openai-codex), not keyResult.provider (anthropic).
      // So it resolves to openai-codex/gpt-5.3-codex model, but sends the anthropic token.
      //
      // FIX: Use keyResult.provider for model resolution:
      //   const resolved = resolveModelTier('low', keyResult.provider);
    });

    it('when no key is rate-limited, primary provider is used', async () => {
      const primary = addKey({ label: 'OpenAI', token: 'sk-proj-primary', provider: 'openai-codex' });
      addKey({ label: 'Anthropic', token: 'sk-ant-api03-fallback', provider: 'anthropic' });

      const config = {
        keySelection: { keyId: primary.id, fallback: true },
      };

      const keyResult = await resolveKeyForProject(config, 'openai-codex', null);
      assert.ok(keyResult);
      assert.strictEqual(keyResult.provider, 'openai-codex',
        'Primary key provider should be used when not rate-limited');
    });
  });

  describe('summarize should retry with fallback on rate-limit error', () => {
    // The current summarize endpoint does NOT retry on rate-limit errors.
    // It catches the error, marks the key, and returns 500.
    // It should instead retry with the fallback key.

    it('after marking primary rate-limited, resolveKeyForProject returns fallback', async () => {
      const primary = addKey({ label: 'OpenAI', token: 'sk-proj-primary', provider: 'openai-codex' });
      const fallback = addKey({ label: 'Anthropic', token: 'sk-ant-api03-fallback', provider: 'anthropic' });

      const config = {
        keySelection: { keyId: primary.id, fallback: true },
      };

      // First call — primary key returned
      const result1 = await resolveKeyForProject(config, 'openai-codex', null);
      assert.strictEqual(result1.keyId, primary.id);

      // Simulate rate-limit: mark primary
      markRateLimited(primary.id, 162 * 60_000);

      // Second call — fallback key returned
      const result2 = await resolveKeyForProject(config, 'openai-codex', null);
      assert.strictEqual(result2.keyId, fallback.id, 'After marking primary rate-limited, fallback should be returned');
      assert.strictEqual(result2.provider, 'anthropic');
    });
  });
});
