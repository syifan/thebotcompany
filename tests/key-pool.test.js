import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set TBC_HOME to a temp dir before importing key-pool
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-test-'));
process.env.TBC_HOME = tmpDir;

// Dynamic import so TBC_HOME is set first
const {
  loadKeyPool,
  saveKeyPool,
  addKey,
  removeKey,
  updateKey,
  reorderKeys,
  getKeyPoolSafe,
  resolveKeyForProject,
  markRateLimited,
  isRateLimited,
  getRateLimitCooldown,
  detectTokenProvider,
} = await import('../src/key-pool.js');

describe('Key Pool', () => {
  const poolPath = path.join(tmpDir, 'key-pool.json');

  beforeEach(() => {
    // Clean pool file before each test
    try { fs.unlinkSync(poolPath); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(poolPath); } catch {}
  });

  describe('loadKeyPool / saveKeyPool', () => {
    it('returns empty pool when file does not exist', () => {
      const pool = loadKeyPool();
      assert.deepStrictEqual(pool, { keys: [] });
    });

    it('round-trips a pool', () => {
      const pool = { keys: [{ id: 'test-1', label: 'Test', provider: 'anthropic', token: 'sk-ant-abc', enabled: true, order: 0 }] };
      saveKeyPool(pool);
      const loaded = loadKeyPool();
      assert.strictEqual(loaded.keys.length, 1);
      assert.strictEqual(loaded.keys[0].id, 'test-1');
    });

    it('creates file with 0600 permissions', () => {
      saveKeyPool({ keys: [] });
      const stat = fs.statSync(poolPath);
      assert.strictEqual(stat.mode & 0o777, 0o600);
    });
  });

  describe('addKey', () => {
    it('adds a key with auto-detected provider', () => {
      const entry = addKey({ token: 'sk-ant-test123' });
      assert.strictEqual(entry.provider, 'anthropic');
      assert.strictEqual(entry.enabled, true);
      assert.strictEqual(entry.order, 0);
      assert.ok(entry.id);
    });

    it('increments order for subsequent keys', () => {
      addKey({ token: 'sk-ant-first' });
      const second = addKey({ token: 'sk-proj-second' });
      assert.strictEqual(second.order, 1);
      assert.strictEqual(second.provider, 'openai');
    });

    it('uses explicit provider when given', () => {
      const entry = addKey({ token: 'some-key', provider: 'minimax' });
      assert.strictEqual(entry.provider, 'minimax');
    });

    it('uses custom label', () => {
      const entry = addKey({ label: 'My Lab Key', token: 'sk-proj-xyz' });
      assert.strictEqual(entry.label, 'My Lab Key');
    });
  });

  describe('removeKey', () => {
    it('removes a key by id', () => {
      const entry = addKey({ token: 'sk-ant-remove-me' });
      assert.strictEqual(loadKeyPool().keys.length, 1);
      removeKey(entry.id);
      assert.strictEqual(loadKeyPool().keys.length, 0);
    });
  });

  describe('updateKey', () => {
    it('updates label and enabled status', () => {
      const entry = addKey({ token: 'sk-ant-update' });
      updateKey(entry.id, { label: 'Updated', enabled: false });
      const pool = loadKeyPool();
      assert.strictEqual(pool.keys[0].label, 'Updated');
      assert.strictEqual(pool.keys[0].enabled, false);
    });

    it('returns null for non-existent key', () => {
      const result = updateKey('non-existent', { label: 'X' });
      assert.strictEqual(result, null);
    });
  });

  describe('reorderKeys', () => {
    it('reorders keys by id array', () => {
      const a = addKey({ label: 'A', token: 'sk-ant-a' });
      const b = addKey({ label: 'B', token: 'sk-ant-b' });
      const c = addKey({ label: 'C', token: 'sk-ant-c' });
      reorderKeys([c.id, a.id, b.id]);
      const pool = loadKeyPool();
      assert.strictEqual(pool.keys[0].id, c.id);
      assert.strictEqual(pool.keys[1].id, a.id);
      assert.strictEqual(pool.keys[2].id, b.id);
    });
  });

  describe('getKeyPoolSafe', () => {
    it('masks tokens', () => {
      addKey({ token: 'sk-ant-api03-longtoken12345678' });
      const safe = getKeyPoolSafe();
      assert.ok(safe.keys[0].preview.includes('****'));
      assert.strictEqual(safe.keys[0].token, undefined);
    });

    it('includes rate limit status', () => {
      const entry = addKey({ token: 'sk-ant-rl' });
      markRateLimited(entry.id, 10000);
      const safe = getKeyPoolSafe();
      assert.strictEqual(safe.keys[0].rateLimited, true);
      assert.ok(safe.keys[0].cooldownMs > 0);
    });
  });

  describe('rate limiting', () => {
    it('marks and checks rate limits', () => {
      assert.strictEqual(isRateLimited('key-1'), false);
      markRateLimited('key-1', 5000);
      assert.strictEqual(isRateLimited('key-1'), true);
      assert.ok(getRateLimitCooldown('key-1') > 0);
    });

    it('expires rate limits', () => {
      markRateLimited('key-2', 1); // 1ms cooldown
      // wait a tick
      const start = Date.now();
      while (Date.now() - start < 5) {} // busy wait 5ms
      assert.strictEqual(isRateLimited('key-2'), false);
    });
  });

  describe('resolveKeyForProject', () => {
    it('resolves first enabled key when no project selection', async () => {
      addKey({ label: 'First', token: 'sk-ant-first', provider: 'anthropic' });
      addKey({ label: 'Second', token: 'sk-proj-second', provider: 'openai' });
      const result = await resolveKeyForProject({}, 'anthropic', null);
      assert.ok(result);
      assert.strictEqual(result.token, 'sk-ant-first');
      assert.strictEqual(result.provider, 'anthropic');
    });

    it('resolves selected key from project config', async () => {
      addKey({ label: 'Default', token: 'sk-ant-default', provider: 'anthropic' });
      const specific = addKey({ label: 'Specific', token: 'sk-proj-specific', provider: 'openai' });
      const result = await resolveKeyForProject(
        { keySelection: { keyId: specific.id, fallback: true } },
        'anthropic',
        null
      );
      assert.ok(result);
      assert.strictEqual(result.token, 'sk-proj-specific');
      assert.strictEqual(result.keyId, specific.id);
    });

    it('falls back when selected key is rate limited and fallback is true', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      addKey({ label: 'Backup', token: 'sk-ant-backup', provider: 'anthropic' });
      markRateLimited(primary.id, 60000);
      const result = await resolveKeyForProject(
        { keySelection: { keyId: primary.id, fallback: true } },
        'anthropic',
        null
      );
      assert.ok(result);
      assert.strictEqual(result.token, 'sk-ant-backup');
    });

    it('returns null when selected key is rate limited and fallback is false', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      markRateLimited(primary.id, 60000);
      const result = await resolveKeyForProject(
        { keySelection: { keyId: primary.id, fallback: false } },
        'anthropic',
        null
      );
      assert.strictEqual(result, null);
    });

    it('skips disabled keys', async () => {
      const disabled = addKey({ label: 'Disabled', token: 'sk-ant-disabled', provider: 'anthropic' });
      updateKey(disabled.id, { enabled: false });
      const enabled = addKey({ label: 'Enabled', token: 'sk-ant-enabled', provider: 'anthropic' });
      const result = await resolveKeyForProject({}, 'anthropic', null);
      assert.ok(result);
      assert.strictEqual(result.keyId, enabled.id);
    });

    it('matches provider hint', async () => {
      addKey({ label: 'Anthropic', token: 'sk-ant-ant', provider: 'anthropic' });
      const openai = addKey({ label: 'OpenAI', token: 'sk-proj-oai', provider: 'openai' });
      const result = await resolveKeyForProject({}, 'openai', null);
      assert.ok(result);
      assert.strictEqual(result.keyId, openai.id);
      assert.strictEqual(result.provider, 'openai');
    });
  });

  describe('detectTokenProvider', () => {
    it('detects Anthropic keys', () => {
      assert.strictEqual(detectTokenProvider('sk-ant-api03-abc'), 'anthropic');
      assert.strictEqual(detectTokenProvider('sk-ant-oat-xyz'), 'anthropic');
    });

    it('detects OpenAI keys', () => {
      assert.strictEqual(detectTokenProvider('sk-proj-abc'), 'openai');
    });

    it('detects Google keys', () => {
      assert.strictEqual(detectTokenProvider('AIzaSyABC123'), 'google');
    });

    it('returns null for unknown', () => {
      assert.strictEqual(detectTokenProvider('unknown-key'), null);
      assert.strictEqual(detectTokenProvider(null), null);
    });
  });

  describe('resolveKeyForProject — disabled/missing pinned key', () => {
    it('returns null when pinned key is disabled and fallback is false', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      addKey({ label: 'Backup', token: 'sk-ant-backup', provider: 'anthropic' });
      updateKey(primary.id, { enabled: false });
      const result = await resolveKeyForProject(
        { keySelection: { keyId: primary.id, fallback: false } },
        'anthropic',
        null
      );
      assert.strictEqual(result, null);
    });

    it('falls back when pinned key is disabled and fallback is true', async () => {
      const primary = addKey({ label: 'Primary', token: 'sk-ant-primary', provider: 'anthropic' });
      const backup = addKey({ label: 'Backup', token: 'sk-ant-backup', provider: 'anthropic' });
      updateKey(primary.id, { enabled: false });
      const result = await resolveKeyForProject(
        { keySelection: { keyId: primary.id, fallback: true } },
        'anthropic',
        null
      );
      assert.ok(result);
      assert.strictEqual(result.keyId, backup.id);
      assert.strictEqual(result.token, 'sk-ant-backup');
    });

    it('returns null when pinned key does not exist and fallback is false', async () => {
      addKey({ label: 'Available', token: 'sk-ant-available', provider: 'anthropic' });
      const result = await resolveKeyForProject(
        { keySelection: { keyId: 'non-existent-id', fallback: false } },
        'anthropic',
        null
      );
      assert.strictEqual(result, null);
    });

    it('falls back when pinned key does not exist and fallback is true', async () => {
      const available = addKey({ label: 'Available', token: 'sk-ant-available', provider: 'anthropic' });
      const result = await resolveKeyForProject(
        { keySelection: { keyId: 'non-existent-id', fallback: true } },
        'anthropic',
        null
      );
      assert.ok(result);
      assert.strictEqual(result.keyId, available.id);
      assert.strictEqual(result.token, 'sk-ant-available');
    });
  });
});
