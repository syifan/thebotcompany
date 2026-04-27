import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'orchestrator', 'ProjectRunner.js');
const schedulerPath = path.join(__dirname, '..', 'src', 'orchestrator', 'scheduler.js');
const stateControlPath = path.join(__dirname, '..', 'src', 'orchestrator', 'state-control.js');

function readServer() {
  return fs.readFileSync(serverPath, 'utf-8');
}

function readStateControl() {
  return fs.readFileSync(stateControlPath, 'utf-8');
}

function readScheduler() {
  return fs.readFileSync(schedulerPath, 'utf-8');
}

describe('killEpoch interrupts in-flight worker retries', () => {
  it('killEpoch should set an explicit cycle-abort flag', () => {
    const src = readStateControl();
    const killEpochMatch = src.match(/killRunnerEpoch\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(killEpochMatch, 'Could not find killRunnerEpoch() in state-control.js');
    const body = killEpochMatch[1];

    assert.ok(
      /abortCurrentCycle|epochKilled|cancelCurrentSchedule|stopCurrentCycle/.test(body),
      'killEpoch() should set an explicit flag to stop in-flight retries/schedule execution'
    );
  });

  it('worker retry loop should check the cycle-abort flag before retrying', () => {
    const src = readScheduler();
    const retryMatch = src.match(/while \(attempt <= maxRetries && !succeeded && runner\.running([^)]*)\) \{([\s\S]*?)\n      \}/);
    assert.ok(retryMatch, 'Could not find worker retry loop in executeSchedule()');
    const loopConditionSuffix = retryMatch[1] || '';
    const loopBody = retryMatch[2];

    assert.ok(
      /abortCurrentCycle|epochKilled|cancelCurrentSchedule|stopCurrentCycle/.test(loopConditionSuffix + loopBody),
      'worker retry loop should stop when killEpoch has aborted the current cycle'
    );
  });

  it('executeSchedule should stop dispatching additional steps after killEpoch', () => {
    const src = readScheduler();
    const executeScheduleMatch = src.match(/export async function executeSchedule\(runner, deps = \{\}, schedule, config, managerName = null\)/);
    assert.ok(executeScheduleMatch, 'Could not find executeSchedule() in scheduler.js');
    const body = src;

    assert.ok(
      /abortCurrentCycle|epochKilled|cancelCurrentSchedule|stopCurrentCycle/.test(body),
      'executeSchedule() should check a killEpoch abort flag and exit early'
    );
  });

  it('killEpoch should clear the abort flag on the next clean cycle start', () => {
    const src = readServer();
    assert.ok(
      /abortCurrentCycle\s*=\s*false|epochKilled\s*=\s*false|cancelCurrentSchedule\s*=\s*false|stopCurrentCycle\s*=\s*false/.test(src),
      'ProjectRunner.js should reset the killEpoch abort flag before the next clean cycle begins'
    );
  });
});
