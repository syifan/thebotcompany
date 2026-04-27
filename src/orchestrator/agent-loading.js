import fs from 'fs';
import path from 'path';

function parseRole(content) {
  const fmRole = (content.match(/^role:\s*(.+)$/m) || [])[1]?.trim();
  if (fmRole) return fmRole;
  const match = content.match(/^#\s*\w+\s*\(([^)]+)\)/m);
  return match ? match[1] : null;
}

function shortenModel(model) {
  if (!model) return null;
  const versionMatch = model.match(/(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i);
  if (versionMatch) {
    const name = versionMatch[1].toLowerCase();
    const major = versionMatch[2];
    const minor = versionMatch[3];
    return minor && minor.length <= 2 ? `${name} ${major}.${minor}` : `${name} ${major}`;
  }
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return model;
}

function parseModel(content) {
  const match = content.match(/^model:\s*(.+)$/m);
  return match ? shortenModel(match[1].trim()) : null;
}

function getLastBlock(filePath, maxChars = 15000) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const blocks = content.split(/={60,}/);
    if (blocks.length >= 2) {
      const lastBlock = blocks.slice(-2).join('').trim();
      return lastBlock.length > maxChars ? lastBlock.slice(-maxChars) : lastBlock;
    }
  } catch {}
  return null;
}

export function loadAgentsForRunner(runner, { root }) {
  const managers = [];
  const workers = [];
  const managersDir = path.join(root, 'agent', 'managers');
  const workersDir = runner.workerSkillsDir;
  const config = runner.loadConfig();
  const managerOverrides = config.managers || {};

  if (fs.existsSync(managersDir)) {
    for (const file of fs.readdirSync(managersDir)) {
      if (!file.endsWith('.md')) continue;
      const name = file.replace('.md', '');
      const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
      const overrides = managerOverrides[name] || {};
      const isDisabled = overrides.disabled !== undefined ? overrides.disabled : /^disabled:\s*true$/m.test(content);
      if (isDisabled) continue;
      const frontmatterModel = (content.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null;
      const rawModel = overrides.model || frontmatterModel;
      managers.push({ name, role: parseRole(content), model: shortenModel(rawModel), rawModel, isManager: true });
    }
  }

  if (fs.existsSync(workersDir)) {
    for (const file of fs.readdirSync(workersDir)) {
      if (!file.endsWith('.md')) continue;
      const name = file.replace('.md', '');
      const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
      if (/^disabled:\s*true$/m.test(content)) continue;
      const reportsTo = (content.match(/^reports_to:\s*(.+)$/m) || [])[1]?.trim() || null;
      workers.push({
        name,
        role: parseRole(content),
        model: parseModel(content),
        rawModel: (content.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null,
        isManager: false,
        reportsTo,
      });
    }
  }

  const costSummary = runner.getCostSummary();
  for (const agent of [...managers, ...workers]) {
    const agentCost = costSummary.agents[agent.name];
    agent.totalCost = agentCost ? agentCost.totalCost : 0;
    agent.last24hCost = agentCost ? agentCost.last24hCost : 0;
    agent.lastCallCost = agentCost ? agentCost.lastCallCost : 0;
    agent.avgCallCost = agentCost ? agentCost.avgCallCost : 0;
    agent.callCount = agentCost ? agentCost.callCount : 0;
  }

  return { managers, workers };
}

export function getAgentDetailsForRunner(runner, agentName, { root }) {
  const workersDir = runner.workerSkillsDir;
  const managersDir = path.join(root, 'agent', 'managers');
  const agentNotesDir = runner.getAgentNotesDir(agentName);

  let skillPath = path.join(workersDir, `${agentName}.md`);
  let isManager = false;
  if (!fs.existsSync(skillPath)) {
    skillPath = path.join(managersDir, `${agentName}.md`);
    isManager = true;
  }
  if (!fs.existsSync(skillPath)) return null;

  const skill = fs.readFileSync(skillPath, 'utf-8');
  let agentFiles = [];
  if (fs.existsSync(agentNotesDir)) {
    agentFiles = fs.readdirSync(agentNotesDir).flatMap(f => {
      const filePath = path.join(agentNotesDir, f);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return [];
      return [{
        name: f,
        size: stat.size,
        modified: stat.mtime,
        content: stat.size < 50000 ? fs.readFileSync(filePath, 'utf-8') : null,
      }];
    });
  }

  const responseLogPath = path.join(runner.responsesDir, `${agentName}.log`);
  const rawLogPath = path.join(runner.responsesDir, `${agentName}.raw.log`);
  const frontmatterModel = (skill.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || null;
  const config = runner.loadConfig();
  const overrides = (isManager ? config.managers : config.workers) || {};
  const configModel = overrides[agentName]?.model || null;

  let everyone = null;
  let roleRules = null;
  try { everyone = fs.readFileSync(path.join(root, 'agent', 'everyone.md'), 'utf-8'); } catch {}
  try { roleRules = fs.readFileSync(path.join(root, 'agent', isManager ? 'manager.md' : 'worker.md'), 'utf-8'); } catch {}

  return {
    name: agentName,
    isManager,
    skill,
    agentFiles,
    lastResponse: getLastBlock(responseLogPath),
    lastRawOutput: getLastBlock(rawLogPath),
    model: configModel || frontmatterModel || null,
    everyone,
    roleRules,
  };
}
