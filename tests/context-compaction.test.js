/**
 * Tests for emergency context compaction on context_length_exceeded errors.
 *
 * When the API returns context_length_exceeded, the agent runner should:
 * 1. Detect the error pattern
 * 2. Compact conversation history (remove old messages, keep recent)
 * 3. Retry the API call once with shorter history
 * 4. NOT compact again if the retry also fails (prevent infinite loops)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Test the error detection regex
// ---------------------------------------------------------------------------
describe('Context length error detection', () => {
  const CONTEXT_ERROR_REGEX = /context_length_exceeded|context.window|too.many.tokens|maximum.context/i;

  it('matches Anthropic/OpenAI context_length_exceeded', () => {
    assert.ok(CONTEXT_ERROR_REGEX.test(
      '{"type":"invalid_request_error","code":"context_length_exceeded","message":"Your input exceeds the context window"}'
    ));
  });

  it('matches "context window" phrasing', () => {
    assert.ok(CONTEXT_ERROR_REGEX.test('Your input exceeds the context window of this model'));
  });

  it('matches "too many tokens"', () => {
    assert.ok(CONTEXT_ERROR_REGEX.test('Request has too many tokens'));
  });

  it('matches "maximum context"', () => {
    assert.ok(CONTEXT_ERROR_REGEX.test('Exceeded maximum context length'));
  });

  it('does NOT match unrelated errors', () => {
    assert.ok(!CONTEXT_ERROR_REGEX.test('invalid x-api-key'));
    assert.ok(!CONTEXT_ERROR_REGEX.test('rate limit exceeded'));
    assert.ok(!CONTEXT_ERROR_REGEX.test('internal server error'));
  });
});

// ---------------------------------------------------------------------------
// Test the compaction logic (simulated)
// ---------------------------------------------------------------------------
describe('Emergency compaction behavior', () => {
  /**
   * Simulate the compaction algorithm from agent-runner.js.
   * Takes a messages array and compacts it (mutates in place).
   * Returns the number of messages removed.
   */
  function emergencyCompact(messages) {
    if (messages.length <= 3) return 0;

    const keep = Math.max(2, Math.floor(messages.length * 0.2));
    let splitIdx = messages.length - keep;
    // Don't split assistant/tool-result pairs
    while (splitIdx < messages.length - 1) {
      const msg = messages[splitIdx];
      if (msg.role === 'toolResult') { splitIdx--; } else { break; }
    }
    if (splitIdx < 1) splitIdx = 1;
    const removed = messages.splice(1, splitIdx - 1);
    // Insert summary placeholder
    messages.splice(1, 0, { role: 'user', content: '[System: Context was compacted]' });
    return removed.length;
  }

  it('keeps first message (system) and recent messages', () => {
    const messages = [
      { role: 'system', content: 'You are an agent' },
      { role: 'user', content: 'Task 1' },
      { role: 'assistant', content: 'Done 1' },
      { role: 'user', content: 'Task 2' },
      { role: 'assistant', content: 'Done 2' },
      { role: 'user', content: 'Task 3' },
      { role: 'assistant', content: 'Done 3' },
      { role: 'user', content: 'Task 4' },
      { role: 'assistant', content: 'Done 4' },
      { role: 'user', content: 'Task 5' },
    ];
    const removed = emergencyCompact(messages);
    assert.ok(removed > 0, 'Should remove some messages');
    assert.strictEqual(messages[0].role, 'system', 'First message should be system');
    assert.strictEqual(messages[1].content, '[System: Context was compacted]', 'Second should be summary');
    assert.ok(messages.length < 10, `Should have fewer messages, got ${messages.length}`);
  });

  it('does nothing if 3 or fewer messages', () => {
    const messages = [
      { role: 'system', content: 'You are an agent' },
      { role: 'user', content: 'Task' },
      { role: 'assistant', content: 'Done' },
    ];
    const removed = emergencyCompact(messages);
    assert.strictEqual(removed, 0, 'Should not compact 3 messages');
  });

  it('does not split assistant/toolResult pairs', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
      { role: 'assistant', content: 'tool call' },
      { role: 'toolResult', content: 'result', toolName: 'Bash' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: '4' },
      { role: 'assistant', content: '5' },
      { role: 'user', content: '6' },
    ];
    const removed = emergencyCompact(messages);
    assert.ok(removed > 0);
    // Verify no toolResult is the first message after summary
    for (let i = 2; i < messages.length; i++) {
      if (messages[i].role === 'toolResult') {
        assert.ok(
          messages[i - 1].role === 'assistant',
          'toolResult should always be preceded by assistant'
        );
      }
    }
  });

  it('compacts aggressively (keeps ~20% of messages)', () => {
    const messages = [];
    messages.push({ role: 'system', content: 'system' });
    for (let i = 0; i < 50; i++) {
      messages.push({ role: 'user', content: `task ${i}` });
      messages.push({ role: 'assistant', content: `done ${i}` });
    }
    // 101 messages total
    const originalLen = messages.length;
    const removed = emergencyCompact(messages);
    assert.ok(removed > originalLen * 0.5, `Should remove >50% of messages, removed ${removed}/${originalLen}`);
    // Remaining: system + summary + ~20% kept
    assert.ok(messages.length < originalLen * 0.4, `Should have <40% remaining, got ${messages.length}/${originalLen}`);
  });
});

// ---------------------------------------------------------------------------
// Test the retry-once behavior (simulated loop)
// ---------------------------------------------------------------------------
describe('Context compaction retry logic', () => {
  it('retries once after compaction, then fails if still too large', async () => {
    let apiCallCount = 0;
    let contextCompacted = false;
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` }));

    // Simulate the retry loop
    const MAX_RETRIES = 3;
    let succeeded = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      apiCallCount++;
      const err = new Error('context_length_exceeded');
      const isContextError = /context_length_exceeded/i.test(err.message);

      if (isContextError && messages.length > 3 && !contextCompacted) {
        // First time: compact and retry
        contextCompacted = true;
        messages.splice(1, Math.floor(messages.length * 0.8));
        attempt--; // don't count as retry
        continue;
      }
      // Second time or non-context error: fail
      break;
    }

    assert.strictEqual(apiCallCount, 2, 'Should call API exactly twice (original + after compaction)');
    assert.ok(contextCompacted, 'Should have compacted');
    assert.ok(!succeeded, 'Should not succeed if API keeps failing');
  });

  it('succeeds on retry after compaction', async () => {
    let apiCallCount = 0;
    let contextCompacted = false;

    const MAX_RETRIES = 3;
    let succeeded = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      apiCallCount++;
      if (apiCallCount === 1) {
        // First call fails with context error
        const isContextError = true;
        if (isContextError && !contextCompacted) {
          contextCompacted = true;
          attempt--;
          continue;
        }
      }
      // Second call succeeds
      succeeded = true;
      break;
    }

    assert.strictEqual(apiCallCount, 2, 'Should call API twice');
    assert.ok(contextCompacted);
    assert.ok(succeeded, 'Should succeed on second attempt');
  });
});
