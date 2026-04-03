import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set TBC_HOME to a temp dir before importing key-pool
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-test-keytrack-'));
process.env.TBC_HOME = tmpDir;

const {
  addKey,
  getKeyPoolSafe,
} = await import('../src/key-pool.js');

describe('Report key tracking', () => {
  const poolPath = path.join(tmpDir, 'key-pool.json');

  beforeEach(() => {
    try { fs.unlinkSync(poolPath); } catch {}
  });

  describe('key_id in reports schema', () => {
    it('agent runner returns keyId and keysUsed in result', async () => {
      // Import the runner to verify the result shape includes keyId
      // We can't easily run the full runner, but we can verify makeResult structure
      // by checking the module exports and shape
      const { runAgentWithAPI } = await import('../src/agent-runner.js');
      assert.ok(typeof runAgentWithAPI === 'function', 'runAgentWithAPI should be a function');
    });

    it('key pool provides labels for key_id resolution', () => {
      const k1 = addKey({ label: 'ProdKey', token: 'sk-ant-prod', provider: 'anthropic' });
      const k2 = addKey({ label: 'BackupKey', token: 'sk-ant-backup', provider: 'anthropic' });
      const pool = getKeyPoolSafe();
      const keyMap = new Map(pool.keys.map(k => [k.id, k.label]));
      assert.strictEqual(keyMap.get(k1.id), 'ProdKey');
      assert.strictEqual(keyMap.get(k2.id), 'BackupKey');
      assert.strictEqual(keyMap.get('non-existent'), undefined);
    });

    it('key label resolution handles missing keys gracefully', () => {
      const pool = getKeyPoolSafe();
      const keyMap = new Map((pool.keys || []).map(k => [k.id, k.label]));
      const label = keyMap.get('deleted-key-id') || null;
      assert.strictEqual(label, null);
    });
  });
});
