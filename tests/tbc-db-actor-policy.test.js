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

describe('tbc-db actor requirements', () => {
  it('requires actor for issue create and comment', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-actor-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['issue-create', '--title', 'Missing actor'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--actor|--creator/i);

    res = run(['issue-create', '--title', 'With actor', '--actor', 'ares'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['comment', '--issue', '1', '--body', 'hello'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--actor|--author/i);

    res = run(['comment', '--issue', '1', '--actor', 'ares', '--body', 'hello'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
  });

  it('requires actor for pr create and pr edit', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tbc-db-actor-'));
    const dbPath = path.join(dir, 'project.db');

    let res = run(['pr-create', '--title', 'PR title', '--head', 'feat/x'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--actor/i);

    res = run(['pr-create', '--title', 'PR title', '--head', 'feat/x', '--actor', 'ares'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    res = run(['pr-edit', '1', '--status', 'open'], dbPath);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--actor/i);

    res = run(['pr-edit', '1', '--actor', 'ares', '--status', 'open'], dbPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
  });
});
