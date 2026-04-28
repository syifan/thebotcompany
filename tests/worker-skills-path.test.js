import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'orchestrator', 'ProjectRunner.js');
const stateControlPath = path.join(__dirname, '..', 'src', 'orchestrator', 'state-control.js');

function read(file) {
  return fs.readFileSync(file, 'utf-8');
}

describe('worker skill directory layout', () => {
  it('stores worker skills under skills/workers', () => {
    const src = read(serverPath);
    assert.ok(src.includes("get skillsDir()"), 'Expected skillsDir getter in ProjectRunner.js');
    assert.ok(src.includes("get workerSkillsDir()"), 'Expected workerSkillsDir getter in ProjectRunner.js');
    assert.ok(src.includes("path.join(this.skillsDir, 'workers')"), 'Expected worker skills under skills/workers');
  });


  it('creates the new skills/workers control-plane directories at startup', () => {
    const src = `${read(serverPath)}\n${read(stateControlPath)}`;
    assert.ok(/(?:this|runner)\.workerSkillsDir/.test(src), 'Expected startup to create skills/workers');
    assert.ok(/(?:this|runner)\.agentsDir/.test(src), 'Expected startup to create agent directories');
  });
});
