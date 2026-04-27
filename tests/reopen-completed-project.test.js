import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stateControlPath = path.join(__dirname, '..', 'src', 'orchestrator', 'state-control.js');

function readStateControl() {
  return fs.readFileSync(stateControlPath, 'utf-8');
}

describe('reopening completed project resets planning state', () => {
  it('resume() should clear stale milestone state when reopening a completed project', () => {
    const branch = readStateControl();
    assert.match(branch, /if \(runner\.isComplete\)/, 'Could not find completed-project reopen branch in state-control.js');

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
