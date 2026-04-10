import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(process.cwd());
const CLI = path.join(ROOT, 'bin', 'tbc-db.js');

function run(args, dbPath) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      TBC_DB: dbPath,
      TBC_VISIBILITY: 'full',
    },
    encoding: 'utf8',
  });
}

describe('tbc-db issue action initiator policy', () => {
  it('requires an explicit editor for issue edits', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--creator', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-edit', '1', '--title', 'Updated title'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--actor|--editor/i);

    res = run(['issue-edit', '1', '--actor', 'ares', '--title', 'Updated title'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Updated issue #1/);
  });

  it('allows the same agent who opened the issue to close it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--creator', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--closer', 'ares'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Closed issue #1/);
  });

  it('blocks a different agent from closing another agent issue', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--creator', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--closer', 'leo'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can only be closed by that same agent/i);
  });

  it('blocks agents from closing human issues but allows human', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Human issue', '--creator', 'human', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--closer', 'ares'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can only be closed by human/i);

    res = run(['issue-close', '1', '--closer', 'human'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Closed issue #1/);
  });
});
