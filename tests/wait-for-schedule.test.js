import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeWaitForSpec,
  parseSchedule,
  WAIT_FOR_DEFAULT_POLL_MIN,
  WAIT_FOR_DEFAULT_TIMEOUT_MIN,
  WAIT_FOR_MAX_TIMEOUT_MIN,
  WAIT_FOR_MIN_POLL_MIN,
} from '../src/orchestrator/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phaseMachinePath = path.join(__dirname, '..', 'src', 'orchestrator', 'phase-machine.js');
const schedulerPath = path.join(__dirname, '..', 'src', 'orchestrator', 'scheduler.js');

function parse(text) {
  return parseSchedule({}, { log: () => {} }, text);
}

describe('waitFor schedule steps', () => {
  it('normalizes a minimal waitFor spec with defaults', () => {
    const spec = normalizeWaitForSpec({ run: 26278530869 });
    assert.deepEqual(spec, {
      run: '26278530869',
      timeoutMin: WAIT_FOR_DEFAULT_TIMEOUT_MIN,
      pollMin: WAIT_FOR_DEFAULT_POLL_MIN,
    });
  });

  it('caps timeout and floors poll interval', () => {
    const spec = normalizeWaitForSpec({ run: '123', timeoutMin: 99999, pollMin: 0.1 });
    assert.equal(spec.timeoutMin, WAIT_FOR_MAX_TIMEOUT_MIN);
    assert.equal(spec.pollMin, WAIT_FOR_MIN_POLL_MIN);
  });

  it('rejects specs without a valid run id or with unknown keys', () => {
    assert.equal(normalizeWaitForSpec({}), null);
    assert.equal(normalizeWaitForSpec({ run: 'abc' }), null);
    assert.equal(normalizeWaitForSpec({ run: -5 }), null);
    assert.equal(normalizeWaitForSpec({ run: 123, branch: 'main' }), null);
    assert.equal(normalizeWaitForSpec(null), null);
    assert.equal(normalizeWaitForSpec([1]), null);
  });

  it('accepts waitFor steps in the schedule parser', () => {
    const text = `<!-- SCHEDULE -->\n[\n  {"waitFor": {"run": 26278530869, "timeoutMin": 720}},\n  {"agent":"leo","task":"Inspect the terminal run result"}\n]\n<!-- /SCHEDULE -->`;
    const schedule = parse(text);
    assert.ok(schedule, 'waitFor schedule should parse');
    assert.deepEqual(schedule._steps[0], {
      waitFor: { run: '26278530869', timeoutMin: 720, pollMin: WAIT_FOR_DEFAULT_POLL_MIN },
    });
    assert.deepEqual(schedule._steps[1], { leo: { task: 'Inspect the terminal run result' } });
  });

  it('rejects malformed waitFor steps in the schedule parser', () => {
    const missingRun = `<!-- SCHEDULE -->\n[\n  {"waitFor": {"timeoutMin": 60}}\n]\n<!-- /SCHEDULE -->`;
    assert.equal(parse(missingRun), null);
    const extraKeys = `<!-- SCHEDULE -->\n[\n  {"waitFor": {"run": 1}, "delay": 5}\n]\n<!-- /SCHEDULE -->`;
    assert.equal(parse(extraKeys), null);
  });

  it('still accepts plain delay-only schedules', () => {
    const waitOnly = `<!-- SCHEDULE -->\n[\n  {"delay":360}\n]\n<!-- /SCHEDULE -->`;
    assert.deepEqual(parse(waitOnly), { _steps: [{ delay: 360 }] });
  });

  it('executes waitFor steps without treating them as workers', () => {
    const src = fs.readFileSync(schedulerPath, 'utf-8');
    assert.match(src, /if \(step\.waitFor !== undefined\) \{\s*\n\s*await waitForCondition\(runner, deps, step\.waitFor\);/,
      'executeSchedule should route waitFor steps through waitForCondition');
    assert.match(src, /const name = Object\.keys\(step\)\.find\(k => k !== 'delay' && k !== 'waitFor'\)/,
      'agent-step detection should skip waitFor keys');
  });

  it('polls gh without spawning agents and records the outcome', () => {
    const src = fs.readFileSync(schedulerPath, 'utf-8');
    assert.match(src, /execFile\('gh', \['run', 'view', runId, '--json', 'status,conclusion'\]/,
      'waitFor should poll via the gh CLI');
    assert.match(src, /runner\.lastWaitResult = result/,
      'waitFor outcome should be recorded on the runner');
    const start = src.indexOf('export async function waitForCondition');
    const end = src.indexOf('export async function executeSchedule');
    assert.ok(start !== -1 && end > start, 'Expected waitForCondition before executeSchedule');
    assert.doesNotMatch(src.slice(start, end), /runAgent/,
      'waitForCondition must never run agents');
  });

  it('skips waitFor steps in manager directive validation', () => {
    const src = fs.readFileSync(phaseMachinePath, 'utf-8');
    assert.match(src, /if \(!step \|\| step\.delay !== undefined \|\| step\.waitFor !== undefined\) continue;/,
      'validateManagerDirective should not treat waitFor as a worker name');
  });

  it('injects the last waitFor outcome into the next manager context', () => {
    const src = fs.readFileSync(phaseMachinePath, 'utf-8');
    assert.match(src, /function consumeWaitResultContext\(runner\)/,
      'Expected a consumeWaitResultContext helper');
    assert.match(src, /consumeWaitResultContext\(runner\) \+ situation/,
      'Athena situation should include the waitFor outcome');
    assert.match(src, /let aresContext = consumeWaitResultContext\(runner\);/,
      'Ares context should include the waitFor outcome');
    assert.match(src, /const apolloContext = consumeWaitResultContext\(runner\)/,
      'Apollo context should include the waitFor outcome');
    assert.match(src, /const themisContext = consumeWaitResultContext\(runner\)/,
      'Themis context should include the waitFor outcome');
  });
});
