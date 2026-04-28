import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const server = fs.readFileSync(path.resolve('src/orchestrator/ProjectRunner.js'), 'utf8');
const milestones = fs.readFileSync(path.resolve('src/orchestrator/milestones.js'), 'utf8');
const stateControl = fs.readFileSync(path.resolve('src/orchestrator/state-control.js'), 'utf8');
const phaseMachine = fs.readFileSync(path.resolve('src/orchestrator/phase-machine.js'), 'utf8');
const orchestratorSource = `${server}\n${milestones}\n${stateControl}\n${phaseMachine}`;

describe('epoch-as-PR orchestrator flow', () => {
  it('requires an orchestrator-managed epoch PR before Ares can claim completion', () => {
    assert.match(orchestratorSource, /CLAIM_COMPLETE ignored because no orchestrator-managed epoch PR exists/i);
    assert.match(orchestratorSource, /ensureEpochPRForCurrentMilestone/);
  });

  it('assigns milestone ids before Athena starts and derives epoch ids separately', () => {
    assert.match(orchestratorSource, /pendingMilestoneId/);
    assert.match(orchestratorSource, /allocateNextMilestoneId/);
    assert.match(orchestratorSource, /allocateNextEpochId/);
    assert.match(orchestratorSource, /Assigned milestone ID/);
  });

  it('returns Apollo failures to Athena for split and replan', () => {
    assert.match(orchestratorSource, /Verification failed — returning to Athena for split\/replan/i);
    assert.match(orchestratorSource, /phase: 'athena'/);
    assert.doesNotMatch(orchestratorSource, /Verification failed — returning to Ares/);
  });

  it('avoids duplicating the milestone id in generated branch names', () => {
    assert.match(orchestratorSource, /stripLeadingMilestoneId:\s*(?:this|runner)\.currentMilestoneId/);
    assert.match(orchestratorSource, /slugifyMilestoneTitle\(title, \{ stripLeadingMilestoneId = null \} = \{\}\)/);
  });

  it('treats kill epoch like a failed epoch by clearing active epoch state, keeping the milestone anchor, and closing any open epoch PR', () => {
    const killEpochBlock = stateControl.match(/killRunnerEpoch\([^)]*\)/);
    assert.ok(killEpochBlock);
    const block = stateControl;
    assert.match(block, /closeOpenEpochPRForBranch\((?:this|runner)\.currentMilestoneBranch/);
    assert.match(block, /pendingMilestoneId: null/);
    assert.match(block, /currentEpochId: null/);
    assert.match(block, /currentEpochPrId: null/);
    assert.match(block, /currentMilestoneBranch: null/);
    assert.doesNotMatch(block, /currentMilestoneId: null/);
  });

  it('lets Athena reset planning to an ancestor milestone or root before allocating the next milestone id', () => {
    assert.match(orchestratorSource, /normalizeResetTargetMilestone\(milestone\.reset_to\)/);
    assert.match(orchestratorSource, /await (?:this|runner)\.allocateNextMilestoneId\(resetTo\)/);
    assert.match(orchestratorSource, /Athena reset planning anchor to/);
  });

  it('escalates a successful child milestone to parent rollup verification instead of jumping to root', () => {
    assert.match(orchestratorSource, /const isRollupVerification = !(?:this|runner)\.currentEpochPrId/);
    assert.match(orchestratorSource, /const parentMilestoneId = (?:this|runner)\.getParentMilestoneId\(completedMilestoneId\)/);
    assert.match(orchestratorSource, /Milestone verified — escalating completion check to parent milestone/);
    assert.match(orchestratorSource, /phase: 'verification'/);
    assert.match(orchestratorSource, /currentMilestoneId: parentMilestoneId/);
  });

  it('returns rollup verification failures to Athena without treating them as epoch PR failures', () => {
    const rollupFailBlock = orchestratorSource.match(/if \(isRollupVerification\) \{[\s\S]*?\n            \} else \{/)
    assert.ok(rollupFailBlock)
    const block = rollupFailBlock[0]
    assert.match(block, /Parent rollup verification incomplete — returning to Athena to plan the next child milestone/)
    assert.doesNotMatch(block, /markCurrentMilestoneFailed/)
  });

  it('gives Ares one grace review turn after worker budget exhaustion', () => {
    assert.match(orchestratorSource, /const aresGraceMode = (?:this|runner)\.milestoneCyclesUsed >= (?:this|runner)\.milestoneCyclesBudget/)
    assert.match(orchestratorSource, /if \(aresGraceMode && (?:this|runner)\.aresGraceCycleUsed\)/)
    assert.match(orchestratorSource, /Grace review mode:\*\* Worker budget is exhausted/)
    assert.match(orchestratorSource, /if \(aresGraceMode\) (?:this|runner)\.aresGraceCycleUsed = true/)
    assert.match(orchestratorSource, /Ares grace review did not claim completion/)
    assert.match(orchestratorSource, /Ignoring Ares schedule because grace review mode forbids worker scheduling/)
  });
});
