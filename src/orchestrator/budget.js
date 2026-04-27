export function computeSleepInterval(runner, deps = {}) {
    const config = runner.loadConfig();
    const budgetPer24h = config.budgetPer24h || 0;
    const MIN_SLEEP = 10000;       // 10s
    const MAX_SLEEP = 7200000;     // 2h

    // If no budget set, fall back to fixed interval
    if (budgetPer24h <= 0) {
      return Math.max(config.cycleIntervalMs || 0, MIN_SLEEP);
    }

    const minFloor = config.cycleIntervalMs > 0 ? config.cycleIntervalMs : MIN_SLEEP;

    // Query cost data from SQLite reports table
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let cycleCosts = [];
    let spent24h = 0;
    let oldestTime24h = Infinity;

    try {
      const db = runner.getDb();
      try { db.exec('ALTER TABLE reports ADD COLUMN cost REAL'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN duration_ms INTEGER'); } catch {}

      spent24h = db.prepare('SELECT COALESCE(SUM(cost), 0) as v FROM reports WHERE created_at > ?').get(cutoff).v;
      const oldest = db.prepare('SELECT MIN(created_at) as v FROM reports WHERE created_at > ?').get(cutoff);
      if (oldest?.v) oldestTime24h = new Date(oldest.v).getTime();

      const cycles = db.prepare('SELECT cycle, SUM(cost) as cost, MAX(duration_ms) as duration FROM reports WHERE cost IS NOT NULL GROUP BY cycle ORDER BY cycle ASC').all();
      cycleCosts = cycles.map(c => ({ cost: c.cost || 0, duration: c.duration || 0 }));
      db.close();
    } catch {}

    const remaining = budgetPer24h - spent24h;

    // Budget exhaustion: sleep until oldest entry rolls off
    if (remaining <= 0) {
      if (oldestTime24h < Infinity) {
        const rolloffAt = oldestTime24h + 24 * 60 * 60 * 1000;
        const waitMs = Math.max(rolloffAt - Date.now(), MIN_SLEEP);
        deps.log(`Budget exhausted ($${spent24h.toFixed(2)}/$${budgetPer24h}), sleeping until oldest entry rolls off`, runner.id);
        return Math.min(waitMs, MAX_SLEEP);
      }
      deps.log(`Budget exhausted, sleeping max`, runner.id);
      return MAX_SLEEP;
    }

    const n = cycleCosts.length;

    // Cold start: no historical data
    if (n === 0) {
      const { managers, workers } = runner.loadAgents();
      const agentCount = managers.length + workers.length || 3;
      const model = (config.model || '').toLowerCase();
      let perAgentCost;
      if (model.includes('opus')) perAgentCost = 2.50;
      else if (model.includes('haiku')) perAgentCost = 0.50;
      else perAgentCost = 1.50; // sonnet default

      const estimatedCycleCost = perAgentCost * agentCount;
      const agentTimeout = config.agentTimeoutMs > 0 ? config.agentTimeoutMs : 900000;
      const estimatedCycleDuration = (agentTimeout / 2) * agentCount;

      const nAffordable = Math.floor(remaining / (estimatedCycleCost * 1.5)); // k=1.5 for cold start
      if (nAffordable <= 0) return MAX_SLEEP;
      const sleepMs = (86400000 / nAffordable) - estimatedCycleDuration;
      deps.log(`Cold start: est cycle cost $${estimatedCycleCost.toFixed(2)}, affordable=${nAffordable}, sleep=${Math.round(sleepMs / 1000)}s`, runner.id);
      return Math.max(minFloor, Math.min(sleepMs, MAX_SLEEP));
    }

    // Compute EMA of cycle costs and durations (alpha=0.3) with outlier dampening
    const alpha = 0.3;
    let emaCost = cycleCosts[0].cost;
    let emaDuration = cycleCosts[0].duration;

    for (let i = 1; i < n; i++) {
      let cycleCost = cycleCosts[i].cost;

      // Outlier dampening: if cost > 3x EMA and we have >= 3 data points, clamp to 2x EMA
      if (i >= 3 && cycleCost > 3 * emaCost) {
        cycleCost = 2 * emaCost;
      }

      emaCost = alpha * cycleCost + (1 - alpha) * emaCost;
      emaDuration = alpha * cycleCosts[i].duration + (1 - alpha) * emaDuration;
    }

    // Conservatism factor: k = 1.0 + 0.5 / sqrt(n)
    const k = 1.0 + 0.5 / Math.sqrt(n);

    const nAffordable = Math.floor(remaining / (emaCost * k));
    if (nAffordable <= 0) {
      deps.log(`Budget nearly exhausted (remaining=$${remaining.toFixed(2)}, est/cycle=$${emaCost.toFixed(2)}), sleeping max`, runner.id);
      return MAX_SLEEP;
    }

    const sleepMs = (86400000 / nAffordable) - emaDuration;
    deps.log(`Budget: $${spent24h.toFixed(2)}/$${budgetPer24h} spent, est/cycle=$${emaCost.toFixed(2)}, k=${k.toFixed(2)}, affordable=${nAffordable}, sleep=${Math.round(Math.max(minFloor, Math.min(sleepMs, MAX_SLEEP)) / 1000)}s`, runner.id);
    return Math.max(minFloor, Math.min(sleepMs, MAX_SLEEP));
  }

export function getBudgetStatus(runner, deps = {}) {
    const config = runner.loadConfig();
    const budgetPer24h = config.budgetPer24h || 0;
    if (budgetPer24h <= 0) return null;

    const costSummary = runner.getCostSummary();
    const spent24h = costSummary.last24hCost;
    const remaining24h = budgetPer24h - spent24h;
    const percentUsed = budgetPer24h > 0 ? (spent24h / budgetPer24h) * 100 : 0;
    const exhausted = remaining24h <= 0;

    return {
      budgetPer24h,
      spent24h,
      remaining24h,
      percentUsed,
      computedSleepMs: runner.lastComputedSleepMs, // Use cached value
      exhausted
    };
  }
