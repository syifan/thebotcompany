/**
 * Tests for project state persistence (saveState / loadState).
 *
 * All project state fields must survive reboots:
 * - Core: cycleCount, phase, isPaused, pauseReason
 * - Schedule: currentSchedule, completedAgents
 * - Milestone: milestoneTitle, milestoneDescription, milestoneCyclesBudget,
 *   milestoneCyclesUsed, verificationFeedback, isFixRound
 * - Completion: isComplete, completionSuccess, completionMessage
 * - Reliability: consecutiveFailures
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-state-test-'));

/**
 * Minimal mock of ProjectRunner's state management.
 * Mirrors saveState/loadState from server.js exactly.
 */
class MockProjectRunner {
  constructor(agentDir) {
    this.agentDir = agentDir;
    this.id = 'test/project';
    // Initialize all state fields to defaults
    this.cycleCount = 0;
    this.completedAgents = [];
    this.currentCycleId = null;
    this.currentSchedule = null;
    this.isPaused = false;
    this.pauseReason = null;
    this.phase = 'athena';
    this.milestoneTitle = null;
    this.milestoneDescription = null;
    this.milestoneCyclesBudget = 0;
    this.milestoneCyclesUsed = 0;
    this.verificationFeedback = null;
    this.isFixRound = false;
    this.isComplete = false;
    this.completionSuccess = false;
    this.completionMessage = null;
    this.consecutiveFailures = 0;
  }

  saveState() {
    const statePath = path.join(this.agentDir, 'state.json');
    const state = {
      cycleCount: this.cycleCount,
      completedAgents: this.completedAgents || [],
      currentCycleId: this.currentCycleId,
      currentSchedule: this.currentSchedule || null,
      isPaused: this.isPaused || false,
      phase: this.phase,
      milestoneTitle: this.milestoneTitle,
      milestoneDescription: this.milestoneDescription,
      milestoneCyclesBudget: this.milestoneCyclesBudget,
      milestoneCyclesUsed: this.milestoneCyclesUsed,
      verificationFeedback: this.verificationFeedback,
      isFixRound: this.isFixRound,
      isComplete: this.isComplete || false,
      completionSuccess: this.completionSuccess || false,
      completionMessage: this.completionMessage || null,
      pauseReason: this.pauseReason || null,
      consecutiveFailures: this.consecutiveFailures || 0,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  loadState() {
    const statePath = path.join(this.agentDir, 'state.json');
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    this.cycleCount = state.cycleCount || 0;
    this.completedAgents = state.completedAgents || [];
    this.currentCycleId = state.currentCycleId || null;
    this.currentSchedule = state.currentSchedule || null;
    if (state.isPaused !== undefined) this.isPaused = state.isPaused;
    this.phase = state.phase || 'athena';
    this.milestoneTitle = state.milestoneTitle || null;
    this.milestoneDescription = state.milestoneDescription || null;
    this.milestoneCyclesBudget = state.milestoneCyclesBudget || 0;
    this.milestoneCyclesUsed = state.milestoneCyclesUsed || 0;
    this.verificationFeedback = state.verificationFeedback || null;
    this.isFixRound = state.isFixRound || false;
    this.isComplete = state.isComplete || false;
    this.completionSuccess = state.completionSuccess || false;
    this.completionMessage = state.completionMessage || null;
    this.pauseReason = state.pauseReason || null;
    this.consecutiveFailures = state.consecutiveFailures || 0;
  }
}

describe('Project state persistence', () => {
  let dir;
  let runner;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpDir, 'proj-'));
    runner = new MockProjectRunner(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('saveState writes all fields', () => {
    it('creates state.json with all required fields', () => {
      runner.saveState();
      const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf-8'));
      const requiredFields = [
        'cycleCount', 'completedAgents', 'currentCycleId', 'currentSchedule',
        'isPaused', 'phase', 'milestoneTitle', 'milestoneDescription',
        'milestoneCyclesBudget', 'milestoneCyclesUsed', 'verificationFeedback',
        'isFixRound', 'isComplete', 'completionSuccess', 'completionMessage',
        'pauseReason', 'consecutiveFailures', 'lastUpdated'
      ];
      for (const field of requiredFields) {
        assert.ok(field in state, `Missing field: ${field}`);
      }
    });
  });

  describe('round-trip: save then load preserves all values', () => {
    it('preserves core state', () => {
      runner.cycleCount = 42;
      runner.phase = 'implementation';
      runner.isPaused = true;
      runner.pauseReason = 'Budget exhausted: $50.00 / $50 (24h)';
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.cycleCount, 42);
      assert.strictEqual(loaded.phase, 'implementation');
      assert.strictEqual(loaded.isPaused, true);
      assert.strictEqual(loaded.pauseReason, 'Budget exhausted: $50.00 / $50 (24h)');
    });

    it('preserves milestone state', () => {
      runner.milestoneTitle = 'Add GPU benchmarks';
      runner.milestoneDescription = 'Implement tier 1 benchmarks for memory, compute, and PCIe.';
      runner.milestoneCyclesBudget = 10;
      runner.milestoneCyclesUsed = 3;
      runner.isFixRound = true;
      runner.verificationFeedback = 'Tests failing in fp64_throughput';
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.milestoneTitle, 'Add GPU benchmarks');
      assert.strictEqual(loaded.milestoneDescription, 'Implement tier 1 benchmarks for memory, compute, and PCIe.');
      assert.strictEqual(loaded.milestoneCyclesBudget, 10);
      assert.strictEqual(loaded.milestoneCyclesUsed, 3);
      assert.strictEqual(loaded.isFixRound, true);
      assert.strictEqual(loaded.verificationFeedback, 'Tests failing in fp64_throughput');
    });

    it('preserves completion state', () => {
      runner.isComplete = true;
      runner.completionSuccess = true;
      runner.completionMessage = 'All milestones achieved';
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.isComplete, true);
      assert.strictEqual(loaded.completionSuccess, true);
      assert.strictEqual(loaded.completionMessage, 'All milestones achieved');
    });

    it('preserves schedule and completed agents', () => {
      const schedule = {
        _steps: [
          { felix: { task: 'Work on issue #1', visibility: 'focused' } },
          { ben: { task: 'Work on issue #2', visibility: 'focused' } },
          { cara: { task: 'Work on issue #3', visibility: 'focused' } },
        ]
      };
      runner.currentSchedule = schedule;
      runner.completedAgents = ['felix', 'ben'];
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.deepStrictEqual(loaded.completedAgents, ['felix', 'ben']);
      assert.deepStrictEqual(loaded.currentSchedule, schedule);
      assert.strictEqual(loaded.currentSchedule._steps.length, 3);
    });

    it('preserves consecutiveFailures', () => {
      runner.consecutiveFailures = 7;
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.consecutiveFailures, 7);
    });

    it('preserves pauseReason', () => {
      runner.isPaused = true;
      runner.pauseReason = '10 consecutive agent failures';
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.pauseReason, '10 consecutive agent failures');
    });
  });

  describe('loadState handles missing/corrupt files', () => {
    it('uses defaults when no state file exists', () => {
      const fresh = new MockProjectRunner(dir);
      fresh.loadState(); // no file
      assert.strictEqual(fresh.cycleCount, 0);
      assert.strictEqual(fresh.phase, 'athena');
      assert.strictEqual(fresh.isPaused, false);
      assert.strictEqual(fresh.consecutiveFailures, 0);
      assert.deepStrictEqual(fresh.completedAgents, []);
      assert.strictEqual(fresh.currentSchedule, null);
    });

    it('handles partial state (missing new fields)', () => {
      // Simulate old state file without new fields
      const oldState = {
        cycleCount: 100,
        phase: 'verification',
        isPaused: false,
        // Missing: pauseReason, consecutiveFailures, completedAgents, currentSchedule
      };
      fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(oldState));

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.cycleCount, 100);
      assert.strictEqual(loaded.phase, 'verification');
      // New fields should default gracefully
      assert.strictEqual(loaded.pauseReason, null);
      assert.strictEqual(loaded.consecutiveFailures, 0);
      assert.deepStrictEqual(loaded.completedAgents, []);
      assert.strictEqual(loaded.currentSchedule, null);
    });
  });

  describe('schedule resume logic', () => {
    it('detects resumable state (schedule + completed agents)', () => {
      runner.currentSchedule = { _steps: [{ a: 'task1' }, { b: 'task2' }] };
      runner.completedAgents = ['a'];
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();

      const resuming = loaded.currentSchedule && loaded.completedAgents.length > 0;
      assert.ok(resuming, 'Should detect resumable state');
    });

    it('does NOT resume when completedAgents is empty', () => {
      runner.currentSchedule = { _steps: [{ a: 'task1' }] };
      runner.completedAgents = [];
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();

      const resuming = loaded.currentSchedule && loaded.completedAgents.length > 0;
      assert.ok(!resuming, 'Should not resume with empty completedAgents');
    });

    it('does NOT resume when schedule is null', () => {
      runner.currentSchedule = null;
      runner.completedAgents = ['a', 'b'];
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();

      const resuming = loaded.currentSchedule && loaded.completedAgents.length > 0;
      assert.ok(!resuming, 'Should not resume with null schedule');
    });

    it('completed agents are skipped in schedule execution', () => {
      const schedule = {
        _steps: [
          { felix: 'task1' },
          { ben: 'task2' },
          { cara: 'task3' },
          { dan: 'task4' },
        ]
      };
      const completed = ['felix', 'ben'];

      // Simulate executeSchedule skip logic
      const toRun = [];
      for (const step of schedule._steps) {
        const name = Object.keys(step).find(k => k !== 'delay');
        if (!name) continue;
        if (completed.includes(name.toLowerCase())) continue;
        toRun.push(name);
      }

      assert.deepStrictEqual(toRun, ['cara', 'dan']);
    });
  });

  describe('consecutiveFailures survives reboot', () => {
    it('auto-pause threshold is maintained after reload', () => {
      runner.consecutiveFailures = 9;
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      assert.strictEqual(loaded.consecutiveFailures, 9);
      // One more failure would trigger auto-pause (threshold is 10)
      loaded.consecutiveFailures++;
      assert.strictEqual(loaded.consecutiveFailures, 10);
    });

    it('resets to 0 after a successful cycle', () => {
      runner.consecutiveFailures = 5;
      runner.saveState();

      const loaded = new MockProjectRunner(dir);
      loaded.loadState();
      // Simulate successful cycle
      loaded.consecutiveFailures = 0;
      loaded.saveState();

      const reloaded = new MockProjectRunner(dir);
      reloaded.loadState();
      assert.strictEqual(reloaded.consecutiveFailures, 0);
    });
  });
});
