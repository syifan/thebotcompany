/**
 * Tests for agent retry logic and timeout behavior.
 *
 * The orchestrator should:
 * - Retry on transient failures (API errors, etc.)
 * - NOT retry when agent fails due to timeout (wastes budget, agent likely can't finish)
 * - Always generate a report, even on timeout
 *
 * Run: node --test tests/agent-retry.test.js
 */
import { describe, it, mock } from 'node:test';
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
// Extract the retry logic from the orchestrator (mirrors server.js ~1210-1230)
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
      if (!wasTimeout) break; // Only retry on timeout, not other failures
      attempt++;
    }
  }

  return { succeeded, lastResult, results, attempts: results.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Agent retry logic', () => {
  describe('retry on transient failure', () => {
    it('retries on non-timeout failure', async () => {
      const runAgent = mock.fn(async () => makeResult({ success: false, timedOut: false, resultText: 'API error' }));

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, false);
      // Should retry on transient (non-timeout) failures
      assert.ok(attempts > 1, `expected retries on transient failure, got ${attempts} attempt(s)`);
    });

    it('succeeds on retry after transient failure', async () => {
      const runAgent = mock.fn(async (attempt) => {
        if (attempt === 0) return makeResult({ success: false, timedOut: false });
        return makeResult({ success: true, resultText: 'recovered' });
      });

      const { succeeded, lastResult, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, true);
      assert.equal(attempts, 2);
      assert.equal(lastResult.resultText, 'recovered');
    });
  });

  describe('no retry on timeout', () => {
    it('does NOT retry when agent fails due to timeout', async () => {
      const runAgent = mock.fn(async () => makeResult({ success: false, timedOut: true, resultText: 'Agent timed out' }));

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, false);
      // Timeout = do not retry (agent can't finish in time, retrying wastes budget)
      assert.equal(attempts, 1, 'should not retry on timeout');
      assert.equal(runAgent.mock.calls.length, 1, 'runAgent should only be called once');
    });
  });

  describe('success path', () => {
    it('succeeds immediately on first attempt', async () => {
      const runAgent = mock.fn(async () => makeResult({ success: true, resultText: 'done' }));

      const { succeeded, attempts } = await runWorkerWithRetries(runAgent);

      assert.equal(succeeded, true);
      assert.equal(attempts, 1);
    });
  });

  describe('report generation on timeout', () => {
    it('timeout result includes killedByTimeout flag for report', async () => {
      const runAgent = mock.fn(async () =>
        makeResult({ success: false, timedOut: true, resultText: 'partial work on server.js' })
      );

      const { lastResult } = await runWorkerWithRetries(runAgent);

      assert.equal(lastResult.killedByTimeout, true);
      assert.ok(lastResult.resultText.includes('partial work'));
    });

    it('timeout with empty resultText still has killedByTimeout flag', async () => {
      const runAgent = mock.fn(async () =>
        makeResult({ success: false, timedOut: true, resultText: '' })
      );

      const { lastResult } = await runWorkerWithRetries(runAgent);

      assert.equal(lastResult.killedByTimeout, true);
    });
  });
});
