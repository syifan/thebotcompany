#!/usr/bin/env node
/**
 * TheBotCompany CLI
 * 
 * Usage:
 *   tbc start              Start the orchestrator service
 *   tbc status             Show status of all projects
 *   tbc init               Initialize ~/.thebotcompany
 *   tbc add <id> <path>    Add a project
 *   tbc remove <id>        Remove a project
 *   tbc projects           List configured projects
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TBC_HOME = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');
const PROJECTS_PATH = path.join(TBC_HOME, 'projects.yaml');

const args = process.argv.slice(2);
const command = args[0];

function ensureHome() {
  if (!fs.existsSync(TBC_HOME)) {
    fs.mkdirSync(TBC_HOME, { recursive: true });
  }
  if (!fs.existsSync(path.join(TBC_HOME, 'logs'))) {
    fs.mkdirSync(path.join(TBC_HOME, 'logs'), { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_PATH)) {
    const defaultConfig = `# TheBotCompany - Project Registry
# Each project runs independently with its own cycle timer

projects:
  # Example:
  # m2sim:
  #   path: ~/dev/src/github.com/sarchlab/m2sim
  #   enabled: true
`;
    fs.writeFileSync(PROJECTS_PATH, defaultConfig);
  }
}

function loadProjectsYaml() {
  if (!fs.existsSync(PROJECTS_PATH)) return { projects: {} };
  const raw = fs.readFileSync(PROJECTS_PATH, 'utf-8');
  return yaml.load(raw) || { projects: {} };
}

function saveProjectsYaml(config) {
  fs.writeFileSync(PROJECTS_PATH, yaml.dump(config, { lineWidth: -1 }));
}

async function main() {
  switch (command) {
    case 'init':
      ensureHome();
      console.log(`Initialized ${TBC_HOME}`);
      console.log(`  projects.yaml: ${PROJECTS_PATH}`);
      console.log(`  logs: ${path.join(TBC_HOME, 'logs')}`);
      break;

    case 'start':
      ensureHome();
      console.log('Starting TheBotCompany...');
      spawn('node', [path.join(__dirname, '..', 'src', 'server.js')], {
        stdio: 'inherit',
        detached: false
      });
      break;

    case 'status':
      try {
        const res = await fetch('http://localhost:3100/api/status');
        const data = await res.json();
        console.log(`TheBotCompany - ${data.projectCount} projects`);
        console.log(`Uptime: ${Math.floor(data.uptime / 60)}m ${data.uptime % 60}s\n`);
        for (const p of data.projects) {
          const status = p.paused ? '⏸️ paused' : p.sleeping ? '💤 sleeping' : p.currentAgent ? `▶️ ${p.currentAgent}` : '⏹️ stopped';
          console.log(`  ${p.id}: ${status} (cycle ${p.cycleCount})`);
        }
      } catch {
        console.log('TheBotCompany is not running');
      }
      break;

    case 'projects':
      ensureHome();
      const config = loadProjectsYaml();
      const projects = config.projects || {};
      if (Object.keys(projects).length === 0) {
        console.log('No projects configured.');
        console.log(`Add one with: tbc add <id> <path>`);
      } else {
        console.log('Configured projects:\n');
        for (const [id, cfg] of Object.entries(projects)) {
          const enabled = cfg.enabled !== false ? '✓' : '✗';
          console.log(`  ${enabled} ${id}: ${cfg.path}`);
        }
      }
      console.log(`\nConfig: ${PROJECTS_PATH}`);
      break;

    case 'add':
      ensureHome();
      const addId = args[1];
      let addPath = args[2];
      if (!addId || !addPath) {
        console.log('Usage: tbc add <id> <path>');
        console.log('Example: tbc add m2sim ~/dev/src/github.com/sarchlab/m2sim');
        process.exit(1);
      }
      // Resolve path
      if (addPath.startsWith('~')) {
        addPath = addPath.replace(/^~/, process.env.HOME);
      }
      addPath = path.resolve(addPath);
      // Check if agent/ folder exists
      const agentDir = path.join(addPath, 'agent');
      if (!fs.existsSync(agentDir)) {
        console.log(`Warning: ${agentDir} does not exist`);
        console.log('Projects need an agent/ folder with config.yaml and managers/workers');
      }
      {
        const cfg = loadProjectsYaml();
        if (!cfg.projects) cfg.projects = {};
        cfg.projects[addId] = { path: addPath, enabled: true };
        saveProjectsYaml(cfg);
        console.log(`Added project: ${addId} -> ${addPath}`);
        console.log('Run `tbc start` or POST /api/reload to pick up changes');
      }
      break;

    case 'remove':
      ensureHome();
      const removeId = args[1];
      if (!removeId) {
        console.log('Usage: tbc remove <id>');
        process.exit(1);
      }
      {
        const cfg = loadProjectsYaml();
        if (cfg.projects && cfg.projects[removeId]) {
          delete cfg.projects[removeId];
          saveProjectsYaml(cfg);
          console.log(`Removed project: ${removeId}`);
        } else {
          console.log(`Project not found: ${removeId}`);
        }
      }
      break;

    default:
      console.log(`TheBotCompany - Multi-project AI Agent Orchestrator

Usage:
  tbc init               Initialize ~/.thebotcompany
  tbc start              Start the orchestrator service
  tbc status             Show running status
  tbc projects           List configured projects
  tbc add <id> <path>    Add a project
  tbc remove <id>        Remove a project

Config: ${PROJECTS_PATH}
`);
  }
}

main();
