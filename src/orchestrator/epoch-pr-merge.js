import { spawnSync } from 'child_process';
import { createGithubAuthEnv } from '../github-token.js';

function runGit(repoDir, args, { allowFailure = false, env = process.env } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (!allowFailure && result.status !== 0) {
    const command = `git ${args.join(' ')}`;
    throw new Error(`${command} failed${output ? `: ${output}` : ''}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '', output };
}

function assertSafeBranchName(name, label) {
  const value = String(name || '').trim();
  if (!value) throw new Error(`Cannot merge TBC PR: missing ${label} branch.`);
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.startsWith('-') || value.includes('..') || value.includes('//')) {
    throw new Error(`Cannot merge TBC PR: unsafe ${label} branch name ${JSON.stringify(value)}.`);
  }
  return value;
}

export function mergeEpochPrBranch(runner, pr, { actor = 'apollo' } = {}) {
  if (!runner?.path) throw new Error('Cannot merge TBC PR: runner repo path is not set.');
  if (!pr) throw new Error('Cannot merge TBC PR: PR record is missing.');

  const repoDir = runner.path;
  const prId = pr.id ? ` #${pr.id}` : '';
  const baseBranch = assertSafeBranchName(pr.base_branch || 'main', 'base');
  const headBranch = assertSafeBranchName(pr.head_branch || pr.branch_name, 'head');

  const gitAuth = createGithubAuthEnv(process.env);
  if (!gitAuth.hasToken) {
    throw new Error('Cannot merge TBC PR: GitHub personal access token is not configured. Add a fine-grained token in Settings > Credentials.');
  }

  try {
    const dirty = runGit(repoDir, ['status', '--porcelain'], { allowFailure: false, env: gitAuth.env }).stdout.trim();
    if (dirty) {
      throw new Error(`Cannot merge TBC PR${prId}: repository has uncommitted changes. Commit or clean them before merging.`);
    }

    const fetchBase = runGit(repoDir, ['fetch', 'origin', `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`], { allowFailure: true, env: gitAuth.env });
    if (fetchBase.status !== 0) {
      throw new Error(`Cannot merge TBC PR${prId}: failed to fetch origin/${baseBranch}: ${fetchBase.output}`);
    }

    const fetchHead = runGit(repoDir, ['fetch', 'origin', `+refs/heads/${headBranch}:refs/remotes/origin/${headBranch}`], { allowFailure: true, env: gitAuth.env });
    if (fetchHead.status !== 0) {
      throw new Error(`Cannot merge TBC PR${prId}: head branch ${headBranch} is not available on origin. Push the branch first, then retry. ${fetchHead.output}`.trim());
    }

    const baseRef = `origin/${baseBranch}`;
    const headRef = `origin/${headBranch}`;
    const baseSha = runGit(repoDir, ['rev-parse', baseRef], { env: gitAuth.env }).stdout.trim();
    const headSha = runGit(repoDir, ['rev-parse', headRef], { env: gitAuth.env }).stdout.trim();

    const ffCheck = runGit(repoDir, ['merge-base', '--is-ancestor', baseRef, headRef], { allowFailure: true, env: gitAuth.env });
    if (ffCheck.status !== 0) {
      throw new Error(`Cannot merge TBC PR${prId}: ${headBranch} is not a fast-forward from ${baseBranch}. Rebase ${headBranch} onto origin/${baseBranch} first, push it, then retry.`);
    }

    try {
      runGit(repoDir, ['checkout', baseBranch], { env: gitAuth.env });
      runGit(repoDir, ['reset', '--hard', baseRef], { env: gitAuth.env });
      runGit(repoDir, ['merge', '--ff-only', headRef], { env: gitAuth.env });
      runGit(repoDir, ['push', 'origin', `${baseBranch}:${baseBranch}`], { env: gitAuth.env });
      runGit(repoDir, ['fetch', 'origin', `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`], { env: gitAuth.env });
      const verify = runGit(repoDir, ['merge-base', '--is-ancestor', headSha, baseRef], { allowFailure: true, env: gitAuth.env });
      if (verify.status !== 0) {
        throw new Error(`origin/${baseBranch} does not contain ${headSha} after push.`);
      }
    } catch (err) {
      throw new Error(`Cannot merge TBC PR${prId}: git integration failed. ${err.message}`);
    }

    return {
      actor,
      baseBranch,
      headBranch,
      baseShaBefore: baseSha,
      headSha,
    };
  } finally {
    gitAuth.cleanup();
  }
}
