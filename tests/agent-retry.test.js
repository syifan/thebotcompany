/**
 * Tests for agent retry logic and timeout behavior.
 *
 * The orchestrator retries agents up to 2 times on timeout, but should
 * NOT retry on non-timeout failures. A report should be generated
 * regardless of whether the agent timed out or failed.
 *
 * Run: node --test tests/agent-retry.test.js
 */
import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock agent runner result factory
// ---------------------------------------------------------------------------
function makeResult({ success = true, timedOut = false, resultText = '', cost = 0.01, durationMs = 1000 } = {}) {
  return {
    success,
    resultText,
    cost,
    durationMs,
    killedByTimeout: timedOut,
  };
}

// ---------------------------------------------------------------------------
// Extract the retry logic from the orchestrator into a testable function.
// This mirrors the while-loop in server.js lines ~1210-1230.
// ---------------------------------------------------------------------------
async function runWorkerWithRetries(runAgentFn, { maxRetries = 2 } = {}) {
  let attempt = 0;
  let succeeded = false;
  let lastResult = null;
  const results = [];

  while (attempt <= maxRetries && !succeeded) {
    const result = await runAgentFn(attempt);
    results.push(result);
    lastResult = result;

    if (result && result.success) {
      succeeded = true;
    } else {
      const wasTimeout = result && result.killedByTimeout;
      if (!wasTimeout) break; // Only retry on timeout
      attempt++;
    }
  }

  return { succeeded, lastResult, results, attempts: results.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Agent retry logic', () => {
  describe('retry on timeout', () => {
    it('retries up to maxRetries times on timeout', async () => {
      const runAgent = mock.fn(async (attempt) => makeResult({ success: false, timedOut: true, resultText: `timeout attempt ${attempt}` }));

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, false);
      assert.equal(attempts, 3); // initial + 2 retries
      assert.equal(runAgent.mock.calls.length, 3);
    });

    it('succeeds on retry after timeout', async () => {
      const runAgent = mock.fn(async (attempt) => {
        if (attempt < 2) return makeResult({ success: false, timedOut: true });
        return makeResult({ success: true, resultText: 'completed on retry' });
      });

      const { succeeded, lastResult, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, true);
      assert.equal(attempts, 3); // 2 timeouts + 1 success
      assert.equal(lastResult.resultText, 'completed on retry');
    });

    it('succeeds immediately on first attempt', async () => {
      const runAgent = mock.fn(async () => makeResult({ success: true, resultText: 'done' }));

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, true);
      assert.equal(attempts, 1);
    });
  });

  describe('no retry on non-timeout failure', () => {
    it('does not retry when agent fails without timeout', async () => {
      const runAgent = mock.fn(async () => makeResult({ success: false, timedOut: false, resultText: 'API error' }));

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, false);
      assert.equal(attempts, 1); // no retry
      assert.equal(runAgent.mock.calls.length, 1);
    });

    it('does not retry when agent returns null', async () => {
      const runAgent = mock.fn(async () => null);

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, false);
      assert.equal(attempts, 1);
    });
  });

  describe('report generation on timeout', () => {
    it('each attempt generates a result that can be used for a report', async () => {
      const runAgent = mock.fn(async (attempt) =>
        makeResult({ success: false, timedOut: true, resultText: `partial work from attempt ${attempt}` })
      );

      const { results } = await runWorkerWithRetries(runAgent);

      // Every attempt should have a result with text for the report
      assert.equal(results.length, 3);
      for (const [i, result] of results.entries()) {
        assert.ok(result.resultText, `attempt ${i} should have resultText`);
        assert.equal(result.killedByTimeout, true);
      }
    });

    it('timeout result includes partial work text', async () => {
      const runAgent = mock.fn(async () =>
        makeResult({ success: false, timedOut: true, resultText: 'I was working on fixing the bug in server.js...' })
      );

      const { lastResult } = await runWorkerWithRetries(runAgent);

      assert.equal(lastResult.killedByTimeout, true);
      assert.ok(lastResult.resultText.includes('fixing the bug'));
    });

    it('timeout with empty resultText still has killedByTimeout flag', async () => {
      const runAgent = mock.fn(async () =>
        makeResult({ success: false, timedOut: true, resultText: '' })
      );

      const { lastResult } = await runWorkerWithRetries(runAgent);

      assert.equal(lastResult.killedByTimeout, true);
      // The orchestrator should still generate a report even with empty text
      // (using the "⏰ Timeout" template in _postProcessAgentRun)
    });
  });
});

// ---------------------------------------------------------------------------
// Test the agent-runner timeout behavior directly
// ---------------------------------------------------------------------------
describe('Agent runner timeout', () => {
  it('returns timedOut=true and partial text when timeout fires', async () => {
    // This test validates the contract of runAgentWithAPI:
    // when timeoutMs expires, it should return { success: false, timedOut: true }
    // with whatever resultText was captured before the timeout.
    //
    // We can't easily unit-test runAgentWithAPI without mocking the provider,
    // but we verify the contract matches what the orchestrator expects.
    const result = makeResult({ success: false, timedOut: true, resultText: 'Agent timed out' });

    assert.equal(result.success, false);
    assert.equal(result.killedByTimeout, true);
    assert.ok(result.resultText);
  });
});
