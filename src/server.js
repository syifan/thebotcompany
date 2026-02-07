#!/usr/bin/env node
/**
 * TheBotCompany - Multi-project AI Agent Orchestrator
 * 
 * Central service that manages multiple repo-based agent projects.
 * Each project runs independently with its own cycle timer.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// --- Configuration ---
const PORT = process.env.TBC_PORT || 3100;

// --- State ---
const projects = new Map(); // projectId -> ProjectRunner
const startTime = Date.now();

// --- Logging ---
function log(msg, projectId = null) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = projectId ? `[${projectId}]` : '[tbc]';
  console.log(`${ts} ${prefix} ${msg}`);
}

// --- Project Runner ---
class ProjectRunner {
  constructor(id, config) {
    this.id = id;
    this.path = config.path.replace(/^~/, process.env.HOME);
    this.enabled = config.enabled !== false;
    this.cycleCount = 0;
    this.currentAgent = null;
    this.currentAgentProcess = null;
    this.currentAgentStartTime = null;
    this.isPaused = false;
    this.sleepUntil = null;
    this.wakeNow = false;
    this.running = false;
  }

  get agentDir() {
    return path.join(this.path, 'agent');
  }

  loadConfig() {
    try {
      const configPath = path.join(this.agentDir, 'config.yaml');
      const raw = fs.readFileSync(configPath, 'utf-8');
      return yaml.load(raw) || {};
    } catch (e) {
      return { cycleIntervalMs: 1800000, agentTimeoutMs: 900000, model: 'claude-sonnet-4-20250514' };
    }
  }

  loadAgents() {
    const managers = [];
    const workers = [];
    
    const managersDir = path.join(this.agentDir, 'managers');
    const workersDir = path.join(this.agentDir, 'workers');
    
    if (fs.existsSync(managersDir)) {
      for (const file of fs.readdirSync(managersDir)) {
        if (file.endsWith('.md')) {
          managers.push({ name: file.replace('.md', ''), isManager: true });
        }
      }
    }
    
    if (fs.existsSync(workersDir)) {
      for (const file of fs.readdirSync(workersDir)) {
        if (file.endsWith('.md')) {
          workers.push({ name: file.replace('.md', ''), isManager: false });
        }
      }
    }
    
    return { managers, workers };
  }

  getStatus() {
    return {
      id: this.id,
      path: this.path,
      enabled: this.enabled,
      running: this.running,
      paused: this.isPaused,
      cycleCount: this.cycleCount,
      currentAgent: this.currentAgent,
      currentAgentRuntime: this.currentAgentStartTime 
        ? Math.floor((Date.now() - this.currentAgentStartTime) / 1000) 
        : null,
      sleeping: this.sleepUntil !== null,
      sleepUntil: this.sleepUntil,
      config: this.loadConfig(),
      agents: this.loadAgents()
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    log(`Starting project runner`, this.id);
    this.runLoop();
  }

  stop() {
    this.running = false;
    if (this.currentAgentProcess) {
      this.currentAgentProcess.kill('SIGTERM');
    }
    log(`Stopped project runner`, this.id);
  }

  pause() {
    this.isPaused = true;
    log(`Paused`, this.id);
  }

  resume() {
    this.isPaused = false;
    this.wakeNow = true;
    log(`Resumed`, this.id);
  }

  skip() {
    if (this.currentAgentProcess) {
      log(`Skipping current agent`, this.id);
      this.currentAgentProcess.kill('SIGTERM');
    } else if (this.sleepUntil) {
      log(`Skipping sleep`, this.id);
      this.wakeNow = true;
    }
  }

  async runLoop() {
    while (this.running) {
      // Wait while paused
      while (this.isPaused && this.running) {
        await sleep(1000);
      }
      if (!this.running) break;

      const config = this.loadConfig();
      const { managers, workers } = this.loadAgents();
      const allAgents = [...managers, ...workers];

      this.cycleCount++;
      log(`===== CYCLE ${this.cycleCount} (${workers.length} workers) =====`, this.id);

      // Run all agents
      for (const agent of allAgents) {
        if (!this.running) break;
        while (this.isPaused && this.running) {
          await sleep(1000);
        }
        await this.runAgent(agent, config);
      }

      // Sleep between cycles
      if (config.cycleIntervalMs > 0 && this.running) {
        log(`Sleeping ${config.cycleIntervalMs / 1000}s...`, this.id);
        this.wakeNow = false;
        this.sleepUntil = Date.now() + config.cycleIntervalMs;
        
        let sleptMs = 0;
        while (sleptMs < config.cycleIntervalMs && !this.wakeNow && this.running) {
          await sleep(5000);
          sleptMs += 5000;
          while (this.isPaused && !this.wakeNow && this.running) {
            await sleep(1000);
          }
        }
        this.sleepUntil = null;
      }
    }
  }

  async runAgent(agent, config) {
    this.currentAgent = agent.name;
    this.currentAgentStartTime = Date.now();
    log(`Running: ${agent.name}${agent.isManager ? ' (manager)' : ''}`, this.id);

    const skillPath = path.join(
      this.agentDir,
      agent.isManager ? 'managers' : 'workers',
      `${agent.name}.md`
    );

    return new Promise((resolve) => {
      const args = [
        '-p', fs.readFileSync(skillPath, 'utf-8'),
        '--model', config.model || 'claude-sonnet-4-20250514',
        '--dangerously-skip-permissions',
        '--output-format', 'json'
      ];

      this.currentAgentProcess = spawn('claude', args, {
        cwd: this.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }
      });

      let stdout = '';
      this.currentAgentProcess.stdout.on('data', (d) => stdout += d);
      this.currentAgentProcess.stderr.on('data', (d) => stdout += d);

      const timeout = config.agentTimeoutMs > 0 
        ? setTimeout(() => {
            log(`⏰ Timeout, killing ${agent.name}`, this.id);
            this.currentAgentProcess.kill('SIGTERM');
          }, config.agentTimeoutMs)
        : null;

      this.currentAgentProcess.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        
        // Parse token usage from JSON output
        let tokenInfo = '';
        try {
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.startsWith('{')) {
              const data = JSON.parse(line);
              if (data.type === 'result' && data.usage) {
                const u = data.usage;
                const cost = ((u.input_tokens * 15) + (u.output_tokens * 75) + (u.cache_read_input_tokens * 1.5)) / 1_000_000;
                tokenInfo = ` | tokens: in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens} | cost: $${cost.toFixed(4)}`;
              }
            }
          }
        } catch {}

        log(`${agent.name} done (code ${code})${tokenInfo}`, this.id);
        this.currentAgent = null;
        this.currentAgentProcess = null;
        this.currentAgentStartTime = null;
        resolve();
      });
    });
  }
}

// --- Load Projects ---
function loadProjects() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'projects.yaml'), 'utf-8');
    const config = yaml.load(raw) || {};
    return config.projects || {};
  } catch (e) {
    log(`Failed to load projects.yaml: ${e.message}`);
    return {};
  }
}

function syncProjects() {
  const config = loadProjects();
  
  // Add new projects
  for (const [id, cfg] of Object.entries(config)) {
    if (!projects.has(id)) {
      const runner = new ProjectRunner(id, cfg);
      projects.set(id, runner);
      if (runner.enabled) {
        runner.start();
      }
    }
  }
  
  // Remove deleted projects
  for (const [id, runner] of projects) {
    if (!(id in config)) {
      runner.stop();
      projects.delete(id);
    }
  }
}

// --- HTTP API ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/status - Global status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      projectCount: projects.size,
      projects: Array.from(projects.values()).map(p => p.getStatus())
    }));
    return;
  }

  // GET /api/projects - List all projects
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      projects: Array.from(projects.values()).map(p => p.getStatus())
    }));
    return;
  }

  // GET /api/projects/:id/status - Project status
  if (req.method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[3] === 'status') {
    const projectId = pathParts[2];
    const runner = projects.get(projectId);
    if (!runner) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(runner.getStatus()));
    return;
  }

  // POST /api/projects/:id/:action - Control project
  if (req.method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts.length === 4) {
    const projectId = pathParts[2];
    const action = pathParts[3];
    const runner = projects.get(projectId);
    
    if (!runner) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    switch (action) {
      case 'pause':
        runner.pause();
        break;
      case 'resume':
        runner.resume();
        break;
      case 'skip':
        runner.skip();
        break;
      case 'start':
        runner.start();
        break;
      case 'stop':
        runner.stop();
        break;
      default:
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action' }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, action, projectId }));
    return;
  }

  // POST /api/reload - Reload projects.yaml
  if (req.method === 'POST' && url.pathname === '/api/reload') {
    syncProjects();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projectCount: projects.size }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Helpers ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main ---
log('TheBotCompany starting...');
syncProjects();
server.listen(PORT, () => {
  log(`API listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  for (const runner of projects.values()) {
    runner.stop();
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('Shutting down...');
  for (const runner of projects.values()) {
    runner.stop();
  }
  process.exit(0);
});
