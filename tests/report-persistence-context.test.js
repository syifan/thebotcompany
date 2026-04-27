import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('agent report persistence context', () => {
  it('writes reports using the runner instance, not module this', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestrator', 'agent-runtime.js'), 'utf-8');

    assert.match(src, /writeRunnerReport\(runner,\s*agent\.name,\s*reportBody,/);
    assert.doesNotMatch(src, /writeRunnerReport\(this,\s*agent\.name,\s*reportBody,/);
  });
});
