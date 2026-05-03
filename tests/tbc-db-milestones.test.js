import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cliPath = path.resolve('bin/tbc-db.js');

function makeDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-db-milestones-'));
  return path.join(dir, 'project.db');
}

function run(args, dbPath) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve('.'),
    env: { ...process.env, TBC_DB: dbPath },
    encoding: 'utf8',
  });
}

describe('tbc-db milestone CRUD', () => {
  it('creates, lists, views, edits, and deletes roadmap milestones', () => {
    const dbPath = makeDbPath();

    const createRoot = run(['milestone-create', '--actor', 'athena', '--id', 'M1', '--title', 'Foundation', '--description', 'Build foundation'], dbPath);
    assert.equal(createRoot.status, 0, createRoot.stderr || createRoot.stdout);
    assert.match(createRoot.stdout, /Created milestone M1/);

    const createChild = run(['milestone-create', '--actor', 'athena', '--title', 'Login UI', '--description', 'Build login UI', '--parent', 'M1', '--cycles', '8'], dbPath);
    assert.equal(createChild.status, 0, createChild.stderr || createChild.stdout);
    assert.match(createChild.stdout, /Created milestone M1\.1/);

    const list = run(['milestone-list'], dbPath);
    assert.equal(list.status, 0, list.stderr || list.stdout);
    assert.match(list.stdout, /M1 \[active\/planned\] Foundation/);
    assert.match(list.stdout, /M1\.1 \[active\/planned\] Login UI parent=M1 cycles=8/);

    const view = run(['milestone-view', 'M1'], dbPath);
    assert.equal(view.status, 0, view.stderr || view.stdout);
    assert.match(view.stdout, /# Milestone M1: Foundation/);
    assert.match(view.stdout, /Children \(1\)/);

    const edit = run(['milestone-edit', 'M1.1', '--actor', 'athena', '--title', 'Login screen', '--status', 'completed'], dbPath);
    assert.equal(edit.status, 0, edit.stderr || edit.stdout);
    assert.match(edit.stdout, /Updated milestone M1\.1/);

    const child = run(['milestone-view', 'M1.1'], dbPath);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout, /# Milestone M1\.1: Login screen/);
    assert.match(child.stdout, /Status: completed/);

    const blockedDelete = run(['milestone-delete', 'M1', '--actor', 'athena'], dbPath);
    assert.notEqual(blockedDelete.status, 0);
    assert.match(`${blockedDelete.stderr}${blockedDelete.stdout}`, /has child milestones/);

    const deleteTree = run(['milestone-delete', 'M1', '--actor', 'athena', '--recursive'], dbPath);
    assert.equal(deleteTree.status, 0, deleteTree.stderr || deleteTree.stdout);
    assert.match(deleteTree.stdout, /Deleted 2 milestone\(s\)/);
  });

  it('allows everyone to read milestones but only Athena to mutate them', () => {
    const dbPath = makeDbPath();
    const created = run(['milestone-create', '--actor', 'athena', '--id', 'M1', '--title', 'Foundation'], dbPath);
    assert.equal(created.status, 0, created.stderr || created.stdout);

    const list = run(['milestone-list'], dbPath);
    assert.equal(list.status, 0, list.stderr || list.stdout);
    assert.match(list.stdout, /M1/);

    const nonAthenaCreate = run(['milestone-create', '--actor', 'ares', '--title', 'Bad'], dbPath);
    assert.notEqual(nonAthenaCreate.status, 0);
    assert.match(`${nonAthenaCreate.stderr}${nonAthenaCreate.stdout}`, /Only Athena may mutate milestones/);

    const missingActorEdit = run(['milestone-edit', 'M1', '--title', 'Bad'], dbPath);
    assert.notEqual(missingActorEdit.status, 0);
    assert.match(`${missingActorEdit.stderr}${missingActorEdit.stdout}`, /Only Athena may mutate milestones/);

    const nonAthenaDelete = run(['milestone-delete', 'M1', '--actor', 'apollo'], dbPath);
    assert.notEqual(nonAthenaDelete.status, 0);
    assert.match(`${nonAthenaDelete.stderr}${nonAthenaDelete.stdout}`, /Only Athena may mutate milestones/);
  });
});
