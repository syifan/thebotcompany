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

function readThemis() {
  return fs.readFileSync(themisPath, 'utf-8');
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

  it('adds a dedicated examination phase that runs themis in full view', () => {
    const src = readServer();
    assert.match(src, /else if \(this\.phase === 'examination'\)/,
      'Expected a dedicated examination phase block in runLoop');
    assert.match(src, /const themis = managers\.find\(m => m\.name === 'themis'\)/,
      'Expected examination phase to run Themis');
    assert.match(src, /runAgent\(themis, config, null, themisContext, \{ mode: 'full', issues: \[\] \}\)/,
      'Expected Themis to run in full view');
    assert.doesNotMatch(src, /runAgent\(themis, config, null, themisContext, \{ mode: 'blind', issues: \[\] \}\)/,
      'Themis should no longer run blind');
  });

  it('lets Themis schedule its own independent team across multiple cycles', () => {
    const src = readServer();
    assert.match(src, /Resuming interrupted examination schedule/,
      'Expected examination schedules to resume after interruption');
    assert.match(src, /schedule = this\.parseSchedule\(result\.resultText\)/,
      'Expected examination phase to parse Themis schedules');
    assert.match(src, /executeSchedule\(schedule, config, 'themis'\)/,
      'Expected examination workers to run under Themis ownership');
    assert.match(src, /executeSchedule\(this\.currentSchedule, config, 'themis'\)/,
      'Expected interrupted Themis schedules to resume under Themis ownership');
    assert.match(src, /let decision = null/,
      'Expected examination to support non-terminal cycles');
    assert.match(src, /No decision yet, stay in examination phase/,
      'Expected schedule-only examination cycles to remain in examination');
  });

  it('filters scheduled workers by manager ownership', () => {
    const src = readServer();
    assert.match(src, /const ownerName = typeof managerName === 'string' \? managerName\.toLowerCase\(\) : null/,
      'Expected executeSchedule to accept a manager owner');
    assert.match(src, /return \(worker\.reportsTo \|\| ''\)\.toLowerCase\(\) === ownerName/,
      'Expected executeSchedule to limit workers to the current manager team');
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
    assert.match(block, /phase:\s*'athena'/,
      'Expected EXAM_PASS to exit examination phase cleanly');
  });

  it('does not overwrite EXAM_PASS with failure just because no schedule exists', () => {
    const src = readServer();
    assert.doesNotMatch(
      src,
      /if \(result\.resultText\.includes\('\<\!-- EXAM_PASS --\>'\)\) \{\s*decision = 'pass';\s*\}[\s\S]*?else if \(!schedule\) \{\s*decision = 'fail';\s*\}/,
      'EXAM_PASS must remain terminal success even when Themis returns no schedule'
    );
  });

  it('returns to athena and creates issues on EXAM_FAIL', () => {
    const src = readServer();
    const examBlock = src.match(/else if \(this\.phase === 'examination'\) \{([\s\S]*?)\n      \}/);
    assert.ok(examBlock, 'Could not find examination phase block');
    const block = examBlock[1];

    assert.match(block, /decision === 'fail'/,
      'Expected explicit EXAM_FAIL handling');
    assert.match(block, /phase:\s*'athena'/,
      'Expected failed examination result to return control to Athena');
    assert.match(block, /issue-create|createIssue|INSERT INTO issues/i,
      'Expected failed examination result to create issues');
  });

  it('still falls back to raw feedback when EXAM_FAIL JSON is absent or incomplete', () => {
    const src = readServer();
    const examBlock = src.match(/else if \(this\.phase === 'examination'\) \{([\s\S]*?)\n      \}/);
    assert.ok(examBlock, 'Could not find examination phase block');
    const block = examBlock[1];

    assert.match(block, /rawFeedback/,
      'Expected examination failure path to fall back to raw Themis output when structured feedback is absent');
  });

  it('updates Themis prompt for full-view team-based examination', () => {
    const themis = readThemis();
    assert.match(themis, /run in full view, not blind/i,
      'Expected Themis prompt to make full visibility explicit');
    assert.match(themis, /may hire workers, retune workers, and schedule workers/i,
      'Expected Themis prompt to allow team management');
    assert.match(themis, /Only workers with `reports_to: themis` are on your team\./,
      'Expected Themis prompt to define an independent team');
    assert.match(themis, /may take multiple cycles to finish the examination/i,
      'Expected Themis prompt to allow multi-cycle examination');
    assert.match(themis, /<!-- SCHEDULE -->/,
      'Expected Themis prompt to document schedule output');
  });

  it('gives Athena context when Themis rejects project completion', () => {
    const src = readServer();
    const athenaSituation = src.match(/let situation = '';/);
    assert.ok(athenaSituation, 'Could not find Athena situation builder');
    assert.match(src, /examinationFeedback/,
      'Expected server state to track examination feedback for Athena');
  });
});
