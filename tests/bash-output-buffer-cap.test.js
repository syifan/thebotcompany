import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeToolDetailed } from '../src/agent-runner.js';

const TRUNCATION_MARKER = '\n\n... (output truncated) ...\n\n';

describe('bash output buffering', () => {
  it('caps stdout while streaming and preserves head and tail output', async () => {
    const result = await executeToolDetailed(
      'Bash',
      {
        command: `node -e "process.stdout.write('A'.repeat(60000)); process.stdout.write('B'.repeat(60000));"`,
      },
      process.cwd(),
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.output.length, 50000 + TRUNCATION_MARKER.length + 50000);
    assert.ok(result.output.startsWith('A'.repeat(50000)));
    assert.ok(result.output.includes(TRUNCATION_MARKER));
    assert.ok(result.output.endsWith('B'.repeat(50000)));
  });

  it('preserves stdout then stderr formatting and appends exit code after capped stderr', async () => {
    const result = await executeToolDetailed(
      'Bash',
      {
        command: `node -e "process.stdout.write('stdout-head'); process.stderr.write('E'.repeat(60000)); process.stderr.write('F'.repeat(60000)); process.exit(7);"`,
      },
      process.cwd(),
    );

    assert.equal(result.exitCode, 7);
    assert.equal(result.ok, false);
    assert.ok(result.output.startsWith(`stdout-head\n${'E'.repeat(50000)}`));
    assert.ok(result.output.includes(TRUNCATION_MARKER));
    assert.ok(result.output.endsWith(`${'F'.repeat(50000)}\nExit code: 7`));
  });
});
