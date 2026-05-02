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
  it('requires an explicit actor for issue edits', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--actor', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-edit', '1', '--title', 'Updated title'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--actor/i);

    res = run(['issue-edit', '1', '--actor', 'ares', '--title', 'Updated title'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Updated issue #1/);
  });

  it('rejects removed creator/editor/closer aliases', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--creator', 'ares', '--body', 'body'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Unknown option '--creator'|--actor/i);

    res = run(['issue-create', '--title', 'Agent issue', '--actor', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-edit', '1', '--editor', 'ares', '--title', 'Updated title'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Unknown option '--editor'|--actor/i);

    res = run(['issue-close', '1', '--closer', 'ares'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Unknown option '--closer'|--actor/i);
  });

  it('allows the same agent who opened the issue to close it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--actor', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--actor', 'ares'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Closed issue #1/);
  });

  it('allows athena to close an agent-opened issue', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Worker issue', '--actor', 'leo', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--actor', 'athena'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Closed issue #1/);
  });

  it('blocks a different agent from closing another agent issue', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Agent issue', '--actor', 'leo', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--actor', 'maya'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can only be closed by leo or athena/i);
  });

  it('manager issues can be closed by athena but not other managers', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Manager issue', '--actor', 'ares', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--actor', 'apollo'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can only be closed by ares or athena/i);

    res = run(['issue-close', '1', '--actor', 'athena'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Closed issue #1/);
  });

  it('chat and human issues can only be closed by chat or human', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-close-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Human issue', '--actor', 'human', '--body', 'body'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['issue-close', '1', '--actor', 'ares'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can only be closed by chat or human/i);

    res = run(['issue-close', '1', '--actor', 'chat'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Closed issue #1/);
  });
});
