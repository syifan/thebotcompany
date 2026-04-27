import { sendJson } from '../../http.js';
import { resolveModel, callModel, buildUserMessage } from '../../../providers/index.js';
import { getKeyPoolSafe, resolveKeyForProject, markRateLimited } from '../../../key-pool.js';

export async function handleProjectReportRoutes(req, res, url, ctx) {
  const { runner, subPath, log, getOAuthAccessToken, getProviderRuntimeSelection, parseSummarizeCooldown } = ctx;

  if (req.method === 'GET' && subPath === 'reports') {
    try {
      const db = runner.getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle INTEGER NOT NULL,
        agent TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`);
      try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN visibility_mode TEXT'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN visibility_issues TEXT'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
      try { db.exec('ALTER TABLE reports ADD COLUMN milestone_id TEXT'); } catch {}
      const agent = url.searchParams.get('agent');
      const page = parseInt(url.searchParams.get('page')) || 1;
      const perPage = parseInt(url.searchParams.get('per_page')) || 20;
      let query = 'SELECT * FROM reports';
      const params = [];
      if (agent) { query += ' WHERE agent = ?'; params.push(agent); }
      query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
      params.push(perPage, (page - 1) * perPage);
      const reports = db.prepare(query).all(...params);
      const total = db.prepare(`SELECT COUNT(*) as count FROM reports${agent ? ' WHERE agent = ?' : ''}`).get(...(agent ? [agent] : [])).count;
      db.close();

      const keyPool = getKeyPoolSafe();
      const keyMap = new Map((keyPool.keys || []).map(k => [k.id, k.label]));
      for (const r of reports) {
        if (r.key_id) r.key_label = keyMap.get(r.key_id) || null;
        try { r.visibility_issues = r.visibility_issues ? JSON.parse(r.visibility_issues) : []; } catch { r.visibility_issues = []; }
        if (!r.visibility_mode) r.visibility_mode = 'full';
      }
      sendJson(res, 200, { reports, total, page, perPage });
    } catch {
      sendJson(res, 200, { reports: [], total: 0, page: 1, perPage: 20 });
    }
    return true;
  }

  const summarizeMatch = req.method === 'POST' && subPath.match(/^reports\/(\d+)\/summarize$/);
  if (summarizeMatch) {
    const reportId = parseInt(summarizeMatch[1], 10);
    let keyResult = null;
    try {
      const db = runner.getDb();
      try { db.exec('ALTER TABLE reports ADD COLUMN summary TEXT'); } catch {}
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
      if (!report) { db.close(); res.writeHead(404); res.end('Not found'); return true; }
      if (report.summary) { db.close(); sendJson(res, 200, { summary: report.summary }); return true; }

      const config = runner.loadConfig() || {};
      const oauthGetter = async (authFile, provider) => getOAuthAccessToken(provider);
      const poolSafe = getKeyPoolSafe();
      const firstKey = poolSafe.keys.find(k => k.enabled);
      const providerHintForSummary = config.setupTokenProvider || firstKey?.provider || 'anthropic';

      keyResult = await resolveKeyForProject(config, providerHintForSummary, oauthGetter);
      const token = keyResult?.token || config.setupToken || null;

      if (!token) { db.close(); sendJson(res, 500, { error: 'No API token configured' }); return true; }

      const actualProvider = keyResult?.provider || providerHintForSummary;
      const runtimeSelection = getProviderRuntimeSelection({
        provider: actualProvider,
        modelTier: 'xlow',
        keyResult,
        projectModels: null,
      });
      const model = runtimeSelection.selectedModel;

      log(`Summarize report ${reportId}: provider=${actualProvider}, model=${model}`, runner.id);

      const cleanBody = report.body
        .replace(/^>\s*⏱.*$/m, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 4000);

      const prompt = `Summarize this agent report in 5-8 words. Return ONLY the summary, nothing else.\n\n${cleanBody}`;

      const { piModel } = resolveModel(model, actualProvider);
      const isOAuth = keyResult?.type === 'oauth';
      const summaryResponse = await callModel(
        piModel,
        'You are a helpful assistant. Return ONLY the summary, nothing else.',
        [buildUserMessage(prompt)],
        [],
        { token, isOAuth, provider: actualProvider, customConfig: runtimeSelection.customConfig || null },
      );
      const summary = summaryResponse.content?.trim() || null;

      if (summary) db.prepare('UPDATE reports SET summary = ? WHERE id = ?').run(summary, reportId);
      db.close();
      sendJson(res, 200, { summary });
    } catch (error) {
      log(`Summarize error: ${error.message}`, runner.id);
      if (keyResult?.keyId && /rate.limit|usage.limit|quota|429/i.test(error.message)) {
        const cooldownMs = parseSummarizeCooldown(error.message);
        markRateLimited(keyResult.keyId, cooldownMs);
        log(`Summarize: marked key ${keyResult.keyId} rate-limited for ${Math.ceil(cooldownMs / 60_000)}m`, runner.id);
      }
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  return false;
}
