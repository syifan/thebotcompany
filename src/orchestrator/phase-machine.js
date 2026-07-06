import fs from 'fs';
import path from 'path';
import { maybeRunHealthAudit } from './health.js';

function scheduleBlockPresent(text = '') {
  return /<!--\s*SCHEDULE\s*-->[\s\S]*?<!--\s*\/SCHEDULE\s*-->/.test(String(text || ''));
}

function availableWorkersForManager(runner, managerName) {
  const owner = String(managerName || '').toLowerCase();
  return runner.loadAgents().workers.filter(worker => String(worker.reportsTo || '').toLowerCase() === owner);
}

function nonFullVisibilityIssueReference(task) {
  const text = String(task || '');
  return /\b(?:issue|issues|pr|prs|pull request|pull requests)\s*#?\d+\b/i.test(text)
    || /#\d+\b/.test(text)
    || /\btbc-db\s+(?:issue-view|issue-list|comments|pr-view|pr-list|pr-comments|query)\b/i.test(text);
}

function validateManagerDirective(runner, deps, resultText, managerName) {
  const text = String(resultText || '');
  if (!scheduleBlockPresent(text)) return null;

  const schedule = runner.parseSchedule(text);
  if (!schedule) {
    return {
      message: 'Malformed SCHEDULE directive. Use the canonical JSON array format exactly: <!-- SCHEDULE --> [ {"agent":"name","task":"..."} ] <!-- /SCHEDULE -->. Valid steps: {"agent":"name","task":"..."}, {"delay": minutes}, {"waitFor": {"run": <github run id>}}, {"waitFor": {"job": "<tbc-job name>"}}.',
    };
  }

  const allowed = new Set(availableWorkersForManager(runner, managerName).map(worker => worker.name.toLowerCase()));
  const invalid = [];
  const issueScoped = [];
  for (const step of schedule._steps || []) {
    if (!step || step.delay !== undefined || step.waitFor !== undefined) continue;
    const name = Object.keys(step).find(key => key !== 'delay' && key !== 'waitFor');
    if (name && !allowed.has(name.toLowerCase())) invalid.push(name);
    const value = name ? step[name] : null;
    const visibility = typeof value === 'object' ? String(value.visibility || 'full').toLowerCase() : 'full';
    const task = typeof value === 'string' ? value : value?.task;
    if (visibility === 'blind' && nonFullVisibilityIssueReference(task)) {
      issueScoped.push(`${name || '(unknown)'}:${visibility}`);
    }
  }
  if (invalid.length) {
    const available = [...allowed].sort().join(', ') || '(none)';
    return {
      message: `SCHEDULE references unavailable worker(s): ${[...new Set(invalid)].join(', ')}. Available workers for ${managerName}: ${available}.`,
    };
  }
  if (issueScoped.length) {
    return {
      message: `SCHEDULE assigns issue/PR references to blind worker(s): ${[...new Set(issueScoped)].join(', ')}. Blind workers cannot receive issue/PR-board context; make their task self-contained by pasting neutral facts/evidence without #id references, or use visibility:"focused"/"full" for issue/PR-board work.`,
    };
  }
  return null;
}

async function runManagerWithDirectiveRetry(runner, deps, manager, config, task, { visibility = null, maxRetries = 1 } = {}) {
  let result = await runner.runAgent(manager, config, null, task, visibility);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (!result?.success || !result?.resultText) break;
    const problem = validateManagerDirective(runner, deps, result.resultText, manager.name);
    if (!problem) break;
    deps.log(`Rejecting ${manager.name} response: ${problem.message}`, runner.id);
    const correction = `> **Orchestrator rejected your previous response before acting on it.**
> Problem: ${problem.message}
> Generate a corrected response now. Keep any useful reasoning/evidence, but fix the directive block. Do not reuse unavailable worker names.

${task || ''}`;
    result = await runner.runAgent(manager, config, null, correction, visibility);
  }
  return result;
}

// One-line summary of the last waitFor outcome, injected into the next manager
// context so the manager learns the result without a discovery cycle. Consumed once.
function consumeWaitResultContext(runner) {
  const wait = runner.lastWaitResult;
  if (!wait) return '';
  runner.lastWaitResult = null;
  runner.saveState();
  const outcome = wait.timedOut
    ? `still ${wait.status || 'unknown'} when the ${wait.waitedMin}m wait timed out`
    : `${wait.status}${wait.conclusion ? `/${wait.conclusion}` : ''} after ${wait.waitedMin}m`;
  const target = wait.jobName
    ? `Job "${wait.jobName}" (check details with: tbc-job status ${wait.jobName})`
    : `GitHub Actions run ${wait.runId}`;
  return `> **Last waitFor result:** ${target} → ${outcome}.\n\n`;
}

// Themis renders an audit verdict, never a veto: EXAM_PASS (clean) or
// EXAM_FINDINGS (advisory findings for the human). Legacy EXAM_FAIL blocks are
// accepted and treated as findings.
export function parseExamVerdict(resultText) {
  const text = String(resultText || '');
  if (text.includes('<!-- EXAM_PASS -->')) {
    return { verdict: 'clean', summary: null, findings: [] };
  }
  const match = text.match(/<!-- EXAM_FINDINGS -->\s*([\s\S]*?)\s*<!-- \/EXAM_FINDINGS -->/)
    || text.match(/<!-- EXAM_FAIL -->\s*([\s\S]*?)\s*<!-- \/EXAM_FAIL -->/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return {
      verdict: 'findings',
      summary: 'Themis findings could not be parsed as JSON.',
      findings: [{ title: 'Unparsed audit output', detail: match[1].slice(0, 2000), severity: null }],
    };
  }
  const rawFindings = Array.isArray(data.findings) ? data.findings
    : Array.isArray(data.issues) ? data.issues
    : [];
  return {
    verdict: 'findings',
    summary: data.summary || data.feedback || null,
    findings: rawFindings
      .filter(finding => finding && (finding.title || finding.detail || finding.body))
      .map(finding => ({
        title: finding.title || 'Finding',
        detail: finding.detail || finding.body || '',
        severity: finding.severity || null,
      })),
  };
}

// The audit report lives in the project data dir (outside repo/) so it never
// pollutes the repository the agents are building.
export function writeFinalAuditReport(runner, deps, verdict, claim) {
  const reportsDir = path.join(runner.projectDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportsDir, `final-audit-${stamp}.md`);
  const lines = [
    '# Final Audit Report',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Completion claim: ${claim}`,
    `- Verdict: ${verdict.verdict === 'clean' ? 'clean' : `${verdict.findings.length} finding(s)`}${verdict.inconclusive ? ' (inconclusive — Themis returned no verdict)' : ''}`,
  ];
  if (verdict.summary) {
    lines.push('', '## Summary', '', verdict.summary);
  }
  if (verdict.findings.length) {
    lines.push('', '## Findings', '');
    verdict.findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}${finding.severity ? ` (${finding.severity})` : ''}`, '', finding.detail, '');
    });
  }
  fs.writeFileSync(reportPath, lines.join('\n').trimEnd() + '\n');
  deps.log(`📋 Final audit report written to ${reportPath}`, runner.id);
  return reportPath;
}

export function parseProjectBlockedDirective(resultText) {
  const match = String(resultText || '').match(/<!-- PROJECT_BLOCKED -->\s*([\s\S]*?)\s*<!-- \/PROJECT_BLOCKED -->/);
  if (!match) return null;
  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch (e) {
    return { error: `PROJECT_BLOCKED payload is not valid JSON: ${e.message}` };
  }
  const decisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
  if (!decisions.length) {
    return { error: 'PROJECT_BLOCKED must include a non-empty "decisions" array.' };
  }
  for (const decision of decisions) {
    if (!decision?.question || !decision?.recommendation) {
      return { error: 'Every PROJECT_BLOCKED decision needs both "question" and "recommendation" so the human can answer with a one-line yes/no.' };
    }
  }
  return {
    blocked: {
      summary: payload.summary || 'Blocked on human decisions',
      decisions: decisions.map((decision, index) => ({
        id: decision.id || index + 1,
        question: String(decision.question),
        recommendation: String(decision.recommendation),
        context: decision.context ? String(decision.context) : null,
      })),
    },
  };
}

export function renderBlockedDigest(blocked) {
  const lines = blocked.decisions.map(decision =>
    `${decision.id}. ${decision.question} (recommend: ${decision.recommendation})${decision.context ? ` — ${decision.context}` : ''}`);
  return `Blocked on ${blocked.decisions.length} human decision(s): ${blocked.summary}\n`
    + lines.join('\n')
    + `\nReply in the project chat (or on the linked issues): a bare "yes"/"accept" per item adopts the recommendation; rejecting an item requires a reason (e.g. "1 yes, 2 no: <why>"). Then press Resume.`;
}

async function validateAthenaMilestoneDirective(runner, resultText) {
  const match = String(resultText || '').match(/<!-- MILESTONE -->\s*([\s\S]*?)\s*<!-- \/MILESTONE -->/);
  if (!match) return null;
  const payload = match[1].trim();
  if (!payload || payload.startsWith('{')) return null;
  const milestoneId = payload.replace(/^['"]|['"]$/g, '').trim();
  const milestone = await runner.getMilestoneRecord(milestoneId);
  if (milestone) return null;
  return {
    message: `MILESTONE directive references ${milestoneId}, but no DB milestone record with that id exists. Athena owns milestone planning: create or edit the milestone with tbc-db milestone-* --actor athena first, then output only its id.`,
  };
}

export async function runRunnerLoop(runner, deps = {}) {
    const broadcastEvent = deps.broadcastEvent || (() => {});
    while (runner.running) {
      while (runner.isPaused && runner.running) {
        await deps.sleep(1000);
      }
      if (!runner.running) break;

      const config = runner.loadConfig();

      // Check budget before starting cycle
      const budgetStatus = runner.getBudgetStatus();
      if (budgetStatus && budgetStatus.exhausted) {
        deps.log(`Budget exhausted ($${budgetStatus.spent24h.toFixed(2)}/$${budgetStatus.budgetPer24h}), waiting for budget to roll off`, runner.id);
        runner.setState({ isPaused: true, pauseReason: `Budget exhausted: $${budgetStatus.spent24h.toFixed(2)} / $${budgetStatus.budgetPer24h} (24h)` });
        // Re-check every 2 hours until budget rolls off or manually resumed
        await runner._autoPauseWait(2 * 60 * 60 * 1000, () => !runner.getBudgetStatus().exhausted);
        if (!runner.running) break;
        continue;
      }

      // Check if any API key is available before starting a cycle
      const preConfig = runner.loadConfig();
      const poolCheck = deps.getKeyPoolSafe();
      if (poolCheck.keys.filter(k => k.enabled).length === 0 && !preConfig.setupToken) {
        deps.log(`No AI model credentials configured. Pausing project. Add one in Settings > AI Model Credentials.`, runner.id);
        runner.setState({ isPaused: true, pauseReason: 'No AI model credentials configured. Add one in Settings > AI Model Credentials.' });
        await runner._autoPauseWait(30_000, () => deps.getKeyPoolSafe().keys.some(k => k.enabled));
        if (!runner.running) break;
        continue;
      }

      const { managers, workers } = runner.loadAgents();

      // Start new cycle — preserve schedule state if resuming from reboot
      runner.abortCurrentCycle = false;
      const resuming = !!runner.currentSchedule;
      if (!resuming) {
        runner.cycleCount++;
        runner.completedAgents = [];
        runner.saveState();
      }
      deps.log(`===== CYCLE ${runner.cycleCount} (phase: ${runner.phase})${resuming ? ' [RESUMING]' : ''} =====`, runner.id);

      let cycleFailures = 0;
      let cycleTotal = 0;

      // ===== PHASE: ATHENA (strategy) =====
      if (runner.phase === 'athena') {
        // Health check: mechanical tripwires escalate to the hygeia auditor,
        // whose stop verdict parks the project on the human.
        try {
          await maybeRunHealthAudit(runner, deps, config, managers);
        } catch (e) {
          deps.log(`Health audit error (ignored): ${e.message}`, runner.id);
        }
        if (runner.isPaused) continue;

        const athena = managers.find(m => m.name === 'athena');
        if (athena) {
          // Build situation context for Athena. Athena owns milestone planning; the
          // orchestrator only validates and executes the DB milestone id Athena emits.
          let situation = '';
          if (runner.pendingUnblockDigest) {
            const digest = runner.pendingUnblockDigest.split('\n').map(line => `> ${line}`).join('\n');
            situation = `> **Situation: Resumed after human-decision block**\n> The project was parked on these decisions:\n${digest}\n> The human has resumed the project. Check the project chat and human/chat issues for their reply. A bare "yes"/"accept" on an item means adopt the recommendation; a rejection comes with their reason. Apply the answered decisions, and re-emit PROJECT_BLOCKED only for decisions that are genuinely still unanswered.\n\n`;
            runner.setState({ pendingUnblockDigest: null });
          } else if (runner.examinationFeedback) {
            situation = `> **Situation: Project Completion Rejected by Themis**\n> ${runner.examinationFeedback}\n\n`;
          } else if (!runner.milestoneDescription) {
            situation = '> **Situation: Project Just Started**\n\n';
          } else if (runner.verificationFeedback === '__passed__') {
            situation = '> **Situation: Milestone Verified Complete**\n> Previous milestone was verified by Apollo\'s team.\n\n';
          } else if (runner.verificationFeedback) {
            situation = `> **Situation: Epoch PR Rejected by Apollo**\n> ${runner.verificationFeedback}\n> Previous milestone: ${runner.currentMilestoneId || 'unknown'}\n> Previous branch: ${runner.currentMilestoneBranch || 'unknown'}\n> Athena should split or narrow the failed milestone into a new PR-sized milestone, not send it back as a generic fix round.\n\n`;
          } else {
            situation = `> **Situation: Implementation Deadline Missed**\n> Ares's team used ${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles without completing the milestone.\n> Previous milestone: ${runner.currentMilestoneId || 'unknown'}\n> Current branch: ${runner.currentMilestoneBranch || 'not set'}\n\n`;
          }
          situation += `> **Milestone planning:** Select an existing DB milestone record or create/refine one yourself with tbc-db milestone-* --actor athena. Output only that existing milestone id in the MILESTONE directive when ready.\n\n`;
          situation = consumeWaitResultContext(runner) + situation;
          if (runner.healthWarning) {
            situation = `> **⚠️ Health audit warning (mandatory response):** ${runner.healthWarning}\n> Either change course now, block the project on the human with PROJECT_BLOCKED, or state explicitly in your response why the next milestone breaks this pattern. Do not continue the flagged pattern silently.\n\n` + situation;
            runner.setState({ healthWarning: null });
          }

          let result = await runManagerWithDirectiveRetry(runner, deps, athena, config, situation);
          if (result?.success && result?.resultText) {
            const milestoneProblem = await validateAthenaMilestoneDirective(runner, result.resultText);
            const blockedProblem = parseProjectBlockedDirective(result.resultText)?.error || null;
            const problem = milestoneProblem || (blockedProblem ? { message: blockedProblem } : null);
            if (problem) {
              deps.log(`Rejecting Athena directive response: ${problem.message}`, runner.id);
              const correction = `> **Orchestrator rejected your previous directive before acting on it.**\n> Problem: ${problem.message}\n> Generate a corrected response now. If you need to hand off a milestone, first create or edit the DB milestone record, then output only its id. If you are blocking on human decisions, emit valid PROJECT_BLOCKED JSON with a "decisions" array where every entry has "question" and "recommendation".\n\n${situation}`;
              result = await runner.runAgent(athena, config, null, correction, null);
            }
          }
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          // Parse schedule and milestone from Athena's response
          let schedule = null;
          if (result && result.resultText) {
            schedule = runner.parseSchedule(result.resultText);
            if (schedule) {
              deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
            }

            const milestoneMatch = result.resultText.match(/<!-- MILESTONE -->\s*([\s\S]*?)\s*<!-- \/MILESTONE -->/);
            if (milestoneMatch) {
              try {
                const payload = milestoneMatch[1].trim();
                let milestoneId;
                let milestoneTitle;
                let milestoneDescription;
                let milestoneCyclesBudget;
                let parentMilestoneId;

                if (payload.startsWith('{')) {
                  // Backward-compatible support for older Athena prompts.
                  const milestone = JSON.parse(payload);
                  milestoneTitle = milestone.title || milestone.description.slice(0, 80);
                  milestoneDescription = milestone.description;
                  milestoneCyclesBudget = milestone.cycles || 20;
                  const resetTarget = runner.normalizeResetTargetMilestone(milestone.reset_to);
                  const resetTo = resetTarget ? resetTarget.milestoneId : (runner.currentMilestoneId || null);
                  const shouldReusePendingMilestoneId = !!runner.pendingMilestoneId && resetTo === (runner.currentMilestoneId || null);
                  milestoneId = shouldReusePendingMilestoneId
                    ? runner.pendingMilestoneId
                    : await runner.allocateNextMilestoneId(resetTo);
                  parentMilestoneId = runner.getParentMilestoneId(milestoneId);
                  if (milestone.reset_to && !resetTarget) {
                    deps.log(`Ignoring invalid reset_to target from Athena: ${milestone.reset_to}`, runner.id);
                  } else if (milestone.reset_to && resetTarget) {
                    deps.log(`Athena reset planning anchor to ${resetTarget.label}`, runner.id);
                  }
                } else {
                  milestoneId = payload.replace(/^['"]|['"]$/g, '').trim();
                  const milestone = await runner.getMilestoneRecord(milestoneId);
                  if (!milestone) {
                    throw new Error(`Milestone ${milestoneId} not found`);
                  }
                  milestoneTitle = milestone.title || milestone.milestone_id;
                  milestoneDescription = milestone.description || milestoneTitle;
                  milestoneCyclesBudget = milestone.cycles_budget || 20;
                  parentMilestoneId = milestone.parent_milestone_id || runner.getParentMilestoneId(milestoneId);
                }

                runner.setState({
                  milestoneTitle,
                  milestoneDescription,
                  milestoneCyclesBudget,
                  milestoneCyclesUsed: 0,
                  currentMilestoneId: milestoneId,
                  pendingMilestoneId: null,
                  currentEpochId: null,
                  currentEpochPrId: null,
                  currentMilestoneBranch: null,
                  aresGraceCycleUsed: false,
                  verificationFeedback: null,
                  examinationFeedback: null,
                  pendingCompletionMessage: null,
                  isFixRound: false,
                  phase: 'implementation',
                });
                await runner.upsertMilestoneRecord({
                  milestoneId,
                  title: milestoneTitle,
                  description: milestoneDescription,
                  cyclesBudget: milestoneCyclesBudget,
                  branchName: null,
                  parentMilestoneId,
                  phase: 'implementation',
                  status: 'active',
                });
                runner.epochCount++;
                runner.saveState();
                deps.log(`Epoch ${runner.epochCount}: New milestone (${runner.milestoneCyclesBudget} cycles): ${runner.milestoneDescription.slice(0, 100)}...`, runner.id);
                broadcastEvent({ type: 'milestone', project: runner.id, title: runner.milestoneTitle, cycles: runner.milestoneCyclesBudget });
              } catch (e) {
                deps.log(`Failed to parse milestone: ${e.message}`, runner.id);
              }
            }
            // Check for PROJECT_COMPLETE tag
            const completeMatch = result.resultText.match(/<!-- PROJECT_COMPLETE -->\s*([\s\S]*?)\s*<!-- \/PROJECT_COMPLETE -->/);
            if (completeMatch) {
              try {
                const completion = JSON.parse(completeMatch[1]);
                const success = !!completion.success;
                const message = completion.message || 'Project completed';
                if (success) {
                  runner.setState({
                    phase: 'examination',
                    pendingCompletionMessage: message,
                    examinationFeedback: null,
                    completionSuccess: false,
                    completionMessage: null,
                    isComplete: false,
                    isPaused: false,
                    pauseReason: null,
                  });
                  deps.log(`🧪 PROJECT COMPLETE claimed — routing to Themis examination: ${message}`, runner.id);
                  broadcastEvent({ type: 'phase', project: runner.id, phase: 'examination', title: runner.milestoneTitle || 'Project examination' });
                } else {
                  runner.setState({
                    isComplete: true,
                    completionSuccess: success,
                    completionMessage: message,
                    isPaused: true,
                    pauseReason: `Project ${success ? 'completed successfully' : 'ended'}: ${message}`,
                  });
                  deps.log(`🏁 PROJECT COMPLETE (success: ${success}): ${message}`, runner.id);
                  broadcastEvent({ type: 'project-complete', project: runner.id, success, message });
                }
                continue;
              } catch (e) {
                deps.log(`Failed to parse PROJECT_COMPLETE: ${e.message}`, runner.id);
              }
            }

            // Check for PROJECT_BLOCKED tag — park the project until the human answers
            const blockedParse = parseProjectBlockedDirective(result.resultText);
            if (blockedParse?.blocked) {
              const digest = renderBlockedDigest(blockedParse.blocked);
              runner.setState({
                isBlocked: true,
                blockedDecisions: blockedParse.blocked,
                pendingUnblockDigest: null,
                pendingMilestoneId: null,
                isPaused: true,
                pauseReason: digest,
              });
              deps.log(`🚧 PROJECT BLOCKED on ${blockedParse.blocked.decisions.length} human decision(s) — pausing until resumed`, runner.id);
              broadcastEvent({
                type: 'project-blocked',
                project: runner.id,
                summary: blockedParse.blocked.summary,
                decisions: blockedParse.blocked.decisions,
                message: digest,
              });
              continue;
            } else if (blockedParse?.error) {
              deps.log(`Ignoring malformed PROJECT_BLOCKED after retry: ${blockedParse.error}`, runner.id);
            }

            // Check for STOP file
            if (fs.existsSync(runner.stopPath)) {
              deps.log(`STOP file detected — pausing project`, runner.id);
              runner.setState({ isPaused: true, pauseReason: 'Project stopped by Athena' });
              continue;
            }
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            runner.currentSchedule = schedule;
            runner.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await runner.executeSchedule(schedule, config, 'athena');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
          }

          runner.saveState();
        }
      }

      // ===== PHASE: IMPLEMENTATION (Ares + his workers) =====
      else if (runner.phase === 'implementation') {
        const aresGraceMode = runner.milestoneCyclesUsed >= runner.milestoneCyclesBudget;
        // Check if deadline missed (before running)
        if (aresGraceMode && runner.aresGraceCycleUsed) {
          const failureReason = `Implementation deadline missed after ${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles for ${runner.currentMilestoneId || 'unknown milestone'}.`;
          await runner.decideEpochPR('closed', { actor: 'apollo', reason: failureReason });
          await runner.markCurrentMilestoneFailed(failureReason);
          deps.log(`⏰ Implementation deadline missed (${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles)`, runner.id);
          runner.setState({ currentEpochId: null, currentEpochPrId: null, currentMilestoneBranch: null, aresGraceCycleUsed: false, phase: 'athena', consecutiveReplans: (runner.consecutiveReplans || 0) + 1 });
          continue;
        }

        // Resume interrupted schedule from previous cycle (e.g. after reboot)
        // Note: don't require completedAgents — schedule may start with a delay step
        if (runner.currentSchedule) {
          deps.log(`Resuming interrupted schedule (${runner.completedAgents.length} agents already completed${runner.completedAgents.length ? ': [' + runner.completedAgents.join(', ') + ']' : ''})`, runner.id);
          const { total, failures } = await runner.executeSchedule(runner.currentSchedule, config, 'ares');
          cycleTotal += total;
          cycleFailures += failures;
          runner.currentSchedule = null;
          runner.completedAgents = [];
          runner.saveState();
        } else {

        const ares = managers.find(m => m.name === 'ares');
        if (ares) {
          let epochStateChanged = false;
          if (!runner.currentEpochId) {
            runner.currentEpochId = await runner.allocateNextEpochId();
            runner.epochCount += 1;
            epochStateChanged = true;
          }
          if (!runner.currentMilestoneBranch) {
            const branchPrefix = runner.makeMilestoneBranchPrefix(runner.currentMilestoneId);
            runner.currentMilestoneBranch = `${String(runner.currentEpochId || 'E0').toLowerCase()}-${branchPrefix}-${runner.slugifyMilestoneTitle(runner.milestoneTitle, { stripLeadingMilestoneId: runner.currentMilestoneId })}`;
            epochStateChanged = true;
          }
          if (epochStateChanged) runner.saveState();
          const openEpochPr = await runner.getOpenEpochPRForCurrentMilestone();
          // Build context for Ares (remaining includes this cycle)
          const cyclesRemaining = Math.max(0, runner.milestoneCyclesBudget - runner.milestoneCyclesUsed);
          let aresContext = consumeWaitResultContext(runner);
          aresContext += `> **Milestone ID:** ${runner.currentMilestoneId || 'unknown'}
> **Milestone:** ${runner.milestoneDescription}
> **Epoch ID:** ${runner.currentEpochId || 'unknown'}
> **Cycles remaining:** ${cyclesRemaining} of ${runner.milestoneCyclesBudget}
> **Milestone branch:** ${runner.currentMilestoneBranch || 'not set'}
> **Epoch PR:** ${openEpochPr?.id ? `#${openEpochPr.id}` : 'not set'}
> **Epoch PR guidance:** Prefer one TBC PR for this milestone branch when code changes need review, but this is a soft workflow convention. Managers may create/update/close/merge TBC PRs as needed.

`;
          if (aresGraceMode) {
            aresContext += `> **Grace review mode:** Worker budget is exhausted. This is your final manager-only pass.
> **Do not emit a schedule. Do not assign any workers.**
> Review the existing evidence only. If the milestone is already complete, emit <!-- CLAIM_COMPLETE -->. Otherwise emit no completion block and the milestone will fail.

`;
          }
          if (runner.isFixRound && runner.verificationFeedback) {
            aresContext += `> **Legacy verification feedback:**
> ${runner.verificationFeedback}

`;
          }

          const result = await runManagerWithDirectiveRetry(runner, deps, ares, config, aresContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;
          if (aresGraceMode) runner.aresGraceCycleUsed = true;

          // Parse schedule and check for CLAIM_COMPLETE
          let schedule = null;
          let claimedComplete = false;
          if (result && result.resultText) {
            if (!aresGraceMode) {
              schedule = runner.parseSchedule(result.resultText);
              if (schedule) {
                deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
                runner.currentSchedule = schedule;
              }
            } else if (runner.parseSchedule(result.resultText)) {
              deps.log('⚠️ Ignoring Ares schedule because grace review mode forbids worker scheduling', runner.id);
            }

            // Check if Ares claims milestone complete
            if (result.resultText.includes('<!-- CLAIM_COMPLETE -->')) {
              claimedComplete = true;
              const openEpochPr = await runner.getOpenEpochPRForCurrentMilestone();
              deps.log(`🎯 Ares claims milestone complete${openEpochPr?.id ? ` for TBC PR #${openEpochPr.id}` : ''} — switching to verification`, runner.id);
              runner.setState({ phase: 'verification', currentEpochPrId: openEpochPr?.id || runner.currentEpochPrId || null });
              broadcastEvent({ type: 'phase', project: runner.id, phase: 'verification', title: runner.milestoneTitle });
            }
          }

          if (aresGraceMode && !claimedComplete) {
            const failureReason = `Implementation deadline missed after ${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles for ${runner.currentMilestoneId || 'unknown milestone'} (Ares grace review did not claim completion).`;
            await runner.markCurrentMilestoneFailed(failureReason);
            deps.log(`⏰ ${failureReason}`, runner.id);
            runner.setState({ currentEpochId: null, currentEpochPrId: null, currentMilestoneBranch: null, aresGraceCycleUsed: false, phase: 'athena', verificationFeedback: failureReason, consecutiveReplans: (runner.consecutiveReplans || 0) + 1 });
            runner.saveState();
            continue;
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            runner.completedAgents = [];
            runner.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await runner.executeSchedule(schedule, config, 'ares');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
            runner.saveState();
          }
        }
        } // end else (no interrupted schedule)
        // Only count cycle if at least one agent succeeded
        if (cycleTotal > 0 && cycleFailures < cycleTotal) {
          runner.milestoneCyclesUsed++;
        } else if (cycleTotal > 0) {
          deps.log(`All ${cycleTotal} agents failed — cycle not counted toward milestone budget`, runner.id);
        }
        runner.saveState();
      }

      // ===== PHASE: VERIFICATION (Apollo + his workers) =====
      else if (runner.phase === 'verification') {
        // Resume interrupted verification schedule (e.g. after reboot)
        if (runner.currentSchedule && runner.completedAgents.length > 0) {
          deps.log(`Resuming interrupted verification schedule (${runner.completedAgents.length} agents already completed: [${runner.completedAgents.join(', ')}])`, runner.id);
          const { total, failures } = await runner.executeSchedule(runner.currentSchedule, config, 'apollo');
          cycleTotal += total;
          cycleFailures += failures;
          runner.currentSchedule = null;
          runner.completedAgents = [];
          runner.saveState();
        } else {
        const apollo = managers.find(m => m.name === 'apollo');
        if (apollo) {
          const isRollupVerification = !runner.currentEpochPrId;
          const apolloContext = consumeWaitResultContext(runner) + (isRollupVerification
            ? `> **Milestone ID:** ${runner.currentMilestoneId || 'unknown'}\n> **Milestone to verify:** ${runner.milestoneDescription}\n> **Verification mode:** Parent milestone rollup after a child milestone passed\n> **Active epoch PR:** none (rollup verification)\n> Apollo should decide whether this parent milestone is now fully complete or Athena should plan the next child under it.\n\n`
            : `> **Milestone ID:** ${runner.currentMilestoneId || 'unknown'}\n> **Milestone to verify:** ${runner.milestoneDescription}\n> **Milestone branch:** ${runner.currentMilestoneBranch || 'not set'}\n> **Active epoch PR:** ${runner.currentEpochPrId || 'unknown'}\n> Apollo owns the PR decision: merge on pass, close on fail.\n\n`);

          const result = await runManagerWithDirectiveRetry(runner, deps, apollo, config, apolloContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          let schedule = null;
          let decision = null;
          if (result && result.resultText) {
            schedule = runner.parseSchedule(result.resultText);
            if (schedule) {
              deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
            }

            // Check for verification decision
            if (result.resultText.includes('<!-- VERIFY_PASS -->')) {
              decision = 'pass';
            }
            const failMatch = result.resultText.match(/<!-- VERIFY_FAIL -->\s*([\s\S]*?)\s*<!-- \/VERIFY_FAIL -->/);
            if (failMatch) {
              try {
                const failData = JSON.parse(failMatch[1]);
                decision = 'fail';
                runner.verificationFeedback = failData.feedback || 'Verification failed (no specific feedback)';
              } catch {
                decision = 'fail';
                runner.verificationFeedback = 'Verification failed (could not parse feedback)';
              }
            }
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            runner.currentSchedule = schedule;
            runner.completedAgents = [];
            runner.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await runner.executeSchedule(schedule, config, 'apollo');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
            runner.saveState();
          }

          // Process decision
          if (decision === 'pass') {
            const completedMilestoneId = runner.currentMilestoneId;
            const completedMilestoneTitle = runner.milestoneTitle;
            const parentMilestoneId = runner.getParentMilestoneId(completedMilestoneId);
            await runner.markCurrentMilestoneCompleted();
            if (parentMilestoneId) {
              const parentMilestone = await runner.getMilestoneRecord(parentMilestoneId);
              deps.log(`✅ Milestone verified — escalating completion check to parent milestone ${parentMilestoneId}`, runner.id);
              broadcastEvent({ type: 'verified', project: runner.id, title: completedMilestoneTitle });
              if (parentMilestone) {
                await runner.upsertMilestoneRecord({
                  milestoneId: parentMilestoneId,
                  title: parentMilestone.title,
                  description: parentMilestone.description,
                  cyclesBudget: parentMilestone.cycles_budget,
                  branchName: parentMilestone.branch_name,
                  parentMilestoneId: parentMilestone.parent_milestone_id,
                  phase: 'verification',
                  status: 'active',
                  linkedPrId: parentMilestone.linked_pr_id,
                  failureReason: null,
                });
              }
              runner.setState({
                milestoneTitle: parentMilestone?.title || parentMilestoneId,
                milestoneDescription: parentMilestone?.description || `Parent rollup verification for ${parentMilestoneId}`,
                milestoneCyclesBudget: parentMilestone?.cycles_budget || 0,
                milestoneCyclesUsed: parentMilestone?.cycles_used || 0,
                currentMilestoneId: parentMilestoneId,
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: parentMilestone?.branch_name || null,
                aresGraceCycleUsed: false,
                lastMergedMilestoneBranch: runner.currentMilestoneBranch || runner.lastMergedMilestoneBranch,
                verificationFeedback: null,
                isFixRound: false,
                consecutiveReplans: 0,
                phase: 'verification',
              });
              broadcastEvent({ type: 'phase', project: runner.id, phase: 'verification', title: parentMilestone?.title || parentMilestoneId });
            } else {
              deps.log(`✅ Milestone verified — waking Athena for next milestone`, runner.id);
              broadcastEvent({ type: 'verified', project: runner.id, title: runner.milestoneTitle });
              runner.milestoneTitle = null;
              runner.setState({
                milestoneTitle: null,
                milestoneDescription: null,
                milestoneCyclesBudget: 0,
                milestoneCyclesUsed: 0,
                currentMilestoneId: null,
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: null,
                aresGraceCycleUsed: false,
                lastMergedMilestoneBranch: runner.currentMilestoneBranch || runner.lastMergedMilestoneBranch,
                verificationFeedback: null,
                isFixRound: false,
                consecutiveReplans: 0,
                phase: 'athena',
              });
            }
          } else if (decision === 'fail') {
            const failureReason = runner.verificationFeedback || 'Apollo rejected the epoch PR and requested milestone splitting or narrowing.';
            if (isRollupVerification) {
              deps.log('❌ Parent rollup verification incomplete — returning to Athena to plan the next child milestone', runner.id);
              broadcastEvent({ type: 'verify-fail', project: runner.id, title: runner.milestoneTitle });
              runner.setState({
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: null,
                aresGraceCycleUsed: false,
                verificationFeedback: failureReason,
                isFixRound: false,
                consecutiveReplans: (runner.consecutiveReplans || 0) + 1,
                phase: 'athena',
              });
            } else {
              await runner.markCurrentMilestoneFailed(failureReason);
              deps.log('❌ Verification failed — returning to Athena for split/replan', runner.id);
              broadcastEvent({ type: 'verify-fail', project: runner.id, title: runner.milestoneTitle });
              runner.setState({
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                aresGraceCycleUsed: false,
                verificationFeedback: failureReason,
                isFixRound: false,
                consecutiveReplans: (runner.consecutiveReplans || 0) + 1,
                phase: 'athena',
              });
            }
          } else {
            // No decision yet, stay in verification phase — still save
            runner.saveState();
          }
        }
        } // end else (no interrupted verification schedule)
      }

      // ===== PHASE: EXAMINATION (Themis final audit) =====
      else if (runner.phase === 'examination') {
        // Resume interrupted examination schedule (e.g. after reboot)
        if (runner.currentSchedule) {
          deps.log(`Resuming interrupted examination schedule (${runner.completedAgents.length} agents already completed${runner.completedAgents.length ? ': [' + runner.completedAgents.join(', ') + ']' : ''})`, runner.id);
          const { total, failures } = await runner.executeSchedule(runner.currentSchedule, config, 'themis');
          cycleTotal += total;
          cycleFailures += failures;
          runner.currentSchedule = null;
          runner.completedAgents = [];
          runner.saveState();
        } else {
        const themis = managers.find(m => m.name === 'themis');
        if (themis) {
          const themisContext = consumeWaitResultContext(runner)
            + `> **Final completion claim:** ${runner.pendingCompletionMessage || 'Project claimed complete'}\n> **Audit, don't veto.** Judge the claim against the spec's own success definition first, then record everything else as advisory findings for the human. Conclude with EXAM_PASS or EXAM_FINDINGS — either way the project completes and your findings go into the final audit report.\n\n`;
          let result = await runManagerWithDirectiveRetry(runner, deps, themis, config, themisContext, { visibility: { mode: 'full', issues: [] } });
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          let schedule = null;
          let verdict = null;
          if (result && result.resultText) {
            schedule = runner.parseSchedule(result.resultText);
            if (schedule) {
              deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
            }
            verdict = parseExamVerdict(result.resultText);
          }

          // No verdict and no further investigation: one correction retry, then
          // complete anyway with an inconclusive note — examination never loops
          // the project back to Athena.
          if (!schedule && !verdict) {
            deps.log('Themis returned no verdict and no schedule — requesting a corrected response', runner.id);
            const correction = `> **Orchestrator rejected your previous response before acting on it.**\n> Problem: your response contained neither a SCHEDULE, nor EXAM_PASS, nor EXAM_FINDINGS.\n> Conclude the audit now with <!-- EXAM_PASS --> or <!-- EXAM_FINDINGS -->{"summary":"...","findings":[{"title":"...","detail":"..."}]}<!-- /EXAM_FINDINGS -->.\n\n${themisContext}`;
            result = await runner.runAgent(themis, config, null, correction, { mode: 'full', issues: [] });
            cycleTotal++;
            if (!result || !result.success) cycleFailures++;
            verdict = result?.resultText ? parseExamVerdict(result.resultText) : null;
            if (!verdict) {
              verdict = {
                verdict: 'findings',
                summary: 'Audit inconclusive — Themis returned no verdict after a retry.',
                findings: [],
                inconclusive: true,
              };
            }
          }

          if (schedule) {
            runner.currentSchedule = schedule;
            runner.completedAgents = [];
            runner.saveState();
            const { total, failures } = await runner.executeSchedule(schedule, config, 'themis');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
            runner.saveState();
          }

          if (verdict) {
            const claim = runner.pendingCompletionMessage || 'Project completed';
            const reportPath = writeFinalAuditReport(runner, deps, verdict, claim);
            const auditNote = verdict.verdict === 'clean'
              ? 'Final audit: clean.'
              : `Final audit: ${verdict.findings.length} finding(s)${verdict.inconclusive ? ' (inconclusive)' : ''} — see ${reportPath}`;
            const message = `${claim} — ${auditNote}`;
            runner.setState({
              phase: 'athena',
              isComplete: true,
              completionSuccess: true,
              completionMessage: message,
              pendingCompletionMessage: null,
              examinationFeedback: null,
              currentSchedule: null,
              completedAgents: [],
              isPaused: true,
              pauseReason: `Project completed: ${message}`,
            });
            deps.log(`🏁 PROJECT COMPLETE (audited by Themis — ${verdict.verdict === 'clean' ? 'clean' : `${verdict.findings.length} finding(s)`}): ${claim}`, runner.id);
            broadcastEvent({ type: 'project-complete', project: runner.id, success: true, message });
          } else {
            // Investigation continues, stay in examination phase — still save
            runner.saveState();
          }
        }
        } // end else (no interrupted examination schedule)
      }

      // If no agent succeeded, don't count this cycle
      if (cycleTotal > 0 && cycleFailures === cycleTotal) {
        runner.cycleCount--;
        runner.saveState();
      }

      // Track consecutive agent failures — auto-pause after 10
      runner.consecutiveFailures = (cycleTotal > 0 && cycleFailures === cycleTotal)
        ? runner.consecutiveFailures + cycleFailures
        : 0;
      if (runner.consecutiveFailures >= 10 && runner.running) {
        deps.log(`⚠️ ${runner.consecutiveFailures} consecutive agent failures — auto-pausing (retry in 2h)`, runner.id);
        broadcastEvent({ type: 'error', project: runner.id, message: `${runner.consecutiveFailures} consecutive failures — auto-paused` });
        runner.setState({ isPaused: true, pauseReason: `${runner.consecutiveFailures} consecutive agent failures` });
        runner.consecutiveFailures = 0;
        await runner._autoPauseWait(2 * 60 * 60 * 1000);
        if (!runner.running) break;
        continue;
      }

      // Compute sleep: budget-derived or fixed interval
      const sleepMs = runner.computeSleepInterval();
      runner.lastComputedSleepMs = sleepMs; // Cache for status requests
      if (runner.running) {
        deps.log(`Sleeping ${Math.round(sleepMs / 1000)}s...`, runner.id);
        runner.wakeNow = false;
        runner.sleepUntil = Date.now() + sleepMs;

        let sleptMs = 0;
        while (sleptMs < sleepMs && !runner.wakeNow && runner.running) {
          await deps.sleep(5000);
          sleptMs += 5000;
          while (runner.isPaused && !runner.wakeNow && runner.running) {
            await deps.sleep(1000);
          }
        }
        runner.sleepUntil = null;
      }
    }
  }
