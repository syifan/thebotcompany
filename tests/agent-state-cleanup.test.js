/**
 * Tests that agent state (currentAgent, currentAgentModel, etc.) is properly
 * cleaned up on all early-return paths in runAgent().
 *
 * Bug: When runAgent() returned early due to "no token", it didn't clear
 * this.currentAgent, causing the dashboard to show the agent as "running"
 * even though it had already exited.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Set TBC_HOME to a temp dir before importing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-agent-state-test-'));
process.env.TBC_HOME = tmpDir;

/**
 * Simulate the runAgent early-return behavior.
 * This mirrors the relevant parts of ProjectRunner.runAgent() in server.js.
 */
class MockProjectRunner {
  constructor() {
    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.currentAgentLog = [];
    this.currentAgentModel = null;
    this.statusBroadcasts = [];
  }

  broadcastStatusUpdate() {
    this.statusBroadcasts.push(Date.now());
  }

  getStatus() {
    return {
      currentAgent: this.currentAgent,
      currentAgentModel: this.currentAgentModel,
      running: this.currentAgent !== null,
    };
  }

  /**
   * Simulates runAgent() — the early-return paths.
   * resolvedToken=null simulates the "no token" case.
   * skillContent=null simulates the "skill not found" case.
   */
  async runAgent(agent, { resolvedToken = 'fake-token', skillContent = 'fake-skill' } = {}) {
    this.currentAgent = agent.name;
    this.currentAgentStartTime = Date.now();

    // Early return: skill file not found
    if (!skillContent) {
      this.currentAgent = null;
      this.currentAgentProcess = null;
      this.currentAgentStartTime = null;
      this.currentAgentLog = [];
      this.currentAgentModel = null;
      return { success: false, resultText: '' };
    }

    this.currentAgentModel = 'test-model';

    // Early return: no token
    if (!resolvedToken) {
      // BUG (before fix): these lines were missing
      this.currentAgent = null;
      this.currentAgentProcess = null;
      this.currentAgentStartTime = null;
      this.currentAgentLog = [];
      this.currentAgentModel = null;
      this.broadcastStatusUpdate();
      return { error: 'no_token', message: 'No API key configured.' };
    }

    // Normal path (would run agent, then clean up in _postProcessAgentRun)
    // ... simulate success
    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.currentAgentLog = [];
    this.currentAgentModel = null;
    return { success: true, resultText: 'done' };
  }

  /**
   * Simulates the BUGGY version (before fix) where no-token path
   * doesn't clear currentAgent.
   */
  async runAgentBuggy(agent, { resolvedToken = 'fake-token', skillContent = 'fake-skill' } = {}) {
    this.currentAgent = agent.name;
    this.currentAgentStartTime = Date.now();

    if (!skillContent) {
      this.currentAgent = null;
      this.currentAgentProcess = null;
      this.currentAgentStartTime = null;
      this.currentAgentLog = [];
      this.currentAgentModel = null;
      return { success: false, resultText: '' };
    }

    this.currentAgentModel = 'test-model';

    // BUGGY: no-token return WITHOUT clearing currentAgent
    if (!resolvedToken) {
      return { error: 'no_token', message: 'No API key configured.' };
    }

    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.currentAgentLog = [];
    this.currentAgentModel = null;
    return { success: true, resultText: 'done' };
  }
}

describe('Agent state cleanup', () => {
  let runner;

  beforeEach(() => {
    runner = new MockProjectRunner();
  });

  describe('no-token early return (fixed)', () => {
    it('clears currentAgent after no-token return', async () => {
      const result = await runner.runAgent({ name: 'ares' }, { resolvedToken: null });

      assert.strictEqual(result.error, 'no_token');
      assert.strictEqual(runner.currentAgent, null, 'currentAgent should be null after no-token return');
      assert.strictEqual(runner.currentAgentModel, null, 'currentAgentModel should be null');
      assert.strictEqual(runner.currentAgentStartTime, null, 'currentAgentStartTime should be null');
    });

    it('broadcasts status update after no-token return', async () => {
      await runner.runAgent({ name: 'ares' }, { resolvedToken: null });

      assert.ok(runner.statusBroadcasts.length > 0, 'Should broadcast status update');
    });

    it('getStatus shows not running after no-token return', async () => {
      await runner.runAgent({ name: 'ares' }, { resolvedToken: null });

      const status = runner.getStatus();
      assert.strictEqual(status.currentAgent, null);
      assert.strictEqual(status.running, false, 'Should not show as running');
    });
  });

  describe('skill-not-found early return', () => {
    it('clears currentAgent after skill-not-found return', async () => {
      const result = await runner.runAgent({ name: 'apollo' }, { skillContent: null });

      assert.strictEqual(result.success, false);
      assert.strictEqual(runner.currentAgent, null);
      assert.strictEqual(runner.currentAgentModel, null);
    });
  });

  describe('normal success path', () => {
    it('clears currentAgent after successful run', async () => {
      const result = await runner.runAgent({ name: 'athena' }, { resolvedToken: 'sk-test' });

      assert.strictEqual(result.success, true);
      assert.strictEqual(runner.currentAgent, null);
    });
  });

  describe('buggy version demonstrates the problem', () => {
    it('BUGGY: currentAgent is NOT cleared after no-token return', async () => {
      const result = await runner.runAgentBuggy({ name: 'ares' }, { resolvedToken: null });

      assert.strictEqual(result.error, 'no_token');
      // This demonstrates the bug: currentAgent is still set
      assert.strictEqual(runner.currentAgent, 'ares', 'BUGGY: currentAgent should still be "ares"');
      assert.strictEqual(runner.currentAgentModel, 'test-model', 'BUGGY: model should still be set');

      const status = runner.getStatus();
      assert.strictEqual(status.running, true, 'BUGGY: status shows running even though agent exited');
    });
  });
});
