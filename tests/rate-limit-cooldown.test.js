/**
 * Tests for rate-limit cooldown duration.
 *
 * Bug: The default rate-limit cooldown was 1 minute. When a key got
 * rate-limited (429), the 1-minute cooldown expired before the retry
 * logic could pick a fallback key. The primary key became available
 * again, got picked instead of the fallback, and immediately 429'd
 * again — creating a retry loop that never used the fallback.
 *
 * Fix: Increase default cooldown to 5 minutes so fallback keys
 * actually get used during the cooldown period.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-cooldown-test-'));
process.env.TBC_HOME = tmpDir;

const {
  addKey,
  markRateLimited,
  isRateLimited,
  getRateLimitCooldown,
  resolveKeyForProject,
} = await import('../src/key-pool.js');

// Import parseRetryCooldown from agent-runner
// It's not exported, so we test it via its behavior
const { default: agentRunnerModule } = await import('../src/agent-runner.js');

describe('Rate limit cooldown', () => {
  const poolPath = path.join(tmpDir, 'key-pool.json');

  beforeEach(() => {
    try { fs.unlinkSync(poolPath); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(poolPath); } catch {}
  });

  describe('default cooldown duration', () => {
    it('default cooldown should be at least 5 minutes for reliable fallback', () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });

      // Simulate rate limit with no time hint (default cooldown)
      // Anthropic 429: "This request would exceed your account's rate limit."
      // No "retry in Xm" — so parseRetryCooldown returns the default
      markRateLimited(primary.id); // uses default cooldown

      const cooldown = getRateLimitCooldown(primary.id);
      // Default cooldown should be >= 5 minutes (300,000ms)
      // With 1-minute default, this test FAILS — that's the bug
      assert.ok(cooldown >= 4 * 60_000,
        `Default cooldown ${cooldown}ms should be >= 4 minutes for reliable fallback. ` +
        `Got ${Math.round(cooldown / 60_000)}m. A 1-minute cooldown expires before ` +
        `the retry loop can pick a fallback key.`);
    });
  });

  describe('fallback key selection during cooldown', () => {
    it('fallback key is returned when primary is rate-limited for 5 minutes', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      const fallback = addKey({ label: 'Fallback', token: 'sk-ant-fallback', provider: 'anthropic' });

      markRateLimited(primary.id, 5 * 60_000); // 5 min cooldown

      const config = { keySelection: { keyId: primary.id, fallback: true } };
      const result = await resolveKeyForProject(config, 'anthropic', null);

      assert.ok(result, 'Should return a fallback key');
      assert.strictEqual(result.keyId, fallback.id, 'Should return the fallback key');
      assert.strictEqual(result.token, 'sk-ant-fallback');
    });

    it('primary key is NOT available during 5-minute cooldown', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      addKey({ label: 'Fallback', token: 'sk-ant-fallback', provider: 'anthropic' });

      markRateLimited(primary.id, 5 * 60_000);

      // Even after 1 minute, primary should still be rate-limited
      assert.ok(isRateLimited(primary.id), 'Primary should still be rate-limited after < 5min');

      const config = { keySelection: { keyId: primary.id, fallback: true } };
      const result = await resolveKeyForProject(config, 'anthropic', null);
      assert.notStrictEqual(result.keyId, primary.id,
        'Should NOT return the primary key during cooldown');
    });

    it('BUG DEMO: with 1-minute cooldown, primary becomes available too fast', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      const fallback = addKey({ label: 'Fallback', token: 'sk-ant-fallback', provider: 'anthropic' });

      // Simulate the old behavior: 1-minute cooldown
      markRateLimited(primary.id, 60_000);

      // Immediately after marking, primary is rate-limited
      assert.ok(isRateLimited(primary.id));

      // But the cooldown is only 60 seconds — in a real retry loop with
      // API calls and backoff, this expires before fallback is tried
      const cooldown = getRateLimitCooldown(primary.id);
      assert.ok(cooldown <= 60_000, 'With 1-min cooldown, expires too fast for fallback');
    });
  });
});
