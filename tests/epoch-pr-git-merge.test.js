import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mergeEpochPrBranch } from '../src/orchestrator/epoch-pr-merge.js';

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${output}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '', output };
}

function writeFile(repo, rel, content) {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function commit(repo, message) {
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).stdout.trim();
}

function createRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-pr-merge-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, ['init', '--bare', origin]);
  git(tmp, ['clone', origin, repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  git(repo, ['checkout', '-b', 'main']);
  writeFile(repo, 'README.md', 'base\n');
  const baseSha = commit(repo, 'base');
  git(repo, ['push', '-u', 'origin', 'main']);
  return { tmp, origin, repo, baseSha };
}

describe('TBC PR git integration merge', () => {
  it('fast-forwards the target branch, pushes it, and returns merge evidence', () => {
    const { repo } = createRepo();
    git(repo, ['checkout', '-b', 'feature']);
    writeFile(repo, 'feature.txt', 'feature\n');
    const headSha = commit(repo, 'feature');
    git(repo, ['push', '-u', 'origin', 'feature']);
    git(repo, ['checkout', 'main']);

    const result = mergeEpochPrBranch(
      { path: repo },
      { id: 7, base_branch: 'main', head_branch: 'feature' },
    );

    assert.equal(result.baseBranch, 'main');
    assert.equal(result.headBranch, 'feature');
    assert.equal(result.headSha, headSha);
    assert.equal(git(repo, ['rev-parse', 'origin/main']).stdout.trim(), headSha);
    assert.equal(git(repo, ['merge-base', '--is-ancestor', headSha, 'origin/main']).status, 0);
  });

  it('refuses non-fast-forward PRs and tells the agent to rebase first', () => {
    const { repo, baseSha } = createRepo();
    git(repo, ['checkout', '-b', 'feature']);
    writeFile(repo, 'feature.txt', 'feature\n');
    const featureSha = commit(repo, 'feature');
    git(repo, ['push', '-u', 'origin', 'feature']);

    git(repo, ['checkout', 'main']);
    writeFile(repo, 'main.txt', 'main moved\n');
    const mainSha = commit(repo, 'move main');
    git(repo, ['push', 'origin', 'main']);

    assert.throws(
      () => mergeEpochPrBranch({ path: repo }, { id: 8, base_branch: 'main', head_branch: 'feature' }),
      /Rebase feature onto origin\/main first/,
    );
    assert.equal(git(repo, ['rev-parse', 'origin/main']).stdout.trim(), mainSha);
    assert.equal(git(repo, ['rev-parse', 'origin/feature']).stdout.trim(), featureSha);
    assert.notEqual(mainSha, baseSha);
  });
});
