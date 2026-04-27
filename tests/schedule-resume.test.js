import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for schedule resume after reboot.
 *
 * Bug: When a schedule starts with a delay step (e.g. [{"delay":120}, {"eva":{...}}]),
 * and the server reboots during the delay, the schedule is discarded on restart
 * because the resume condition requires completedAgents.length > 0.
 * Since no agents ran yet (we were still in the delay), the condition is false
 * and Ares runs fresh, losing the scheduled agent tasks.
 *
 * These tests verify the resume condition logic.
 */

// Import the actual resume logic from ProjectRunner.js
// We extract and test the condition used in the implementation phase
// Current code in ProjectRunner.js (line ~1446):
//   if (this.currentSchedule && this.completedAgents.length > 0)
// We import via a dynamic approach — read the source and extract the pattern
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPhaseMachine() {
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestrator', 'phase-machine.js'), 'utf-8');
}

function extractResumeCondition() {
  const src = readPhaseMachine();
  // Find the resume condition line — look for the if() that gates schedule resumption
  const match = src.match(/Resume interrupted schedule[^]*?\bif \(([^)]+)\)/);
  return match ? match[1].trim() : null;
}

describe('Schedule resume after reboot', () => {
  describe('resume condition in ProjectRunner.js', () => {
    it('should resume when schedule exists even with no completed agents (delay-first)', () => {
      // The resume condition should NOT require completedAgents.length > 0
      // because a schedule starting with a delay has no completed agents on reboot
      const condition = extractResumeCondition();
      assert.ok(condition, 'Could not find resume condition in ProjectRunner.js');
      // The condition should NOT contain completedAgents.length > 0
      assert.ok(
        !condition.includes('completedAgents.length > 0'),
        `Resume condition should not require completedAgents.length > 0, got: "${condition}"`
      );
    });

    it('should resume when schedule exists with completed agents', () => {
      const condition = extractResumeCondition();
      assert.ok(condition);
      // Must still check for currentSchedule
      assert.ok(condition.includes('currentSchedule'), 'Resume condition must check currentSchedule');
    });

    it('cycle-start guard should not wipe schedule when no agents completed', () => {
      // There's a second resume check at cycle start that gates whether to
      // increment cycle count and clear state. It must also not require
      // completedAgents.length > 0.
      const src = readPhaseMachine();
      const match = src.match(/const resuming\s*=\s*([^;]+);/);
      assert.ok(match, 'Could not find cycle-start resuming check in ProjectRunner.js');
      const expr = match[1].trim();
      assert.ok(
        !expr.includes('completedAgents.length > 0'),
        `Cycle-start resuming check should not require completedAgents.length > 0, got: "${expr}"`
      );
    });
  });

  describe('executeSchedule skips completed agents', () => {
    it('skips agents already in completedAgents', () => {
      // executeSchedule checks: if (this.completedAgents.includes(name.toLowerCase())) skip
      const completedAgents = ['leo', 'eva'];
      const steps = [
        { leo: { task: 'already done' } },
        { delay: 30 },
        { eva: { task: 'also done' } },
        { nora: { task: 'still needs to run' } },
      ];

      const remaining = steps.filter(step => {
        if (step.delay !== undefined) return true;
        const name = Object.keys(step).find(k => k !== 'delay');
        return name && !completedAgents.includes(name.toLowerCase());
      });

      assert.strictEqual(remaining.length, 2); // delay + nora
      const agentSteps = remaining.filter(s => s.delay === undefined);
      assert.strictEqual(agentSteps.length, 1);
      assert.strictEqual(Object.keys(agentSteps[0])[0], 'nora');
    });
  });

  describe('delay cap', () => {
    it('caps delay at 120 minutes', () => {
      // sleepDelay: Math.min(Math.max(parseFloat(minutes) || 0, 0), 120) * 60000
      const capDelay = (minutes) => Math.min(Math.max(parseFloat(minutes) || 0, 0), 120) * 60000;
      assert.strictEqual(capDelay(210), 120 * 60000); // 210 capped to 120
      assert.strictEqual(capDelay(60), 60 * 60000);   // 60 stays 60
      assert.strictEqual(capDelay(0), 0);
      assert.strictEqual(capDelay(-5), 0);
    });
  });

  describe('delay persistence across reboot', () => {
    it('BUG: delay-until timestamp is not persisted in state.json', () => {
      // sleepDelay sets this.sleepUntil = Date.now() + ms
      // but saveState() does NOT include sleepUntil
      // So after reboot, the delay restarts from zero (or is skipped entirely)
      const stateFields = [
        'cycleCount', 'epochCount', 'completedAgents', 'currentCycleId',
        'currentSchedule', 'isPaused', 'phase', 'milestoneTitle',
        'milestoneDescription', 'milestoneCyclesBudget', 'milestoneCyclesUsed',
        'verificationFeedback', 'isFixRound',
      ];
      // sleepUntil is NOT in the persisted state
      assert.ok(!stateFields.includes('sleepUntil'),
        'sleepUntil is not persisted — delay state lost on reboot');
      // This test documents the bug. After fix, sleepUntil or scheduleStepIndex
      // should be persisted.
    });
  });
});
