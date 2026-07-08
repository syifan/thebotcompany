/**
 * Tests for POST /api/projects/:id/models — model override validation.
 *
 * Overrides may be any model ID (arbitrary IDs run via the catalog-fallback
 * path) but unknown IDs produce a warning, malformed effort suffixes are
 * rejected, and the xlow tier persists like the others.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import yaml from 'js-yaml';
import { handleProjectConfigRoutes } from '../src/server/routes/project/config.js';

function makeReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(code) { this.statusCode = code; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

async function postModels(models, { config = {}, keys = [] } = {}) {
  let savedYaml = null;
  const ctx = {
    runner: {
      loadConfig: () => ({ ...config }),
      saveConfig: (content) => { savedYaml = content; },
    },
    projectId: 'test',
    subPath: 'models',
    requireWrite: () => true,
    getKeyPoolSafe: () => ({ keys }),
  };
  const res = makeRes();
  const handled = await handleProjectConfigRoutes(makeReq({ models }), res, new URL('http://x/'), ctx);
  assert.equal(handled, true);
  return { res, saved: () => (savedYaml === null ? null : yaml.load(savedYaml)) };
}

describe('POST models validation', () => {
  it('accepts known catalog models including the xlow tier', async () => {
    const { res, saved } = await postModels({
      high: 'claude-opus-4-7@high',
      xlow: 'claude-haiku-4-5-20251001',
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.warnings, []);
    assert.equal(saved().models.xlow, 'claude-haiku-4-5-20251001', 'xlow must persist');
    assert.equal(saved().models.high, 'claude-opus-4-7@high');
  });

  it('accepts arbitrary unknown model IDs with a warning', async () => {
    const { res, saved } = await postModels({ high: 'claude-brand-new-model' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.warnings.length, 1);
    assert.match(res.body.warnings[0], /not in the model catalog/);
    assert.equal(saved().models.high, 'claude-brand-new-model');
  });

  it('rejects malformed reasoning effort suffixes', async () => {
    const { res, saved } = await postModels({ high: 'claude-opus-4-7@turbo' });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /invalid reasoning effort/);
    assert.equal(saved(), null, 'nothing saved on validation failure');
  });

  it('skips catalog warnings for custom-provider projects', async () => {
    const { res } = await postModels(
      { high: 'my-local-model' },
      {
        config: { keySelection: { keyId: 'k1' } },
        keys: [{ id: 'k1', provider: 'custom', enabled: true }],
      }
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.warnings, []);
  });

  it('clears overrides when models is empty', async () => {
    const { res, saved } = await postModels({}, { config: { models: { high: 'x' } } });
    assert.equal(res.statusCode, 200);
    assert.equal(saved().models, undefined);
  });
});
