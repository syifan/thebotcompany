import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeTool } from '../src/agent-runner.js';

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-issue-policy-'));
  const repo = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  const own = path.join(workspaceRoot, 'workspace', 'leo');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'repo ok');
  fs.writeFileSync(path.join(workspaceRoot, 'project.db'), 'sqlite');

  const allowedPaths = {
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
  };

  return {
    repo,
    allowedPaths,
    issuePolicies: {
      full: { mode: 'full', issues: [] },
      focused: { mode: 'focused', issues: [] },
      blind: { mode: 'blind', issues: [] },
    },
  };
}

describe('issue visibility policy', () => {
  it('blind blocks all issue tracker access', async () => {
    const p = mkProject();

    const listResult = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(listResult, /access denied|blind mode|issue tracker/i);

    const viewResult = await executeTool('Bash', { command: 'tbc-db issue-view 12' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(viewResult, /access denied|blind mode|issue tracker/i);

    const createResult = await executeTool('Bash', { command: 'tbc-db issue-create --title "Need help" --creator leo --body "blocked"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(createResult, /access denied|blind mode|issue tracker/i);
  });

  it('focused blocks issue reads and comments listing', async () => {
    const p = mkProject();

    const deniedView = await executeTool('Bash', { command: 'tbc-db issue-view 12' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedView, /access denied|focused mode|issue tracker/i);

    const deniedComments = await executeTool('Bash', { command: 'tbc-db comments 34' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedComments, /access denied|focused mode|issue tracker/i);

    const deniedList = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedList, /access denied|focused mode|issue tracker/i);
  });

  it('focused allows issue creation and commenting', async () => {
    const p = mkProject();

    const commentResult = await executeTool('Bash', { command: 'tbc-db comment --issue 12 --author leo --body "working"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(commentResult, /access denied|focused mode|issue tracker/i);

    const createResult = await executeTool('Bash', { command: 'tbc-db issue-create --title "New blocker" --creator leo --body "blocked"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(createResult, /access denied|focused mode|issue tracker/i);
  });

  it('full allows issue reads and writes', async () => {
    const p = mkProject();

    const listResult = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.full);
    assert.doesNotMatch(listResult, /access denied|issue tracker/i);

    const viewResult = await executeTool('Bash', { command: 'tbc-db issue-view 99' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.full);
    assert.doesNotMatch(viewResult, /access denied|issue tracker/i);

    const commentResult = await executeTool('Bash', { command: 'tbc-db comment --issue 99 --author leo --body "working"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.full);
    assert.doesNotMatch(commentResult, /access denied|issue tracker/i);
  });

  it('allows TBC PR writes outside full visibility', async () => {
    const p = mkProject();

    const blindCreate = await executeTool('Bash', { command: 'tbc-db pr-create --title "Draft" --head leo/draft' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.doesNotMatch(blindCreate, /access denied|blind mode|issue tracker/i);

    const focusedEdit = await executeTool('Bash', { command: 'tbc-db pr-edit 1 --status merged' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(focusedEdit, /access denied|focused mode|issue tracker/i);
  });

  it('blocks raw SQL query for non-full visibility', async () => {
    const p = mkProject();

    const focusedQuery = await executeTool('Bash', { command: 'tbc-db query "SELECT * FROM issues"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(focusedQuery, /access denied|query|focused mode|issue tracker/i);

    const blindQuery = await executeTool('Bash', { command: 'tbc-db query "SELECT * FROM issues"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(blindQuery, /access denied|query|blind mode|issue tracker/i);
  });

  it('blocks gh pr create in favor of TBC PRs', async () => {
    const p = mkProject();
    const result = await executeTool('Bash', { command: 'gh pr create --title "x" --body "y"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, 'syifan/thebotcompany', p.allowedPaths, p.issuePolicies.full);
    assert.match(result, /gh pr create is not allowed|tbc-db pr-create/i);
  });
});
