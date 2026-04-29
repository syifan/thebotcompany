import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeTool } from '../src/agent-runner.js';

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-issue-policy-'));
  const repo = path.join(root, 'repo');
  const projectRoot = root;
  const own = path.join(projectRoot, 'agents', 'leo');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'repo ok');
  fs.writeFileSync(path.join(projectRoot, 'project.db'), 'sqlite');

  const allowedPaths = {
    read: [repo, own],
    write: [repo, own],
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
  it('blind blocks issue tracker reads but still allows issue/pr creation', async () => {
    const p = mkProject();

    const listResult = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(listResult, /access denied|blind mode|issue tracker|pr board/i);

    const viewResult = await executeTool('Bash', { command: 'tbc-db issue-view 12' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(viewResult, /access denied|blind mode|issue tracker|pr board/i);

    const createResult = await executeTool('Bash', { command: 'tbc-db issue-create --title "Need help" --creator leo --body "blocked"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.doesNotMatch(createResult, /access denied|blind mode|issue tracker|pr board/i);

    const prCreate = await executeTool('Bash', { command: 'tbc-db pr-create --title "Draft" --head leo/draft --actor leo' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.doesNotMatch(prCreate, /access denied|blind mode|issue tracker|pr board/i);
  });

  it('focused blocks issue and pr reads', async () => {
    const p = mkProject();

    const deniedView = await executeTool('Bash', { command: 'tbc-db issue-view 12' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedView, /access denied|focused mode|issue tracker|pr board/i);

    const deniedComments = await executeTool('Bash', { command: 'tbc-db comments 34' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedComments, /access denied|focused mode|issue tracker|pr board/i);

    const deniedList = await executeTool('Bash', { command: 'tbc-db issue-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedList, /access denied|focused mode|issue tracker|pr board/i);

    const deniedPrList = await executeTool('Bash', { command: 'tbc-db pr-list' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(deniedPrList, /access denied|focused mode|issue tracker|pr board/i);
  });

  it('focused allows issue and pr creation only', async () => {
    const p = mkProject();

    const createResult = await executeTool('Bash', { command: 'tbc-db issue-create --title "New blocker" --creator leo --body "blocked"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(createResult, /access denied|focused mode|issue tracker|pr board/i);

    const prCreate = await executeTool('Bash', { command: 'tbc-db pr-create --title "Draft" --head leo/draft --actor leo' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.doesNotMatch(prCreate, /access denied|focused mode|issue tracker|pr board/i);

    const commentResult = await executeTool('Bash', { command: 'tbc-db comment --issue 12 --author leo --body "working"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(commentResult, /access denied|focused mode|issue tracker|pr board/i);
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
    assert.doesNotMatch(blindCreate, /access denied|blind mode|issue tracker|pr board/i);

    const focusedEdit = await executeTool('Bash', { command: 'tbc-db pr-edit 1 --status merged' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(focusedEdit, /access denied|focused mode|issue tracker|pr board/i);

    const blindView = await executeTool('Bash', { command: 'tbc-db pr-view 1' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(blindView, /access denied|blind mode|issue tracker|pr board/i);
  });

  it('blocks raw SQL query for non-full visibility', async () => {
    const p = mkProject();

    const focusedQuery = await executeTool('Bash', { command: 'tbc-db query "SELECT * FROM issues"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.focused);
    assert.match(focusedQuery, /access denied|query|focused mode|issue tracker/i);

    const blindQuery = await executeTool('Bash', { command: 'tbc-db query "SELECT * FROM issues"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicies.blind);
    assert.match(blindQuery, /access denied|query|blind mode|issue tracker/i);
  });

  it('does not policy-screen gh commands; GitHub token scopes govern them', async () => {
    const p = mkProject();
    const result = await executeTool('Bash', { command: 'printf before; gh pr create --help >/dev/null 2>&1 || true; printf after' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, 'syifan/thebotcompany', p.allowedPaths, p.issuePolicies.full);
    assert.match(result, /beforeafter/);
    assert.doesNotMatch(result, /gh pr create is not allowed|tbc-db pr-create/i);
  });
});
