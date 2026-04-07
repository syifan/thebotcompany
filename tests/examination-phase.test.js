import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const themisPath = path.join(__dirname, '..', 'agent', 'managers', 'themis.md');

function readServer() {
  return fs.readFileSync(serverPath, 'utf-8');
}

describe('Themis examination phase', () => {
  it('adds themis manager prompt file', () => {
    assert.ok(fs.existsSync(themisPath), 'Expected agent/managers/themis.md to exist');
  });

  it('tracks examination as a first-class phase in server state', () => {
    const src = readServer();
    assert.match(src, /athena \| implementation \| verification \| examination/,
      'Expected examination to be included in the phase state machine comment');
  });

  it('routes successful PROJECT_COMPLETE claims into examination instead of finalizing immediately', () => {
    const src = readServer();
    const match = src.match(/if \(completeMatch\) \{([\s\S]*?)continue;/);
    assert.ok(match, 'Could not find PROJECT_COMPLETE handling block');
    const block = match[1];
    const successBranch = block.match(/if \(success\) \{([\s\S]*?)\n\s*\} else \{/);
    assert.ok(successBranch, 'Could not find successful PROJECT_COMPLETE branch');
    const successBlock = successBranch[1];

    assert.match(successBlock, /phase:\s*'examination'/,
      'Successful PROJECT_COMPLETE should route into examination phase');
    assert.doesNotMatch(successBlock, /isComplete:\s*true/,
      'Successful PROJECT_COMPLETE should not finalize the project immediately');
  });

  it('adds a dedicated examination phase that runs themis', () => {
    const src = readServer();
    assert.match(src, /else if \(this\.phase === 'examination'\)/,
      'Expected a dedicated examination phase block in runLoop');
    assert.match(src, /const themis = managers\.find\(m => m\.name === 'themis'\)/,
      'Expected examination phase to run Themis');
  });

  it('finalizes completion only on EXAM_PASS', () => {
    const src = readServer();
    const examBlock = src.match(/else if \(this\.phase === 'examination'\) \{([\s\S]*?)\n      \}/);
    assert.ok(examBlock, 'Could not find examination phase block');
    const block = examBlock[1];

    assert.match(block, /EXAM_PASS/,
      'Expected EXAM_PASS handling');
    assert.match(block, /isComplete:\s*true/,
      'Expected EXAM_PASS to finalize the project');
  });

  it('returns to athena and creates issues when Themis does not emit EXAM_PASS', () => {
    const src = readServer();
    const examBlock = src.match(/else if \(this\.phase === 'examination'\) \{([\s\S]*?)\n      \}/);
    assert.ok(examBlock, 'Could not find examination phase block');
    const block = examBlock[1];

    assert.match(block, /let decision = 'fail'/,
      'Expected examination phase to default to failure');
    assert.match(block, /phase:\s*'athena'/,
      'Expected non-pass examination result to return control to Athena');
    assert.match(block, /issue-create|createIssue|INSERT INTO issues/i,
      'Expected non-pass examination result to create issues');
  });

  it('treats EXAM_FAIL as optional, not required', () => {
    const src = readServer();
    const examBlock = src.match(/else if \(this\.phase === 'examination'\) \{([\s\S]*?)\n      \}/);
    assert.ok(examBlock, 'Could not find examination phase block');
    const block = examBlock[1];

    assert.match(block, /rawFeedback/,
      'Expected examination failure path to fall back to raw Themis output when EXAM_FAIL is absent');
  });

  it('gives Athena context when Themis rejects project completion', () => {
    const src = readServer();
    const athenaSituation = src.match(/let situation = '';/);
    assert.ok(athenaSituation, 'Could not find Athena situation builder');
    assert.match(src, /examinationFeedback/,
      'Expected server state to track examination feedback for Athena');
  });
});
