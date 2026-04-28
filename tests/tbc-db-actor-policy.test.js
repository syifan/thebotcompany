import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cliPath = path.resolve('bin/tbc-db.js');

function makeDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-db-actor-'));
  return path.join(dir, 'project.db');
}

function run(args, dbPath) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve('.'),
    env: { ...process.env, TBC_DB: dbPath },
    encoding: 'utf8',
  });
}

describe('tbc-db epoch PR actor policy', () => {
  it('allows only ares to create epoch PRs', () => {
    const dbPath = makeDbPath();

    const denied = run(['pr-create', '--title', 'Bad PR', '--head', 'ares/m1', '--actor', 'athena'], dbPath);
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stderr}${denied.stdout}`, /Only ares may create epoch PRs/i);

    const allowed = run(['pr-create', '--title', 'Good PR', '--head', 'ares/m1', '--actor', 'ares'], dbPath);
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
    assert.match(allowed.stdout, /Created TBC PR #1/);
  });

  it('allows only apollo to merge or close an epoch PR', () => {
    const dbPath = makeDbPath();
    const created = run(['pr-create', '--title', 'Epoch PR', '--head', 'ares/m2', '--actor', 'ares'], dbPath);
    assert.equal(created.status, 0, created.stderr || created.stdout);

    const denied = run(['pr-edit', '1', '--actor', 'ares', '--status', 'merged'], dbPath);
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stderr}${denied.stdout}`, /Only apollo may mark an epoch PR as merged/i);

    const allowed = run(['pr-edit', '1', '--actor', 'apollo', '--status', 'closed', '--decision', 'close'], dbPath);
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  });
});
