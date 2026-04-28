import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildSandboxProfile, executeRead, executeWrite, executeEdit, executeTool } from '../src/agent-runner.js';
import { getAgentFilesystemPolicy } from '../src/orchestrator/agent-prompt.js';

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-policy-'));
  const repo = path.join(root, 'repo');
  const projectRoot = root;
  const own = path.join(projectRoot, 'agents', 'leo');
  const other = path.join(projectRoot, 'agents', 'nora');
  const knowledge = path.join(projectRoot, 'knowledge');
  const skills = path.join(projectRoot, 'skills', 'workers');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.mkdirSync(knowledge, { recursive: true });
  fs.mkdirSync(skills, { recursive: true });
  fs.writeFileSync(path.join(repo, 'repo.txt'), 'repo ok');
  fs.writeFileSync(path.join(own, 'note.txt'), 'own ok');
  fs.writeFileSync(path.join(other, 'secret.txt'), 'other secret');
  fs.writeFileSync(path.join(knowledge, 'spec.md'), 'shared knowledge');
  fs.writeFileSync(path.join(skills, 'nora.md'), 'role: worker');
  fs.writeFileSync(path.join(projectRoot, 'project.db'), 'sqlite');
  return {
    root,
    repo,
    projectRoot,
    own,
    other,
    knowledge,
    skills,
    allowedWorker: {
      read: [repo, knowledge, own],
      write: [repo, knowledge, own],
      denied: [
        path.join(projectRoot, 'agents'),
        path.join(projectRoot, 'responses'),
        path.join(projectRoot, 'uploads'),
        path.join(projectRoot, 'skills'),
        path.join(projectRoot, 'state.json'),
        path.join(projectRoot, 'orchestrator.log'),
        path.join(projectRoot, 'project.db'),
      ],
      dbPath: path.join(projectRoot, 'project.db'),
    },
    allowedFocused: {
      read: [repo, knowledge, own],
      write: [repo, knowledge, own],
      denied: [
        path.join(projectRoot, 'agents'),
        path.join(projectRoot, 'responses'),
        path.join(projectRoot, 'uploads'),
        path.join(projectRoot, 'skills'),
        path.join(projectRoot, 'state.json'),
        path.join(projectRoot, 'orchestrator.log'),
        path.join(projectRoot, 'project.db'),
      ],
      dbPath: path.join(projectRoot, 'project.db'),
    },
    allowedBlind: {
      read: [repo],
      write: [repo],
      denied: [
        path.join(projectRoot, 'agents'),
        path.join(projectRoot, 'responses'),
        path.join(projectRoot, 'uploads'),
        path.join(projectRoot, 'skills'),
        path.join(projectRoot, 'state.json'),
        path.join(projectRoot, 'orchestrator.log'),
        path.join(projectRoot, 'project.db'),
      ],
      dbPath: path.join(projectRoot, 'project.db'),
    },
    allowedManager: {
      read: [repo, knowledge, own, skills],
      write: [repo, knowledge, own, skills],
      denied: [
        path.join(projectRoot, 'agents'),
        path.join(projectRoot, 'responses'),
        path.join(projectRoot, 'uploads'),
        path.join(projectRoot, 'skills'),
        path.join(projectRoot, 'state.json'),
        path.join(projectRoot, 'orchestrator.log'),
        path.join(projectRoot, 'project.db'),
      ],
      dbPath: path.join(projectRoot, 'project.db'),
    },
  };
}

describe('agent filesystem allowlist', () => {
  it('blocks overriding TBC_DB in bash commands', async () => {
    const p = mkProject();
    const blocked = await executeTool('Bash', { command: 'export TBC_DB=/tmp/other.db && tbc-db issue-list' }, p.repo, 0, { TBC_DB: p.allowedWorker.dbPath }, null, null, p.allowedWorker, null);
    assert.match(blocked, /overriding TBC_DB is not allowed/i);
  });

  it('allows reading repo and own agent notes but blocks other agents', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.repo, 'repo.txt') }, p.repo, p.allowedWorker), /repo ok/);
    assert.match(executeRead({ file_path: path.join(p.own, 'note.txt') }, p.repo, p.allowedWorker), /own ok/);
    assert.match(executeRead({ file_path: path.join(p.other, 'secret.txt') }, p.repo, p.allowedWorker), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.other, 'secret.txt'))}` }, p.repo, 0, {}, null, null, p.allowedWorker);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });


  it('allows full and focused agents to write shared knowledge but blocks blind agents', () => {
    const p = mkProject();
    const workerWrite = executeWrite({ file_path: path.join(p.knowledge, 'analysis.md'), content: 'durable finding' }, p.repo, p.allowedWorker);
    assert.match(workerWrite, /Successfully wrote/i);

    const focusedEdit = executeEdit({ file_path: path.join(p.knowledge, 'spec.md'), old_string: 'shared', new_string: 'updated shared' }, p.repo, p.allowedFocused);
    assert.match(focusedEdit, /Successfully edited/i);

    const blindRead = executeRead({ file_path: path.join(p.knowledge, 'spec.md') }, p.repo, p.allowedBlind);
    const blindWrite = executeWrite({ file_path: path.join(p.knowledge, 'blind.md'), content: 'nope' }, p.repo, p.allowedBlind);
    assert.match(blindRead, /access denied/i);
    assert.match(blindWrite, /access denied/i);
  });

  it('blocks path traversal into another agent notes directory', async () => {
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

  it('blind mode cannot read its own agent notes', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.own, 'note.txt') }, p.repo, p.allowedBlind), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.own, 'note.txt'))}` }, p.repo, 0, {}, null, null, p.allowedBlind);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });

  it('blocks managers from reading worker private notes', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.other, 'secret.txt') }, p.repo, p.allowedManager), /access denied/i);

    const bashResult = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.other, 'secret.txt'))}` }, p.repo, 0, {}, null, null, p.allowedManager);
    assert.match(bashResult, /Operation not permitted|Blocked|access denied|Exit code: 1/i);
  });

  it('blocks raw project.db access from file tools and bash', async () => {
    const p = mkProject();
    assert.match(executeRead({ file_path: path.join(p.projectRoot, 'project.db') }, p.repo, p.allowedWorker), /project database access is not allowed/i);

    const bashByPath = await executeTool('Bash', { command: `cat ${JSON.stringify(path.join(p.projectRoot, 'project.db'))}` }, p.repo, 0, { TBC_DB: path.join(p.projectRoot, 'project.db') }, null, null, p.allowedWorker);
    assert.match(bashByPath, /project database access is not allowed/i);

    const envCommand = 'cat "$' + 'TBC_DB"'
    const bashByEnv = await executeTool('Bash', { command: envCommand }, p.repo, 0, { TBC_DB: path.join(p.projectRoot, 'project.db') }, null, null, p.allowedWorker);
    assert.match(bashByEnv, /project database access is not allowed/i);
  });

  it('allows glob/grep inside own agent notes and repo', async () => {
    const p = mkProject();
    const globOwn = await executeTool('Glob', { pattern: '*.txt', path: p.own }, p.repo, 0, null, null, null, p.allowedWorker);
    const grepOwn = await executeTool('Grep', { pattern: 'own', path: p.own }, p.repo, 0, null, null, null, p.allowedWorker);
    const globRepo = await executeTool('Glob', { pattern: '*.txt', path: p.repo }, p.repo, 0, null, null, null, p.allowedWorker);

    assert.match(globOwn, /note\.txt/);
    assert.match(grepOwn, /note\.txt:1: own ok/);
    assert.match(globRepo, /repo\.txt/);
  });

  it('blocks glob/grep over denied agent roots', () => {
    const p = mkProject();
    const globDenied = executeTool('Glob', { pattern: '*.txt', path: path.join(p.projectRoot, 'agents') }, p.repo, 0, null, null, null, p.allowedWorker);
    const grepDenied = executeTool('Grep', { pattern: 'secret', path: path.join(p.projectRoot, 'agents') }, p.repo, 0, null, null, null, p.allowedWorker);
    return Promise.all([globDenied, grepDenied]).then(([g1, g2]) => {
      assert.match(g1, /access denied/i);
      assert.match(g2, /access denied/i);
    });
  });

  it('uses a deny-default macOS sandbox profile with explicit file allows', () => {
    const p = mkProject();
    const profile = buildSandboxProfile(p.allowedWorker);
    assert.match(profile, /\(deny default\)/);
    assert.doesNotMatch(profile, /\(allow default\)/);
    const repoReal = fs.realpathSync(p.repo);
    const knowledgeReal = fs.realpathSync(p.knowledge);
    assert.ok(profile.includes(`(allow file-read* (subpath "${repoReal}"`));
    assert.ok(profile.includes(`(allow file-write* (subpath "${knowledgeReal}"`));
  });

  it('blocks dynamic outside-project paths in Bash when sandbox-exec is available', async (t) => {
    if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) {
      t.skip('macOS sandbox-exec is required for dynamic Bash path enforcement');
      return;
    }
    const p = mkProject();
    const outside = path.join(os.homedir(), `.tbc-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, 'outside secret');

    const envRead = await executeTool('Bash', { command: 'cat "$OUTSIDE" && echo READ_OK' }, p.repo, 0, { OUTSIDE: outside }, null, null, p.allowedWorker);
    assert.doesNotMatch(envRead, /outside secret/);
    assert.doesNotMatch(envRead, /READ_OK/);

    try {
      const pythonRead = await executeTool('Bash', { command: `python3 - <<'PY'
import os
try:
    print(open(os.environ["OUTSIDE"]).read())
    print("READ_OK")
except Exception as e:
    print(type(e).__name__)
PY`, timeout: 30000 }, p.repo, 0, { OUTSIDE: outside }, null, null, p.allowedWorker);
      assert.doesNotMatch(pythonRead, /outside secret/);
      assert.doesNotMatch(pythonRead, /READ_OK/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('builds the intended policy matrix for normal agents, managers, and doctor', () => {
    const p = mkProject();
    const runner = {
      path: p.repo,
      projectDir: p.projectRoot,
      knowledgeDir: p.knowledge,
      agentsDir: path.join(p.projectRoot, 'agents'),
      skillsDir: path.join(p.projectRoot, 'skills'),
      workerSkillsDir: p.skills,
      responsesDir: path.join(p.projectRoot, 'responses'),
      uploadsDir: path.join(p.projectRoot, 'uploads'),
      statePath: path.join(p.projectRoot, 'state.json'),
      orchestratorLogPath: path.join(p.projectRoot, 'orchestrator.log'),
      projectDbPath: path.join(p.projectRoot, 'project.db'),
    };

    const workerFull = getAgentFilesystemPolicy(runner, { name: 'leo', isManager: false }, { mode: 'full' });
    assert.ok(workerFull.read.includes(p.knowledge));
    assert.ok(workerFull.write.includes(p.knowledge));
    assert.ok(workerFull.write.includes(path.join(p.projectRoot, 'agents', 'leo')));
    assert.ok(!workerFull.write.includes(p.skills));

    const workerBlind = getAgentFilesystemPolicy(runner, { name: 'leo', isManager: false }, { mode: 'blind' });
    assert.deepEqual(workerBlind.read, [p.repo]);
    assert.deepEqual(workerBlind.write, [p.repo]);

    const managerFull = getAgentFilesystemPolicy(runner, { name: 'athena', isManager: true }, { mode: 'full' });
    assert.ok(managerFull.write.includes(p.knowledge));
    assert.ok(managerFull.write.includes(path.join(p.projectRoot, 'agents', 'athena')));
    assert.ok(managerFull.write.includes(p.skills));

    const doctor = getAgentFilesystemPolicy(runner, { name: 'doctor', isManager: true }, { mode: 'full' });
    assert.deepEqual(doctor.read, [p.projectRoot]);
    assert.deepEqual(doctor.write, [p.projectRoot]);
  });

});
