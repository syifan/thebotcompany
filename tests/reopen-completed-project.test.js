import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'orchestrator', 'ProjectRunner.js');

function readServer() {
  return fs.readFileSync(serverPath, 'utf-8');
}

describe('reopening completed project resets planning state', () => {
  it('resume() should clear stale milestone state when reopening a completed project', () => {
    const src = readServer();
    const resumeMatch = src.match(/resume\(\) \{([\s\S]*?)\n  \}/);
    assert.ok(resumeMatch, 'Could not find resume() in ProjectRunner.js');
    const body = resumeMatch[1];
    const reopenBranch = body.match(/if \(this\.isComplete\) \{([\s\S]*?)\n    \} else \{/);
    assert.ok(reopenBranch, 'Could not find completed-project reopen branch in resume()');
    const branch = reopenBranch[1];

    assert.match(branch, /milestoneTitle:\s*null/,
      'Reopening a completed project should clear stale milestoneTitle');
    assert.match(branch, /milestoneDescription:\s*null/,
      'Reopening a completed project should clear stale milestoneDescription');
    assert.match(branch, /milestoneCyclesBudget:\s*0/,
      'Reopening a completed project should clear stale milestoneCyclesBudget');
    assert.match(branch, /milestoneCyclesUsed:\s*0/,
      'Reopening a completed project should clear stale milestoneCyclesUsed');
    assert.match(branch, /verificationFeedback:\s*null/,
      'Reopening a completed project should clear verificationFeedback');
    assert.match(branch, /examinationFeedback:\s*null/,
      'Reopening a completed project should clear examinationFeedback');
    assert.match(branch, /pendingCompletionMessage:\s*null/,
      'Reopening a completed project should clear pendingCompletionMessage');
  });
});
