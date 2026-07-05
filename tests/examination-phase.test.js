import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseExamVerdict } from '../src/orchestrator/phase-machine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'orchestrator', 'ProjectRunner.js');
const phaseMachinePath = path.join(__dirname, '..', 'src', 'orchestrator', 'phase-machine.js');
const schedulerPath = path.join(__dirname, '..', 'src', 'orchestrator', 'scheduler.js');

function readServer() {
  return fs.readFileSync(serverPath, 'utf-8');
}

function readOrchestratorSource() {
  return [serverPath, phaseMachinePath, schedulerPath]
    .map(file => fs.readFileSync(file, 'utf-8'))
    .join('\n');
}

describe('Themis examination phase', () => {
  it('tracks examination as a first-class phase in server state', () => {
    const src = readServer();
    assert.match(src, /athena \| implementation \| verification \| examination/,
      'Expected examination to be included in the phase state machine comment');
  });

  it('routes successful PROJECT_COMPLETE claims into examination instead of finalizing immediately', () => {
    const src = readOrchestratorSource();
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
    const src = readOrchestratorSource();
    assert.match(src, /else if \((?:this|runner)\.phase === 'examination'\)/,
      'Expected a dedicated examination phase block in runLoop');
    assert.match(src, /const themis = managers\.find\(m => m\.name === 'themis'\)/,
      'Expected examination phase to run Themis');
    assert.match(src, /runManagerWithDirectiveRetry\(runner, deps, themis, config, themisContext, \{ visibility: \{ mode: 'full', issues: \[\] \} \}\)/,
      'Expected Themis to run in full view');
    assert.doesNotMatch(src, /themis, config, null, themisContext, \{ mode: 'blind', issues: \[\] \}/,
      'Themis should no longer run blind');
  });

  it('lets Themis schedule its own independent team across multiple cycles', () => {
    const src = readOrchestratorSource();
    assert.match(src, /Resuming interrupted examination schedule/,
      'Expected examination schedules to resume after interruption');
    assert.match(src, /schedule = (?:this|runner)\.parseSchedule\(result\.resultText\)/,
      'Expected examination phase to parse Themis schedules');
    assert.match(src, /executeSchedule\(schedule, config, 'themis'\)/,
      'Expected examination workers to run under Themis ownership');
    assert.match(src, /executeSchedule\((?:this|runner)\.currentSchedule, config, 'themis'\)/,
      'Expected interrupted Themis schedules to resume under Themis ownership');
    assert.match(src, /let verdict = null/,
      'Expected examination to support non-terminal cycles');
    assert.match(src, /Investigation continues, stay in examination phase/,
      'Expected schedule-only examination cycles to remain in examination');
  });

  it('filters scheduled workers by manager ownership', () => {
    const src = readOrchestratorSource();
    assert.match(src, /const ownerName = typeof managerName === 'string' \? managerName\.toLowerCase\(\) : null/,
      'Expected executeSchedule to accept a manager owner');
    assert.match(src, /return \(worker\.reportsTo \|\| ''\)\.toLowerCase\(\) === ownerName/,
      'Expected executeSchedule to limit workers to the current manager team');
  });

  it('rejects issue-board assignments to blind workers', () => {
    const src = readOrchestratorSource();
    assert.match(src, /function nonFullVisibilityIssueReference\(task\)/,
      'Expected manager directive validation to detect issue\/PR references');
    assert.match(src, /visibility === 'blind'/,
      'Expected blind scheduled tasks to be checked');
    assert.match(src, /SCHEDULE assigns issue\/PR references to blind worker/,
      'Expected schedules assigning issues to blind workers to be rejected and retried');
    assert.match(src, /use visibility:\"focused\"\/\"full\" for issue\/PR-board work/,
      'Expected correction prompt to tell managers to use focused\/full visibility for issue\/PR-board work');
  });

  it('finalizes completion on any verdict — audit without veto', () => {
    const src = readOrchestratorSource();
    const examBlock = src.match(/else if \((?:this|runner)\.phase === 'examination'\) \{([\s\S]*?)\n      \}\n\n      \/\/ If no agent succeeded/);
    assert.ok(examBlock, 'Could not find examination phase block');
    const block = examBlock[1];

    assert.match(block, /parseExamVerdict/,
      'Expected examination to parse a verdict (EXAM_PASS or EXAM_FINDINGS)');
    assert.match(block, /isComplete:\s*true/,
      'Expected a verdict to finalize the project');
    assert.match(block, /completionSuccess:\s*true/,
      'Expected findings verdicts to still complete the project successfully');
    assert.match(block, /writeFinalAuditReport/,
      'Expected the verdict to be written to a final audit report');
    assert.match(block, /examinationFeedback: null/,
      'Examination must clear feedback, never send it back to Athena');
    assert.doesNotMatch(block, /phase: 'athena',\s*\n\s*examinationFeedback: [^n]/,
      'The EXAM_FAIL → Athena feedback loop must be gone');
    assert.doesNotMatch(block, /createIssue/,
      'Examination must not create tracker issues');
  });

  it('retries once and completes inconclusively rather than looping to Athena', () => {
    const src = readOrchestratorSource();
    assert.match(src, /Audit inconclusive — Themis returned no verdict after a retry\./,
      'Expected a terminal inconclusive fallback');
    assert.doesNotMatch(src, /Themis rejected project completion/,
      'The EXAM_FAIL rejection loop must be gone');
  });

  it('writes the audit report outside the repo, in the project data dir', () => {
    const src = readOrchestratorSource();
    assert.match(src, /path\.join\(runner\.projectDir, 'reports'\)/,
      'Audit reports belong under {projectDir}/reports');
    assert.match(src, /final-audit-/,
      'Audit report filenames should be recognizable');
  });
});

describe('parseExamVerdict', () => {
  it('recognizes EXAM_PASS as a clean verdict', () => {
    assert.deepEqual(parseExamVerdict('done <!-- EXAM_PASS -->{"message":"ok"}<!-- /EXAM_PASS -->'),
      { verdict: 'clean', summary: null, findings: [] });
  });

  it('parses EXAM_FINDINGS with severity', () => {
    const verdict = parseExamVerdict('<!-- EXAM_FINDINGS -->{"summary":"partial","findings":[{"title":"Gap","detail":"evidence","severity":"high"}]}<!-- /EXAM_FINDINGS -->');
    assert.equal(verdict.verdict, 'findings');
    assert.equal(verdict.summary, 'partial');
    assert.deepEqual(verdict.findings, [{ title: 'Gap', detail: 'evidence', severity: 'high' }]);
  });

  it('maps legacy EXAM_FAIL blocks to findings instead of rejection', () => {
    const verdict = parseExamVerdict('<!-- EXAM_FAIL -->{"summary":"nope","feedback":"fix it","issues":[{"title":"Blocker","body":"details"}]}<!-- /EXAM_FAIL -->');
    assert.equal(verdict.verdict, 'findings');
    assert.equal(verdict.summary, 'nope');
    assert.deepEqual(verdict.findings, [{ title: 'Blocker', detail: 'details', severity: null }]);
  });

  it('degrades unparseable verdict JSON into a findings verdict', () => {
    const verdict = parseExamVerdict('<!-- EXAM_FINDINGS -->not json<!-- /EXAM_FINDINGS -->');
    assert.equal(verdict.verdict, 'findings');
    assert.equal(verdict.findings.length, 1);
  });

  it('returns null when no verdict tag is present', () => {
    assert.equal(parseExamVerdict('<!-- SCHEDULE -->[{"delay":5}]<!-- /SCHEDULE -->'), null);
  });
});
