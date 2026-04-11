import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeRead, executeWrite, executeEdit, executeTool } from '../src/agent-runner.js';

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-policy-'));
  const repo = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  const own = path.join(workspaceRoot, 'workspace', 'leo');
  const other = path.join(workspaceRoot, 'workspace', 'nora');
  const skills = path.join(workspaceRoot, 'skills', 'workers');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.mkdirSync(skills, { recursive: true });
  fs.writeFileSync(path.join(repo, 'repo.txt'), 'repo ok');
  fs.writeFileSync(path.join(own, 'note.txt'), 'own ok');
  fs.writeFileSync(path.join(other, 'secret.txt'), 'other secret');
  fs.writeFileSync(path.join(skills, 'nora.md'), 'role: worker');
  fs.writeFileSync(path.join(workspaceRoot, 'project.db'), 'sqlite');
  return {
    root,
    repo,
    workspaceRoot,
    own,
    other,
    skills,
    allowedWorker: {
      read: [repo, own],
      write: [repo, own],
      denied: [
        path.join(workspaceRoot, 'workspace'),
        path.join(workspaceRoot, 'responses'),
        path.join(workspaceRoot, 'uploads'),
        path.join(workspaceRoot, 'skills'),
        path.join(workspaceRoot, 'state.json'),
        path.join(workspaceRoot, 'orchestrator.log'),
        path.join(workspaceRoot, 'project.db'),
      ],
      dbPath: path.join(workspaceRoot, 'project.db'),
    },
    allowedBlind: {
      read: [repo],
      write: [repo],
      denied: [
        path.join(workspaceRoot, 'workspace'),
        path.join(workspaceRoot, 'responses'),
        path.join(workspaceRoot, 'uploads'),
        path.join(workspaceRoot, 'skills'),
        path.join(workspaceRoot, 'state.json'),
        path.join(workspaceRoot, 'orchestrator.log'),
        path.join(workspaceRoot, 'project.db'),
      ],
      dbPath: path.join(workspaceRoot, 'project.db'),
    },
    allowedManager: {
      read: [repo, own, skills],
      write: [repo, own, skills],
      denied: [
        path.join(workspaceRoot, 'workspace'),
        path.join(workspaceRoot, 'responses'),
        path.join(workspaceRoot, 'uploads'),
        path.join(workspaceRoot, 'skills'),
        path.join(workspaceRoot, 'state.json'),
        path.join(workspaceRoot, 'orchestrator.log'),
        path.join(workspaceRoot, 'project.db'),
      ],
      dbPath: path.join(workspaceRoot, 'project.db'),
    },
  };
}

describe('agent filesystem allowlist', () => {
  it('blocks overriding TBC_DB in bash commands', async () => {
    const p = mkProject();
    const blocked = await executeTool('Bash', { command: 'export TBC_DB=/tmp/other.db && tbc-db issue-list' }, p.repo, 0, { TBC_DB: p.allowedWorker.dbPath }, null, null, p.allowedWorker, null);
    assert.match(blocked, /overriding TBC_DB is not allowed/i);
  });

  it('allows reading repo and own workspace but blocks other workspaces', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.repo, 'repo.txt') }, p.repo, p.allowedWorker), /repo ok/);
    assert.match(executeRead({ file_path: path.join(p.own, 'note.txt') }, p.repo, p.allowedWorker), /own ok/);
    assert.match(executeRead({ file_path: path.join(p.other, 'secret.txt') }, p.repo, p.allowedWorker), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.other, 'secret.txt'))}` }, p.repo, 0, {}, null, null, p.allowedWorker);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });

  it('blocks path traversal into another agent workspace', async () => {
    const p = mkProject();
    const traversal = path.join(p.own, '..', 'nora', 'secret.txt');
    assert.match(executeRead({ file_path: traversal }, p.repo, p.allowedWorker), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(traversal)}` }, p.repo, 0, {}, null, null, p.allowedWorker);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });

  it('allows managers to modify skills/workers while workers cannot', () => {
    const p = mkProject();
    const workerAttempt = executeWrite({ file_path: path.join(p.skills, 'eva.md'), content: 'role: test' }, p.repo, p.allowedWorker);
    assert.match(workerAttempt, /access denied/i);

    const managerAttempt = executeWrite({ file_path: path.join(p.skills, 'eva.md'), content: 'role: test' }, p.repo, p.allowedManager);
    assert.match(managerAttempt, /Successfully wrote/i);

    const managerEdit = executeEdit({ file_path: path.join(p.skills, 'eva.md'), old_string: 'test', new_string: 'updated' }, p.repo, p.allowedManager);
    assert.match(managerEdit, /Successfully edited/i);
  });

  it('blind mode cannot read its own workspace notes', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.own, 'note.txt') }, p.repo, p.allowedBlind), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.own, 'note.txt'))}` }, p.repo, 0, {}, null, null, p.allowedBlind);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });

  it('blocks managers from reading worker private workspace', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.other, 'secret.txt') }, p.repo, p.allowedManager), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.other, 'secret.txt'))}` }, p.repo, 0, {}, null, null, p.allowedManager);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });

  it('blocks raw project.db access from file tools and bash', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.workspaceRoot, 'project.db') }, p.repo, p.allowedWorker), /project database access is not allowed/i);

    const bashByPath = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.workspaceRoot, 'project.db'))}` }, p.repo, 0, { TBC_DB: path.join(p.workspaceRoot, 'project.db') }, null, null, p.allowedWorker);
    assert.match(bashByPath, /project database access is not allowed/i);

    const envCommand = 'cat "$' + 'TBC_DB"'
    const bashByEnv = await executeTool('Bash', { command: envCommand }, p.repo, 0, { TBC_DB: path.join(p.workspaceRoot, 'project.db') }, null, null, p.allowedWorker);
    assert.match(bashByEnv, /project database access is not allowed/i);
  });

  it('allows glob/grep inside own workspace and repo', async () => {
    const p = mkProject();
    const globOwn = await executeTool('Glob', { pattern: '*.txt', path: p.own }, p.repo, 0, null, null, null, p.allowedWorker);
    const grepOwn = await executeTool('Grep', { pattern: 'own', path: p.own }, p.repo, 0, null, null, null, p.allowedWorker);
    const globRepo = await executeTool('Glob', { pattern: '*.txt', path: p.repo }, p.repo, 0, null, null, null, p.allowedWorker);

    assert.match(globOwn, /note\.txt/);
    assert.match(grepOwn, /note\.txt:1: own ok/);
    assert.match(globRepo, /repo\.txt/);
  });

  it('blocks glob/grep over denied workspace roots', () => {
    const p = mkProject();
    const globDenied = executeTool('Glob', { pattern: '*.txt', path: path.join(p.workspaceRoot, 'workspace') }, p.repo, 0, null, null, null, p.allowedWorker);
    const grepDenied = executeTool('Grep', { pattern: 'secret', path: path.join(p.workspaceRoot, 'workspace') }, p.repo, 0, null, null, null, p.allowedWorker);
    return Promise.all([globDenied, grepDenied]).then(([g1, g2]) => {
      assert.match(g1, /access denied/i);
      assert.match(g2, /access denied/i);
    });
  });
});
