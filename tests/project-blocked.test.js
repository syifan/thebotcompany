import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseProjectBlockedDirective, renderBlockedDigest } from '../src/orchestrator/phase-machine.js';
import { resumeRunner } from '../src/orchestrator/state-control.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phaseMachinePath = path.join(__dirname, '..', 'src', 'orchestrator', 'phase-machine.js');
const athenaPromptPath = path.join(__dirname, '..', 'agent', 'managers', 'athena.md');
const managerPromptPath = path.join(__dirname, '..', 'agent', 'manager.md');

function wrap(payload) {
  return `Some reasoning...\n<!-- PROJECT_BLOCKED -->\n${payload}\n<!-- /PROJECT_BLOCKED -->`;
}

describe('PROJECT_BLOCKED directive', () => {
  it('parses a valid blocked directive with defaults', () => {
    const parsed = parseProjectBlockedDirective(wrap(JSON.stringify({
      summary: 'Awaiting acceptance decisions',
      decisions: [
        { question: 'Accept 28% error?', recommendation: 'accept', context: 'CU model limit' },
        { id: 7, question: 'Close issue #12?', recommendation: 'close' },
      ],
    })));
    assert.ok(parsed?.blocked, 'should parse');
    assert.equal(parsed.blocked.decisions.length, 2);
    assert.equal(parsed.blocked.decisions[0].id, 1, 'missing ids are assigned by position');
    assert.equal(parsed.blocked.decisions[1].id, 7, 'explicit ids are kept');
    assert.equal(parsed.blocked.decisions[1].context, null);
  });

  it('rejects directives without decisions or with incomplete decisions', () => {
    assert.match(parseProjectBlockedDirective(wrap('{"summary":"x"}')).error, /non-empty "decisions"/);
    assert.match(parseProjectBlockedDirective(wrap('{"decisions":[{"question":"only q"}]}')).error, /"question" and "recommendation"/);
    assert.match(parseProjectBlockedDirective(wrap('not json')).error, /not valid JSON/);
    assert.equal(parseProjectBlockedDirective('no directive here'), null);
  });

  it('renders a one-line-per-decision digest with reply instructions', () => {
    const digest = renderBlockedDigest({
      summary: 'Awaiting acceptance decisions',
      decisions: [
        { id: 1, question: 'Accept 28% error?', recommendation: 'accept', context: 'CU model limit' },
        { id: 2, question: 'Close issue #12?', recommendation: 'close', context: null },
      ],
    });
    assert.match(digest, /Blocked on 2 human decision\(s\)/);
    assert.match(digest, /1\. Accept 28% error\? \(recommend: accept\) — CU model limit/);
    assert.match(digest, /2\. Close issue #12\? \(recommend: close\)/);
    assert.match(digest, /rejecting an item requires a reason/);
  });

  it('parks the project and broadcasts when Athena emits PROJECT_BLOCKED', () => {
    const src = fs.readFileSync(phaseMachinePath, 'utf-8');
    const block = src.match(/const blockedParse = parseProjectBlockedDirective\(result\.resultText\);([\s\S]*?)continue;/);
    assert.ok(block, 'Expected PROJECT_BLOCKED handling in the athena phase');
    assert.match(block[1], /isBlocked: true/);
    assert.match(block[1], /isPaused: true/);
    assert.match(block[1], /pauseReason: digest/);
    assert.match(block[1], /type: 'project-blocked'/);
  });

  it('injects the decision digest into Athena after resume and clears it', () => {
    const src = fs.readFileSync(phaseMachinePath, 'utf-8');
    assert.match(src, /if \(runner\.pendingUnblockDigest\) \{/,
      'Athena situation should have an unblock branch');
    assert.match(src, /Resumed after human-decision block/);
    assert.match(src, /runner\.setState\(\{ pendingUnblockDigest: null \}\)/,
      'digest is consumed once');
  });

  it('resume converts a blocked project into a pending unblock digest', () => {
    const calls = [];
    const runner = {
      isComplete: false,
      isBlocked: true,
      pauseReason: 'old digest',
      blockedDecisions: {
        summary: 'Need decisions',
        decisions: [{ id: 1, question: 'Q?', recommendation: 'accept', context: null }],
      },
      setState(patch) { calls.push(patch); Object.assign(this, patch); },
    };
    resumeRunner(runner, { log: () => {} });
    assert.equal(runner.isBlocked, false);
    assert.equal(runner.blockedDecisions, null);
    assert.equal(runner.isPaused, false);
    assert.equal(runner.phase, 'athena');
    assert.match(runner.pendingUnblockDigest, /1\. Q\? \(recommend: accept\)/);
    assert.equal(runner.wakeNow, true);
    assert.equal(runner.consecutiveReplans, 0,
      'human intervention resets the replan counter');
    assert.ok(runner.healthSnoozeUntilCycle > 0,
      'health tripwires are snoozed after an unblock so hygeia cannot immediately re-park');
  });

  it('documents the directive for Athena and reframes HUMAN: issues as non-blocking', () => {
    const athena = fs.readFileSync(athenaPromptPath, 'utf-8');
    assert.match(athena, /<!-- PROJECT_BLOCKED -->/);
    assert.match(athena, /recommendation/);
    assert.match(athena, /`<!-- PROJECT_BLOCKED -->` \| Forward progress is gated on human decisions/);
    const manager = fs.readFileSync(managerPromptPath, 'utf-8');
    assert.match(manager, /breadcrumb, not a notification/);
    assert.match(manager, /PROJECT_BLOCKED/);
    assert.doesNotMatch(manager, /- human input, reviewer decisions/,
      'pending human input must not be listed as a delay-wait reason');
  });
});
