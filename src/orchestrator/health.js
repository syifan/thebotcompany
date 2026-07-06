import fs from 'fs';
import { renderBlockedDigest } from './phase-machine.js';

// Team-health monitoring: cheap mechanical signals computed by the orchestrator,
// escalated to a fresh-context auditor agent (hygeia) only when a tripwire fires.
// This exists because a manager inside a livelock cannot see the livelock —
// every next tiny milestone looks locally justified (mgpusim trace: M87.1–M87.27).

export const DEFAULT_HEALTH_THRESHOLDS = {
  consecutiveReplans: 3, // verify-fails + deadline-misses since the last verified milestone
  milestoneFamilySize: 8, // milestones sharing the current milestone's root
  milestoneDepth: 4, // nesting depth of the current milestone id
  noMergeStreak: 5, // terminal milestones since the last merged epoch PR
  cycleFloor: 50, // audit at least every N cycles regardless of tripwires
  snoozeCycles: 25, // cycles to wait after a healthy/warn verdict
};

export function getHealthThresholds(config) {
  const overrides = (config && typeof config.health === 'object' && config.health) || {};
  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS };
  for (const key of Object.keys(thresholds)) {
    if (typeof overrides[key] === 'number' && overrides[key] > 0) thresholds[key] = overrides[key];
  }
  return thresholds;
}

export function computeHealthSignals(runner) {
  const signals = {
    consecutiveReplans: runner.consecutiveReplans || 0,
    milestoneFamilySize: 0,
    milestoneDepth: 0,
    noMergeStreak: 0,
    costSinceLastMerge: 0,
    cyclesSinceLastHealthCheck: runner.cycleCount - (runner.lastHealthCheckCycle || 0),
  };
  let db;
  try {
    db = runner.getDb();
  } catch {
    return signals;
  }
  try {
    const currentId = runner.currentMilestoneId || runner.pendingMilestoneId || null;
    if (currentId) {
      const rootId = String(currentId).split('.')[0];
      signals.milestoneDepth = String(currentId).split('.').length;
      const family = db.prepare('SELECT COUNT(*) AS n FROM milestones WHERE milestone_id = ? OR milestone_id LIKE ?')
        .get(rootId, `${rootId}.%`);
      signals.milestoneFamilySize = family?.n || 0;
    }

    const lastMerge = db.prepare("SELECT MAX(updated_at) AS t FROM tbc_prs WHERE status = 'merged'").get();
    const lastMergeAt = lastMerge?.t || null;
    if (lastMergeAt) {
      const streak = db.prepare(
        "SELECT COUNT(*) AS n FROM milestones WHERE status IN ('completed', 'failed') AND COALESCE(completed_at, created_at) > ?"
      ).get(lastMergeAt);
      signals.noMergeStreak = streak?.n || 0;
      const cost = db.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM reports WHERE created_at > ?').get(lastMergeAt);
      signals.costSinceLastMerge = Math.round((cost?.c || 0) * 100) / 100;
    } else {
      const streak = db.prepare("SELECT COUNT(*) AS n FROM milestones WHERE status IN ('completed', 'failed')").get();
      signals.noMergeStreak = streak?.n || 0;
    }
  } finally {
    db.close();
  }
  return signals;
}

export function healthTripwire(signals, thresholds) {
  if (signals.consecutiveReplans >= thresholds.consecutiveReplans) {
    return `consecutiveReplans=${signals.consecutiveReplans} (>= ${thresholds.consecutiveReplans})`;
  }
  if (signals.milestoneFamilySize >= thresholds.milestoneFamilySize) {
    return `milestoneFamilySize=${signals.milestoneFamilySize} (>= ${thresholds.milestoneFamilySize})`;
  }
  if (signals.milestoneDepth >= thresholds.milestoneDepth) {
    return `milestoneDepth=${signals.milestoneDepth} (>= ${thresholds.milestoneDepth})`;
  }
  if (signals.noMergeStreak >= thresholds.noMergeStreak) {
    return `noMergeStreak=${signals.noMergeStreak} (>= ${thresholds.noMergeStreak})`;
  }
  if (signals.cyclesSinceLastHealthCheck >= thresholds.cycleFloor) {
    return `cycleFloor: ${signals.cyclesSinceLastHealthCheck} cycles since last health check`;
  }
  return null;
}

function safeRead(filePath, limit = 4000) {
  try {
    return fs.readFileSync(filePath, 'utf-8').slice(0, limit);
  } catch {
    return '(unavailable)';
  }
}

export function buildHealthContext(runner, signals, trippedBy) {
  let milestoneTable = '(unavailable)';
  let humanIssues = '(unavailable)';
  try {
    const db = runner.getDb();
    try {
      const rows = db.prepare(`
        SELECT m.milestone_id, m.status, m.title,
               ROUND(COALESCE((SELECT SUM(r.cost) FROM reports r WHERE r.milestone_id = m.milestone_id), 0), 2) AS cost
        FROM milestones m ORDER BY m.id
      `).all();
      milestoneTable = rows.map(row => `${row.milestone_id} | ${row.status} | $${row.cost} | ${row.title}`).join('\n') || '(none)';
      const issues = db.prepare(
        "SELECT id, creator, title FROM issues WHERE status = 'open' AND (creator IN ('human', 'chat') OR title LIKE 'HUMAN:%')"
      ).all();
      humanIssues = issues.map(issue => `#${issue.id} (${issue.creator}): ${issue.title}`).join('\n') || '(none)';
    } finally {
      db.close();
    }
  } catch {}

  const cost = (() => { try { return runner.getCostSummary(); } catch { return null; } })();

  return `You are auditing the health of an autonomous project team from the outside. You have deliberately NOT been given the team's notes, knowledge base, or comment stream — judge the trajectory, not the narrative.

## Tripwire
${trippedBy}

## Signals
${JSON.stringify(signals, null, 2)}

## Project spec (spec.md)
${safeRead(runner.specPath)}

## Current milestone
${runner.currentMilestoneId || '(none)'}: ${runner.milestoneTitle || ''}

## Milestone history (id | status | cost | title)
${milestoneTable}

## Open human decisions / human issues
${humanIssues}

## Cost
${cost ? `total: $${cost.total?.toFixed?.(2) ?? cost.total}, last 24h: $${cost.last24h?.toFixed?.(2) ?? cost.last24h}` : '(unavailable)'}

Decide whether this team is making real progress toward the spec, or is stuck in a loop (repeated near-identical milestones, paperwork without code changes, waiting on decisions no one is answering, goalpost drift past the spec's own success definition).`;
}

export function parseHealthVerdict(resultText) {
  const match = String(resultText || '').match(/<!-- HEALTH -->\s*([\s\S]*?)\s*<!-- \/HEALTH -->/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const verdict = String(data?.verdict || '').toLowerCase();
  if (!['healthy', 'warn', 'stop'].includes(verdict)) return null;
  return {
    verdict,
    diagnosis: data.diagnosis ? String(data.diagnosis) : '',
    decisions: Array.isArray(data.decisions) ? data.decisions : [],
  };
}

export async function maybeRunHealthAudit(runner, deps = {}, config, managers) {
  const thresholds = getHealthThresholds(config);
  if (runner.cycleCount < (runner.healthSnoozeUntilCycle || 0)) return null;

  const signals = computeHealthSignals(runner);
  const trippedBy = healthTripwire(signals, thresholds);
  if (!trippedBy) return null;

  deps.log(`🩺 Health tripwire fired (${trippedBy}) — running hygeia audit`, runner.id);
  runner.lastHealthCheckCycle = runner.cycleCount;
  runner.saveState();

  const hygeia = (managers || []).find(m => m.name === 'hygeia')
    || { name: 'hygeia', isManager: true, rawModel: 'high' };
  const task = buildHealthContext(runner, signals, trippedBy);
  const result = await runner.runAgent(hygeia, config, null, task, { mode: 'blind', issues: [] });
  const verdict = result?.resultText ? parseHealthVerdict(result.resultText) : null;
  if (!verdict) {
    deps.log('Health audit returned no parseable HEALTH verdict — treating as healthy for this window', runner.id);
    runner.healthSnoozeUntilCycle = runner.cycleCount + thresholds.snoozeCycles;
    runner.saveState();
    return null;
  }

  if (verdict.verdict === 'healthy') {
    deps.log(`🩺 Health verdict: healthy — ${verdict.diagnosis || 'no diagnosis'}`, runner.id);
    runner.healthSnoozeUntilCycle = runner.cycleCount + thresholds.snoozeCycles;
    runner.saveState();
  } else if (verdict.verdict === 'warn') {
    deps.log(`🩺 Health verdict: WARN — ${verdict.diagnosis}`, runner.id);
    runner.setState({
      healthWarning: verdict.diagnosis || 'The health audit flagged this team as drifting.',
      healthSnoozeUntilCycle: runner.cycleCount + thresholds.snoozeCycles,
    });
  } else {
    // stop: park the project on the human, reusing the PROJECT_BLOCKED flow
    const decisions = verdict.decisions
      .filter(decision => decision?.question && decision?.recommendation)
      .map((decision, index) => ({
        id: decision.id || index + 1,
        question: String(decision.question),
        recommendation: String(decision.recommendation),
        context: decision.context ? String(decision.context) : null,
      }));
    const blocked = {
      summary: verdict.diagnosis || 'Health audit stopped the project.',
      decisions: decisions.length ? decisions : [{
        id: 1,
        question: 'The health audit found this project stuck. Continue anyway, or change the spec/scope?',
        recommendation: 'review the diagnosis and decide',
        context: verdict.diagnosis ? verdict.diagnosis.slice(0, 200) : null,
      }],
    };
    const digest = renderBlockedDigest(blocked);
    deps.log(`🩺 Health verdict: STOP — parking project. ${verdict.diagnosis}`, runner.id);
    runner.setState({
      isBlocked: true,
      blockedDecisions: blocked,
      pendingUnblockDigest: null,
      isPaused: true,
      pauseReason: digest,
    });
    deps.broadcastEvent?.({
      type: 'project-blocked',
      project: runner.id,
      summary: blocked.summary,
      decisions: blocked.decisions,
      message: digest,
    });
  }
  return verdict;
}
