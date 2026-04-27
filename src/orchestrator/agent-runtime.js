import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { runAgentWithAPI } from '../agent-runner.js';
import { resolveKeyForProject, markRateLimited, markKeySucceeded } from '../key-pool.js';
import { writeRunnerReport } from './project-db.js';

export function postProcessAgentRun(runner, deps = {}, agent, config, { resultText, cost, durationMs, killedByTimeout, exitCode, rawOutput, apiSuccess, usage }) {
    const durationStr = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
    // For API runner: use apiSuccess if provided; for CLI runner: use exitCode
    const success = !killedByTimeout && (apiSuccess !== undefined ? apiSuccess : (exitCode === 0 || exitCode === undefined));

    // Build token info string for logging
    let tokenInfo = '';
    if (cost !== undefined) {
      tokenInfo = ` | cost: $${cost.toFixed(4)}`;
    }

    // Log response to agent-specific log file
    try {
      const responsesDir = runner.responsesDir;
      fs.mkdirSync(responsesDir, { recursive: true });
      const timestamp = new Date().toLocaleString('sv-SE', { hour12: false }).replace(',', '');
      const header = `\n${'='.repeat(60)}\n[${timestamp}] Cycle ${runner.cycleCount} | Success: ${success}\n${'='.repeat(60)}\n`;

      // Always log raw output for debugging
      const rawLogPath = path.join(responsesDir, `${agent.name}.raw.log`);
      fs.appendFileSync(rawLogPath, header + (rawOutput || resultText || '') + '\n');

      // Log parsed result if available
      if (resultText) {
        const agentLogPath = path.join(responsesDir, `${agent.name}.log`);
        fs.appendFileSync(agentLogPath, header + resultText + '\n');
      }
    } catch (e) {
      deps.log(`Failed to log response for ${agent.name}: ${e.message}`, runner.id);
    }

    // Write agent report to SQLite (cost data included — no longer writes to cost.csv)
    if (resultText || killedByTimeout || !success) {
      try {
        let reportBody;
        if (killedByTimeout || !success) {
          const errorType = killedByTimeout ? '⏰ Timeout' : '❌ Error';
          const errorMsg = killedByTimeout
            ? `Killed after exceeding the ${Math.floor(config.agentTimeoutMs / 60000)}m timeout limit.`
            : `Agent failed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}.`;
          // Capture partial work on timeout
          let partialWork = '';
          if (killedByTimeout) {
            try {
              const repoDir = path.join(runner.projectDir, 'repo');
              if (fs.existsSync(path.join(repoDir, '.git'))) {
                const diffStat = execSync('git diff --stat HEAD 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim();
                const stagedStat = execSync('git diff --stat --cached HEAD 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim();
                if (diffStat || stagedStat) {
                  partialWork = `\n\n### Partial Work Detected\n\nUncommitted changes found in repo:\n\`\`\`\n${(stagedStat ? 'Staged:\n' + stagedStat + '\n' : '')}${(diffStat ? 'Unstaged:\n' + diffStat : '')}\n\`\`\``;
                }
              }
            } catch {}
          }
          reportBody = `## ${errorType}\n\n${errorMsg}\n\n- Duration: ${durationStr}${partialWork}`;
          // Include partial result text if we have it
          if (resultText) {
            reportBody += `\n\n### Partial Response\n\n${resultText.trim()}`;
          }
        } else {
          reportBody = resultText.trim();
        }
        // Prepend time log to all reports
        const agentStartTime = new Date(runner.currentAgentStartTime).toLocaleString('sv-SE');
        const endTime = new Date().toLocaleString('sv-SE');
        reportBody = `> ⏱ Started: ${agentStartTime} | Ended: ${endTime} | Duration: ${durationStr}\n\n${reportBody}`;
        const { reportId } = writeRunnerReport(runner, agent.name, reportBody, {
          cost: cost ?? null,
          durationMs: durationMs ?? null,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cacheReadTokens: usage?.cacheReadTokens ?? null,
          success,
          model: runner.currentAgentModel ?? null,
          timedOut: killedByTimeout,
          keyId: runner.currentAgentKeyId ?? null,
          visibilityMode: runner.currentAgentVisibility?.mode || 'full',
          visibilityIssues: runner.currentAgentVisibility?.issues || [],
          preformatted: true,
        });
        deps.log(`Saved report for ${agent.name}`, runner.id);
        deps.broadcastReportUpdate(runner.id, reportId, agent.name, runner.cycleCount);
      } catch (dbErr) {
        deps.log(`Failed to write report: ${dbErr.message}`, runner.id);
      }
    }

    deps.log(`${agent.name} done (success: ${success})${tokenInfo}`, runner.id);
    const summary = resultText ? deps.stripMetaBlocks(resultText).slice(0, 500).replace(/\n+/g, ' ').trim() : '';
    deps.broadcastEvent({ type: 'agent-done', project: runner.id, agent: agent.name, success, summary });
    runner.currentAgent = null;
    runner.currentAgentProcess = null;
    runner.currentAgentStartTime = null;
    runner.currentAgentLog = [];
    deps.broadcastStatusUpdate(runner.id);
    runner.currentAgentModel = null; runner.currentAgentCost = 0; runner.currentAgentUsage = null; runner.currentAgentKeyId = null; runner.currentAgentVisibility = null;

    return { success, resultText, killedByTimeout: !!killedByTimeout };
  }

export async function runAgentForRunner(runner, deps = {}, agent, config, mode = null, task = null, visibility = null) {
    runner.currentAgent = agent.name;
    runner.currentAgentKeyId = null;
    runner.currentAgentVisibility = visibility || { mode: 'full', issues: [] };
    runner.currentAgentStartTime = Date.now();
    deps.broadcastStatusUpdate(runner.id);
    const runAbortController = new AbortController();
    runner.currentAgentProcess = {
      kill: () => runAbortController.abort(),
    };
    const modeStr = mode ? ` [${mode}]` : '';
    deps.log(`Running: ${agent.name}${agent.isManager ? ' (manager)' : ''}${modeStr}`, runner.id);

    // Ensure agent notes directory exists for this agent
    const agentNotesDir = runner.getAgentNotesDir(agent.name);
    fs.mkdirSync(agentNotesDir, { recursive: true });

    // Build the prompt (shared between CLI and API paths)
    const skillContent = runner._buildAgentPrompt(agent, task, visibility);
    if (!skillContent) {
      const skillPath = agent.isManager
        ? path.join(deps.root, 'agent', 'managers', `${agent.name}.md`)
        : path.join(runner.workerSkillsDir, `${agent.name}.md`);
      deps.log(`Skill file not found: ${skillPath}, skipping ${agent.name}`, runner.id);
      runner.currentAgent = null;
      runner.currentAgentProcess = null;
      runner.currentAgentStartTime = null;
      runner.currentAgentLog = [];
      runner.currentAgentModel = null; runner.currentAgentCost = 0; runner.currentAgentUsage = null; runner.currentAgentKeyId = null; runner.currentAgentVisibility = null;
      return { success: false, resultText: '' };
    }

    const agentTierOrModel = agent.rawModel || config.model || 'mid';

    // Resolve token from key pool first — provider comes from the resolved key
    const oauthTokenGetter = async (authFile, provider) => {
      return deps.getOAuthAccessToken(provider, runner.id);
    };
    const keyResult = await resolveKeyForProject(config, null, oauthTokenGetter);
    let resolvedToken = keyResult?.token || null;
    let resolvedKeyId = keyResult?.keyId || null;
    const resolvedKeyType = keyResult?.type || 'api';
    runner.currentAgentKeyId = resolvedKeyId;

    // Fallback: setupToken when project key selection is not configured
    if (!resolvedToken && config.setupToken) {
      resolvedToken = config.setupToken;
    }

    // Derive provider from the resolved key
    let providerHint;
    if (keyResult?.provider) {
      providerHint = keyResult.provider;
    } else if (config.setupTokenProvider) {
      providerHint = config.setupTokenProvider;
    } else if (resolvedToken) {
      providerHint = deps.detectProviderFromToken(resolvedToken);
    } else {
      providerHint = 'anthropic';
    }

    const runtimeSelection = deps.getProviderRuntimeSelection({
      provider: providerHint,
      modelTier: agentTierOrModel,
      keyResult,
      projectModels: config.models,
    });
    const agentModel = runtimeSelection.selectedModel;
    const reasoningEffort = runtimeSelection.reasoningEffort || null;
    const customConfig = runtimeSelection.customConfig || null;

    if (!resolvedToken) {
      deps.log(`No API token configured for ${agent.name} (model: ${agentModel}). Skipping agent run. Add a key in Settings.`, runner.id);
      runner.currentAgent = null;
      runner.currentAgentProcess = null;
      runner.currentAgentStartTime = null;
      runner.currentAgentLog = [];
      runner.currentAgentModel = null; runner.currentAgentCost = 0; runner.currentAgentUsage = null; runner.currentAgentKeyId = null; runner.currentAgentVisibility = null;
      deps.broadcastStatusUpdate(runner.id);
      return { error: 'no_token', message: 'No API key configured. Add one in Settings > Credentials.' };
    }

    const agentEnv = {
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      TBC_DB: runner.projectDbPath,
      TBC_VISIBILITY: visibility?.mode || 'full',
      TBC_FOCUSED_ISSUES: visibility?.issues?.join(',') || '',
    };

    const tierLabel = runtimeSelection.reasoningEffort ? `${agentModel} (${runtimeSelection.reasoningEffort})` : agentModel;
    deps.log(`Using API runner for ${agent.name} (model: ${tierLabel})`, runner.id);
    runner.currentAgentModel = tierLabel;

    const projectId = runner.id;
    const result = await runAgentWithAPI({
      prompt: skillContent,
      model: agentModel,
      token: resolvedToken,
      keyType: resolvedKeyType,
      provider: providerHint,
      customConfig,
      reasoningEffort,
      cwd: runner.path,
      timeoutMs: config.agentTimeoutMs || 0,
      env: agentEnv,
      allowedRepo: agent.name === 'doctor' ? null : (runner.repo || null),
      allowedPaths: runner._getAgentFilesystemPolicy(agent, visibility),
      issuePolicy: { ...(visibility || { mode: 'full', issues: [] }), actor: agent.name },
      abortSignal: runAbortController.signal,
      keyId: resolvedKeyId,
      onRateLimited: (kid, cooldownMs) => markRateLimited(kid, cooldownMs || 5 * 60_000),
      resolveNewToken: async () => {
        const newKey = await resolveKeyForProject(config, null, oauthTokenGetter);
        if (newKey?.provider) {
          const newRuntimeSelection = deps.getProviderRuntimeSelection({
            provider: newKey.provider,
            modelTier: agentTierOrModel,
            keyResult: newKey,
            projectModels: null,
          });
          newKey.model = newRuntimeSelection.selectedModel;
          newKey.reasoningEffort = newRuntimeSelection.reasoningEffort || null;
          newKey.customConfig = newRuntimeSelection.customConfig || null;
        }
        if (newKey?.keyId) runner.currentAgentKeyId = newKey.keyId;
        return newKey;
      },
      log: (msg) => {
        deps.log(`  [${agent.name}] ${msg}`, projectId);
        if (typeof msg === 'string' && msg.startsWith('Tool: ')) return;
        const event = { time: Date.now(), type: 'thinking', content: String(msg) };
        runner.currentAgentLog.push(event);
        if (runner.currentAgentLog.length > 500) runner.currentAgentLog.shift();
        deps.broadcastLiveAgentEvent(projectId, event);
      },
      onEvent: (event) => {
        const enriched = { time: Date.now(), ...event };
        runner.currentAgentLog.push(enriched);
        if (runner.currentAgentLog.length > 500) runner.currentAgentLog.shift();
        deps.broadcastLiveAgentEvent(projectId, enriched);
      },
      onProgress: ({ usage, cost }) => {
        runner.currentAgentCost = cost;
        runner.currentAgentUsage = usage;
      },
    });

    if (result.success && resolvedKeyId) {
      markKeySucceeded(resolvedKeyId);
    }

    return postProcessAgentRun(runner, deps, agent, config, {
      resultText: result.resultText,
      cost: result.cost,
      durationMs: result.durationMs,
      killedByTimeout: result.timedOut || false,
      apiSuccess: result.success,
      usage: result.usage,
      rawOutput: JSON.stringify({ usage: result.usage, resultText: result.resultText }),
    });
  }
