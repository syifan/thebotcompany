import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const server = fs.readFileSync(path.resolve('src/server.js'), 'utf8');

describe('epoch-as-PR orchestrator flow', () => {
  it('requires an orchestrator-managed epoch PR before Ares can claim completion', () => {
    assert.match(server, /CLAIM_COMPLETE ignored because no orchestrator-managed epoch PR exists/i);
    assert.match(server, /ensureEpochPRForCurrentMilestone/);
  });

  it('assigns milestone ids before Athena starts and derives epoch ids separately', () => {
    assert.match(server, /pendingMilestoneId/);
    assert.match(server, /allocateNextMilestoneId/);
    assert.match(server, /allocateNextEpochId/);
    assert.match(server, /Assigned milestone ID/);
  });

  it('returns Apollo failures to Athena for split and replan', () => {
    assert.match(server, /Verification failed — returning to Athena for split\/replan/i);
    assert.match(server, /phase: 'athena'/);
    assert.doesNotMatch(server, /Verification failed — returning to Ares/);
  });
});
