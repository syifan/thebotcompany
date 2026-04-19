import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const server = fs.readFileSync(path.resolve('src/server.js'), 'utf8');

describe('epoch-as-PR orchestrator flow', () => {
  it('requires an open epoch PR before Ares can claim completion', () => {
    assert.match(server, /CLAIM_COMPLETE ignored because no open epoch PR exists/i);
    assert.match(server, /Ares claimed milestone completion without an open epoch PR/i);
  });

  it('returns Apollo failures to Athena for split and replan', () => {
    assert.match(server, /Verification failed — returning to Athena for split\/replan/i);
    assert.match(server, /phase: 'athena'/);
    assert.doesNotMatch(server, /Verification failed — returning to Ares/);
  });
});
