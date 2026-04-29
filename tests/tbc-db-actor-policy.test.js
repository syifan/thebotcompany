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
  it('allows all managers to create epoch PRs and blocks non-managers', () => {
    const dbPath = makeDbPath();

    const denied = run(['pr-create', '--title', 'Bad PR', '--head', 'worker/m1', '--actor', 'leo'], dbPath);
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stderr}${denied.stdout}`, /Only manager agents/i);

    for (const manager of ['athena', 'ares', 'apollo', 'themis']) {
      const allowed = run(['pr-create', '--title', `${manager} PR`, '--head', `${manager}/m1`, '--actor', manager], dbPath);
      assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
      assert.match(allowed.stdout, /Created TBC PR #/);
    }
  });

  it('allows managers to close epoch PRs and blocks non-managers', () => {
    const dbPath = makeDbPath();
    const created = run(['pr-create', '--title', 'Epoch PR', '--head', 'ares/m2', '--actor', 'ares'], dbPath);
    assert.equal(created.status, 0, created.stderr || created.stdout);

    const denied = run(['pr-edit', '1', '--actor', 'leo', '--status', 'closed'], dbPath);
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stderr}${denied.stdout}`, /Only manager agents/i);

    const allowed = run(['pr-close', '1', '--actor', 'athena', '--reason', 'not needed'], dbPath);
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
    assert.match(allowed.stdout, /Closed TBC PR #1/);
  });
});
