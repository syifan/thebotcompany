import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';

const cliPath = path.resolve('bin/tbc-db.js');

function makeDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-prs-'));
  return path.join(dir, 'project.db');
}

function run(args, dbPath) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve('.'),
    env: { ...process.env, TBC_DB: dbPath },
    encoding: 'utf8',
  });
}

describe('TBC local epoch PR model', () => {
  it('stores epoch-specific metadata on TBC PRs', () => {
    const dbPath = makeDbPath();
    const created = run([
      'pr-create',
      '--title', 'Epoch 7 PR',
      '--head', 'ares/epoch-7',
      '--actor', 'ares',
      '--milestone', 'M1.2',
      '--parent', '5',
      '--epoch', 'E7',
      '--branch', 'e7-m1-2-epoch-7-branch',
    ], dbPath);
    assert.equal(created.status, 0, created.stderr || created.stdout);

    const db = new Database(dbPath, { readonly: true });
    const pr = db.prepare('SELECT milestone_id, parent_pr_id, epoch_index, branch_name, actor, status FROM tbc_prs WHERE id = 1').get();
    db.close();

    assert.deepEqual(pr, {
      milestone_id: 'M1.2',
      parent_pr_id: 5,
      epoch_index: 'E7',
      branch_name: 'e7-m1-2-epoch-7-branch',
      actor: 'ares',
      status: 'open',
    });
  });

  it('shared agent rules still direct agents to use TBC PRs instead of GitHub PRs', () => {
    const everyone = fs.readFileSync(path.resolve('agent/everyone.md'), 'utf8');
    assert.match(everyone, /Use TBC PRs, not GitHub PRs/i);
  });
});
