import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const server = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
const athena = fs.readFileSync(path.resolve('agent/managers/athena.md'), 'utf8');
const ares = fs.readFileSync(path.resolve('agent/managers/ares.md'), 'utf8');

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

  it('escalates a successful child milestone to parent rollup verification instead of jumping to root', () => {
    assert.match(server, /const isRollupVerification = !this\.currentEpochPrId/);
    assert.match(server, /const parentMilestoneId = this\.getParentMilestoneId\(completedMilestoneId\)/);
    assert.match(server, /Milestone verified — escalating completion check to parent milestone/);
    assert.match(server, /phase: 'verification'/);
    assert.match(server, /currentMilestoneId: parentMilestoneId/);
  });

  it('returns rollup verification failures to Athena without treating them as epoch PR failures', () => {
    const rollupFailBlock = server.match(/if \(isRollupVerification\) \{[\s\S]*?\n            \} else \{/)
    assert.ok(rollupFailBlock)
    const block = rollupFailBlock[0]
    assert.match(block, /Parent rollup verification incomplete — returning to Athena to plan the next child milestone/)
    assert.doesNotMatch(block, /markCurrentMilestoneFailed/)
  });

  it('gives Ares one grace review turn after worker budget exhaustion', () => {
    assert.match(server, /const aresGraceMode = this\.milestoneCyclesUsed >= this\.milestoneCyclesBudget/)
    assert.match(server, /if \(aresGraceMode && this\.aresGraceCycleUsed\)/)
    assert.match(server, /Grace review mode:\*\* Worker budget is exhausted/)
    assert.match(server, /if \(aresGraceMode\) this\.aresGraceCycleUsed = true/)
    assert.match(server, /Ares grace review did not claim completion/)
    assert.match(server, /Ignoring Ares schedule because grace review mode forbids worker scheduling/)
  });

  it('documents that grace review mode forbids scheduling and allows only a completion claim', () => {
    assert.match(ares, /If in grace review mode/)
    assert.match(ares, /Do not emit a schedule or assign workers/)
    assert.match(ares, /either emit `<!-- CLAIM_COMPLETE -->` or leave it out/)
  });
});
