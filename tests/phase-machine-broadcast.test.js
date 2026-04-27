import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

describe('phase-machine broadcast event dependency', () => {
  it('binds broadcastEvent from deps before phase transitions use it', () => {
    const src = readSource('src/orchestrator/phase-machine.js');

    assert.match(
      src,
      /const\s+broadcastEvent\s*=\s*deps\.broadcastEvent\s*\|\|\s*\(\(\)\s*=>\s*\{\}\);/,
      'runRunnerLoop should bind broadcastEvent from deps with a no-op fallback'
    );
  });

  it('passes broadcastEvent into runRunnerLoop from ProjectRunner', () => {
    const src = readSource('src/orchestrator/ProjectRunner.js');

    assert.match(
      src,
      /runRunnerLoop\(this,\s*\{[^}]*broadcastEvent[^}]*\}\)/s,
      'ProjectRunner.runLoop should pass broadcastEvent into phase-machine deps'
    );
  });
});
