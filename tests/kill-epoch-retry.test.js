import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'server.js');

function readServer() {
  return fs.readFileSync(serverPath, 'utf-8');
}

describe('killEpoch interrupts in-flight worker retries', () => {
  it('killEpoch should set an explicit cycle-abort flag', () => {
    const src = readServer();
    const killEpochMatch = src.match(/killEpoch\(\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(killEpochMatch, 'Could not find killEpoch() in server.js');
    const body = killEpochMatch[1];

    assert.ok(
      /abortCurrentCycle|epochKilled|cancelCurrentSchedule|stopCurrentCycle/.test(body),
      'killEpoch() should set an explicit flag to stop in-flight retries/schedule execution'
    );
  });

  it('worker retry loop should check the cycle-abort flag before retrying', () => {
    const src = readServer();
    const retryMatch = src.match(/while \(attempt <= maxRetries && !succeeded && this\.running([^)]*)\) \{([\s\S]*?)\n      \}/);
    assert.ok(retryMatch, 'Could not find worker retry loop in executeSchedule()');
    const loopConditionSuffix = retryMatch[1] || '';
    const loopBody = retryMatch[2];

    assert.ok(
      /abortCurrentCycle|epochKilled|cancelCurrentSchedule|stopCurrentCycle/.test(loopConditionSuffix + loopBody),
      'worker retry loop should stop when killEpoch has aborted the current cycle'
    );
  });

  it('executeSchedule should stop dispatching additional steps after killEpoch', () => {
    const src = readServer();
    const executeScheduleMatch = src.match(/async executeSchedule\(schedule, config\) \{([\s\S]*?)\n  \}\n\n  async runLoop/);
    assert.ok(executeScheduleMatch, 'Could not find executeSchedule() in server.js');
    const body = executeScheduleMatch[1];

    assert.ok(
      /abortCurrentCycle|epochKilled|cancelCurrentSchedule|stopCurrentCycle/.test(body),
      'executeSchedule() should check a killEpoch abort flag and exit early'
    );
  });

  it('killEpoch should clear the abort flag on the next clean cycle start', () => {
    const src = readServer();
    assert.ok(
      /abortCurrentCycle\s*=\s*false|epochKilled\s*=\s*false|cancelCurrentSchedule\s*=\s*false|stopCurrentCycle\s*=\s*false/.test(src),
      'server.js should reset the killEpoch abort flag before the next clean cycle begins'
    );
  });
});
