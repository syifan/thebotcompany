import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const server = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
const athena = fs.readFileSync(path.resolve('agent/managers/athena.md'), 'utf8');

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

  it('avoids duplicating the milestone id in generated branch names', () => {
    assert.match(server, /stripLeadingMilestoneId:\s*this\.currentMilestoneId/);
    assert.match(server, /slugifyMilestoneTitle\(title, \{ stripLeadingMilestoneId = null \} = \{\}\)/);
  });

  it('treats kill epoch like a failed epoch by clearing active epoch state, keeping the milestone anchor, and closing any open epoch PR', () => {
    const killEpochBlock = server.match(/killEpoch\(\) \{[\s\S]*?\n  \}\n\n  \/\/ Wait while paused/);
    assert.ok(killEpochBlock);
    const block = killEpochBlock[0];
    assert.match(block, /closeOpenEpochPRForBranch\(this\.currentMilestoneBranch/);
    assert.match(block, /pendingMilestoneId: null/);
    assert.match(block, /currentEpochId: null/);
    assert.match(block, /currentEpochPrId: null/);
    assert.match(block, /currentMilestoneBranch: null/);
    assert.doesNotMatch(block, /currentMilestoneId: null/);
  });

  it('lets Athena reset planning to an ancestor milestone or root before allocating the next milestone id', () => {
    assert.match(server, /normalizeResetTargetMilestone\(milestone\.reset_to\)/);
    assert.match(server, /await this\.allocateNextMilestoneId\(resetTo\)/);
    assert.match(server, /Athena reset planning anchor to/);
  });

  it('documents the optional reset_to field for Athena milestone output', () => {
    assert.match(athena, /"reset_to":"M2"/);
    assert.match(athena, /`reset_to` is optional/);
    assert.match(athena, /ancestor milestone/);
  });
});
