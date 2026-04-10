import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/agent-runner.js';
import path from 'node:path';

function mkProject() {
  const repo = path.resolve('/tmp/project/repo');
  const workspace = path.resolve('/tmp/project/workspace/workers/leo');
  return {
    repo,
    workspace,
    allowedPaths: [repo, workspace],
    issuePolicy: { mode: 'full', issues: [], actor: 'leo' },
  };
}

describe('tbc-db actor anti-spoofing', () => {
  it('blocks mutating issue actions when actor is omitted or spoofed', async () => {
    const p = mkProject();

    const missingActor = await executeTool('Bash', { command: 'tbc-db issue-create --title "Bug"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicy);
    assert.match(missingActor, /requires --actor leo/i);

    const spoofedComment = await executeTool('Bash', { command: 'tbc-db comment --issue 12 --actor ares --body "hi"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicy);
    assert.match(spoofedComment, /cannot act as ares/i);

    const allowedComment = await executeTool('Bash', { command: 'tbc-db comment --issue 12 --actor leo --body "hi"' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicy);
    assert.doesNotMatch(allowedComment, /cannot act as|requires --actor|issue tracker/i);
  });

  it('blocks pr mutations when actor is omitted or spoofed', async () => {
    const p = mkProject();

    const missingActor = await executeTool('Bash', { command: 'tbc-db pr-create --title "PR" --head feat/x' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicy);
    assert.match(missingActor, /requires --actor leo/i);

    const spoofedEdit = await executeTool('Bash', { command: 'tbc-db pr-edit 1 --actor ares --status open' }, p.repo, 0, { TBC_DB: '/tmp/project.db' }, null, null, p.allowedPaths, p.issuePolicy);
    assert.match(spoofedEdit, /cannot act as ares/i);
  });
});
