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
      focused: { mode: 'focused', issues: ['12', '34'] },
      blind: { mode: 'blind', issues: [] },
    },
  };
}

describe('issue visibility policy', () => {
  it('blind blocks issue reads but allows issue creation', async () => {
    const p = mkProject();

    const listResult = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(listResult, /access denied|blind mode|issue tracker/i);

    const viewResult = await executeTool('Bash', { command: 'tbc-db issue-view 12' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(viewResult, /access denied|blind mode|issue tracker/i);

    const createResult = await executeTool('Bash', { command: 'tbc-db issue-create --title "Need help" --creator leo --body "blocked"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.doesNotMatch(createResult, /access denied|blind mode|issue tracker/i);
  });

  it('focused allows only explicitly allowed issues', async () => {
    const p = mkProject();

    const allowedView = await executeTool('Bash', { command: 'tbc-db issue-view 12' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(allowedView, /access denied|focused issues/i);

    const allowedComments = await executeTool('Bash', { command: 'tbc-db comments 34' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(allowedComments, /access denied|focused issues/i);

    const deniedView = await executeTool('Bash', { command: 'tbc-db issue-view 99' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedView, /access denied|focused issues/i);

    const deniedList = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedList, /access denied|focused issues/i);
  });

  it('focused allows writes only on allowed issues, plus create', async () => {
    const p = mkProject();

    const allowedComment = await executeTool('Bash', { command: 'tbc-db comment --issue 12 --author leo --body "working"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(allowedComment, /access denied|focused issues/i);

    const deniedComment = await executeTool('Bash', { command: 'tbc-db comment --issue 77 --author leo --body "working"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedComment, /access denied|focused issues/i);

    const createResult = await executeTool('Bash', { command: 'tbc-db issue-create --title "New blocker" --creator leo --body "blocked"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(createResult, /access denied|focused issues/i);
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

  it('blocks raw SQL query for non-full visibility', async () => {
    const p = mkProject();

    const focusedQuery = await executeTool('Bash', { command: 'tbc-db query "SELECT * FROM issues"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(focusedQuery, /access denied|query|focused issues/i);

    const blindQuery = await executeTool('Bash', { command: 'tbc-db query "SELECT * FROM issues"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(blindQuery, /access denied|query|blind mode/i);
  });
});
