import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { readJson, sendJson } from '../../http.js';

export async function handleProjectStatusRoutes(req, res, url, ctx) {
  const { runner, subPath, root, getKeyPoolSafe } = ctx;

  if (req.method === 'GET' && subPath === 'status') {
    sendJson(res, 200, runner.getStatus());
    return true;
  }

  if (req.method === 'GET' && subPath === 'logs') {
    const lines = parseInt(url.searchParams.get('lines')) || 50;
    sendJson(res, 200, { logs: runner.getLogs(lines) });
    return true;
  }

  if (req.method === 'GET' && subPath === 'agent-log') {
    const running = runner.currentAgent !== null;
    let keyLabel = null;
    if (runner.currentAgentKeyId) {
      const pool = getKeyPoolSafe();
      keyLabel = (pool.keys || []).find(key => key.id === runner.currentAgentKeyId)?.label || null;
    }
    sendJson(res, 200, {
      running,
      agent: runner.currentAgent,
      model: runner.currentAgentModel,
      keyId: runner.currentAgentKeyId || null,
      keyLabel,
      visibility: runner.currentAgentVisibility || { mode: 'full', issues: [] },
      startTime: runner.currentAgentStartTime,
      cost: runner.currentAgentCost || 0,
      usage: runner.currentAgentUsage || null,
      log: running ? runner.currentAgentLog : [],
    });
    return true;
  }

  if (req.method === 'GET' && subPath === 'agents') {
    sendJson(res, 200, runner.loadAgents());
    return true;
  }

  if (req.method === 'GET' && subPath.startsWith('agents/') && subPath.split('/')[1]) {
    const agentName = subPath.split('/')[1];
    const details = runner.getAgentDetails(agentName);
    if (!details) {
      sendJson(res, 404, { error: 'Agent not found' });
      return true;
    }
    sendJson(res, 200, details);
    return true;
  }

  if (req.method === 'PATCH' && subPath.startsWith('agents/') && subPath.split('/')[1]) {
    const agentName = subPath.split('/')[1];
    try {
      const { model } = await readJson(req);
      if (!model && model !== '') throw new Error('Missing model');

      const managersDir = path.join(root, 'agent', 'managers');
      const workersDir = runner.workerSkillsDir;
      const isManager = fs.existsSync(path.join(managersDir, `${agentName}.md`));
      const isWorker = fs.existsSync(path.join(workersDir, `${agentName}.md`));

      if (!isManager && !isWorker) {
        sendJson(res, 404, { error: 'Agent not found' });
        return true;
      }

      if (isManager) {
        const config = runner.loadConfig();
        if (!config.managers) config.managers = {};
        if (!config.managers[agentName]) config.managers[agentName] = {};
        if (model) {
          config.managers[agentName].model = model;
        } else {
          delete config.managers[agentName].model;
          if (Object.keys(config.managers[agentName]).length === 0) {
            delete config.managers[agentName];
          }
        }
        fs.writeFileSync(runner.configPath, yaml.dump(config, { lineWidth: -1 }));
      } else {
        const skillPath = path.join(workersDir, `${agentName}.md`);
        let content = fs.readFileSync(skillPath, 'utf-8');
        if (content.startsWith('---')) {
          if (model) {
            content = content.replace(/^(---[\s\S]*?)model:\s*.+$/m, `$1model: ${model}`);
            if (!content.match(/^model:/m)) {
              content = content.replace(/^---\n/, `---\nmodel: ${model}\n`);
            }
          }
        } else {
          content = `---\n${model ? `model: ${model}\n` : ''}---\n${content}`;
        }
        fs.writeFileSync(skillPath, content);
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
