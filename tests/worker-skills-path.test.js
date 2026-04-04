import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const managerPromptPath = path.join(__dirname, '..', 'agent', 'manager.md');
const everyonePromptPath = path.join(__dirname, '..', 'agent', 'everyone.md');

function read(file) {
  return fs.readFileSync(file, 'utf-8');
}

describe('worker skill directory layout', () => {
  it('stores worker skills under skills/workers instead of the legacy workers dir', () => {
    const src = read(serverPath);
    assert.ok(src.includes("get skillsDir()"), 'Expected skillsDir getter in server.js');
    assert.ok(src.includes("get workerSkillsDir()"), 'Expected workerSkillsDir getter in server.js');
    assert.ok(src.includes("path.join(this.skillsDir, 'workers')"), 'Expected worker skills under skills/workers');
  });

  it('migrates the legacy workspace/workers directory to skills/workers', () => {
    const src = read(serverPath);
    assert.ok(src.includes("const legacyDir = path.join(this.agentDir, 'workers')"), 'Expected legacy workers dir reference for migration');
    assert.ok(src.includes("fs.renameSync(legacyDir, dir)"), 'Expected legacy workers dir migration');
  });

  it('creates the new skills/workers control-plane directories at startup', () => {
    const src = read(serverPath);
    assert.ok(src.includes("path.join('skills', 'workers')"), 'Expected startup to create skills/workers');
    assert.ok(src.includes("'workspace'"), 'Expected startup to keep per-agent workspace dir');
  });

  it('updates manager-facing prompts to use skills/workers', () => {
    const managerPrompt = read(managerPromptPath);
    const everyonePrompt = read(everyonePromptPath);
    assert.ok(managerPrompt.includes('{project_dir}/skills/workers/'));
    assert.ok(everyonePrompt.includes('{project_dir}/skills/workers/'));
    assert.ok(!managerPrompt.includes('{project_dir}/workers/'));
    assert.ok(!everyonePrompt.includes('{project_dir}/workers/'));
  });
});
