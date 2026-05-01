import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeTool, executeToolDetailed } from '../src/agent-runner.js';
import { startRunner } from '../src/orchestrator/state-control.js';

describe('exception containment boundaries', () => {
  it('returns a tool error instead of throwing for malformed Bash input', async () => {
    const result = await executeTool('Bash', {}, os.tmpdir());
    assert.match(result, /invalid Bash tool input: command must be a string/i);
  });

  it('normalizes malformed Bash input as a failed structured tool result', async () => {
    const result = await executeToolDetailed('Bash', { command: undefined }, os.tmpdir());
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.match(result.output, /invalid Bash tool input: command must be a string/i);
  });

  it('contains project runner loop crashes to the project', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-runner-crash-'));
    const events = [];
    const runner = {
      id: 'owner/repo',
      path: root,
      projectDir: path.join(root, '.tbc'),
      chatsDir: path.join(root, '.tbc', 'chats'),
      agentsDir: path.join(root, '.tbc', 'agents'),
      responsesDir: path.join(root, '.tbc', 'responses'),
      skillsDir: path.join(root, '.tbc', 'skills'),
      knowledgeDir: path.join(root, '.tbc', 'knowledge'),
      workerSkillsDir: path.join(root, '.tbc', 'skills', 'workers'),
      running: false,
      loadState() {},
      runLoop: async () => { throw new Error('boom'); },
      setState(state) { this.state = { ...(this.state || {}), ...state }; },
    };

    await startRunner(runner, {
      log: (msg, projectId) => events.push({ type: 'log', msg, projectId }),
      broadcastEvent: (event) => events.push({ type: 'event', event }),
      broadcastStatusUpdate: (projectId) => events.push({ type: 'status', projectId }),
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(runner.running, false);
    assert.equal(runner.state.isPaused, true);
    assert.match(runner.state.pauseReason, /Project runner crashed: boom/);
    assert.ok(events.some(e => e.type === 'event' && e.event.type === 'error'));
  });
});

import { executeToolDetailed as _executeToolDetailed } from '../src/agent-runner.js';

describe('trusted tbc-db routing', () => {
  it('routes decorated tbc-db commands through the trusted boundary instead of sandboxing project.db', async () => {
    const result = await _executeToolDetailed(
      'Bash',
      { command: 'set +e\ntbc-db issue-list | sed -n \'1,5p\'\nrc=$?\necho rc=$rc' },
      os.tmpdir(),
      0,
      { TBC_DB: '/tmp/does-not-exist/project.db' },
      null,
      null,
      { read: [os.tmpdir()], write: [os.tmpdir()], denied: ['/tmp/does-not-exist/project.db'], dbPath: '/tmp/does-not-exist/project.db' },
      { mode: 'full', issues: [], actor: 'athena' },
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /unable to open database file|SQLITE_CANTOPEN|Cannot open/i);
    assert.doesNotMatch(result.output, /Operation not permitted|access denied/i);
  });

  it('rejects unsupported complex tbc-db loops before the normal sandbox can emit SQLITE_CANTOPEN', async () => {
    const result = await _executeToolDetailed(
      'Bash',
      { command: 'for id in 1 2; do tbc-db issue-view $id; done' },
      os.tmpdir(),
      0,
      { TBC_DB: '/tmp/project.db' },
      null,
      null,
      { read: [os.tmpdir()], write: [os.tmpdir()], denied: ['/tmp/project.db'], dbPath: '/tmp/project.db' },
      { mode: 'full', issues: [], actor: 'athena' },
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /tbc-db must be run as a simple command/i);
  });
});
