#!/usr/bin/env node
/**
 * TheBotCompany - Multi-project AI Agent Orchestrator
 * 
 * Central service that manages multiple repo-based agent projects.
 * Includes API server, monitor endpoints, and static file serving.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TBC_HOME = process.env.TBC_HOME || path.join(process.env.HOME, '.thebotcompany');
const MONITOR_DIST = path.join(ROOT, 'monitor', 'dist');

// --- Configuration ---
const PORT = process.env.TBC_PORT || 3100;
const SERVE_STATIC = process.env.TBC_SERVE_STATIC !== 'false';

// Ensure TBC_HOME exists
if (!fs.existsSync(TBC_HOME)) {
  fs.mkdirSync(TBC_HOME, { recursive: true });
}
if (!fs.existsSync(path.join(TBC_HOME, 'logs'))) {
  fs.mkdirSync(path.join(TBC_HOME, 'logs'), { recursive: true });
}

// --- State ---
const projects = new Map(); // projectId -> ProjectRunner
const startTime = Date.now();

// --- Logging ---
function log(msg, projectId = null) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = projectId ? `[${projectId}]` : '[tbc]';
  console.log(`${ts} ${prefix} ${msg}`);
}

// --- GitHub URL Parser ---
function parseGithubUrl(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\s.]+)/);
  if (!match) return null;
  const [, username, reponame] = match;
  const id = `${username}/${reponame}`;
  const projectDir = path.join(TBC_HOME, 'dev', 'src', 'github.com', username, reponame);
  const repoDir = path.join(projectDir, 'repo');
  const cloneUrl = `https://github.com/${username}/${reponame}.git`;
  return { id, username, reponame, projectDir, repoDir, cloneUrl };
}

// --- MIME Types ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

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
    this._repo = null;
  }

  get agentDir() {
    const repo = this.repo;
    if (repo) {
      return path.join(TBC_HOME, 'dev', 'src', 'github.com', ...repo.split('/'), 'workspace');
    }
    // Fallback for non-GitHub repos
    return path.join(TBC_HOME, 'local', this.id, 'workspace');
  }

  get repo() {
    if (this._repo === null) {
      try {
        const remoteUrl = execSync('git remote get-url origin', {
          cwd: this.path,
          encoding: 'utf-8'
        }).trim();
        const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
        this._repo = match ? match[1] : null;
      } catch {
        this._repo = null;
      }
    }
    return this._repo;
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

  saveConfig(content) {
    const configPath = path.join(this.agentDir, 'config.yaml');
    fs.mkdirSync(this.agentDir, { recursive: true });
    yaml.load(content); // Validate YAML
    fs.writeFileSync(configPath, content);
  }

  loadAgents() {
    const managers = [];
    const workers = [];
    
    const managersDir = path.join(this.agentDir, 'managers');
    const workersDir = path.join(this.agentDir, 'workers');
    
    const parseRole = (content) => {
      const match = content.match(/^#\s*\w+\s*\(([^)]+)\)/);
      return match ? match[1] : null;
    };
    
    if (fs.existsSync(managersDir)) {
      for (const file of fs.readdirSync(managersDir)) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
          managers.push({ name, role: parseRole(content), isManager: true });
        }
      }
    }
    
    if (fs.existsSync(workersDir)) {
      for (const file of fs.readdirSync(workersDir)) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
          workers.push({ name, role: parseRole(content), isManager: false });
        }
      }
    }
    
    return { managers, workers };
  }

  getAgentDetails(agentName) {
    const workersDir = path.join(this.agentDir, 'workers');
    const managersDir = path.join(this.agentDir, 'managers');
    const workspaceDir = path.join(this.agentDir, 'workspace', agentName);
    
    let skillPath = path.join(workersDir, `${agentName}.md`);
    let isManager = false;
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(managersDir, `${agentName}.md`);
      isManager = true;
    }
    
    if (!fs.existsSync(skillPath)) {
      return null;
    }
    
    const skill = fs.readFileSync(skillPath, 'utf-8');
    
    let workspaceFiles = [];
    if (fs.existsSync(workspaceDir)) {
      workspaceFiles = fs.readdirSync(workspaceDir).map(f => {
        const filePath = path.join(workspaceDir, f);
        const stat = fs.statSync(filePath);
        return {
          name: f,
          size: stat.size,
          modified: stat.mtime,
          content: stat.size < 50000 ? fs.readFileSync(filePath, 'utf-8') : null
        };
      });
    }
    
    return { name: agentName, isManager, skill, workspaceFiles };
  }

  getLogs(lines = 50) {
    const logPath = path.join(this.agentDir, 'orchestrator.log');
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).slice(-lines);
  }

  async getComments(author, page = 1, perPage = 20) {
    const config = this.loadConfig();
    const issueNumber = config.trackerIssue || 1;
    if (!this.repo) return { comments: [], total: 0 };
    
    try {
      const output = execSync(
        `gh api repos/${this.repo}/issues/${issueNumber}/comments --paginate -q '.[] | {id, author: .user.login, body, created_at, updated_at}'`,
        { cwd: this.path, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
      
      let comments = output.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
          const comment = JSON.parse(line);
          const agentMatch = comment.body.match(/^#{1,2}\s*\[([^\]]+)\]\s*\n*/);
          if (agentMatch) {
            comment.agent = agentMatch[1];
            comment.body = comment.body.slice(agentMatch[0].length).trim();
          } else {
            comment.agent = comment.author;
          }
          return comment;
        })
        .reverse();
      
      if (author) {
        comments = comments.filter(c => c.agent.toLowerCase() === author.toLowerCase());
      }
      
      const startIdx = (page - 1) * perPage;
      return {
        comments: comments.slice(startIdx, startIdx + perPage),
        total: comments.length,
        page,
        perPage,
        hasMore: startIdx + perPage < comments.length
      };
    } catch (e) {
      return { comments: [], total: 0, error: e.message };
    }
  }

  async getPRs() {
    if (!this.repo) return [];
    try {
      const output = execSync(
        'gh pr list --state open --json number,title,createdAt,headRefName --limit 50',
        { cwd: this.path, encoding: 'utf-8', timeout: 30000 }
      );
      return JSON.parse(output).map(pr => {
        const match = pr.title.match(/^\[([^\]]+)\]\s*(.*)$/);
        return match 
          ? { ...pr, agent: match[1], shortTitle: match[2] }
          : { ...pr, agent: null, shortTitle: pr.title };
      });
    } catch {
      return [];
    }
  }

  async getIssues() {
    if (!this.repo) return [];
    try {
      const output = execSync(
        'gh issue list --state open --json number,title,createdAt,labels --limit 50',
        { cwd: this.path, encoding: 'utf-8', timeout: 30000 }
      );
      return JSON.parse(output).map(issue => {
        const match = issue.title.match(/^\[([^\]]+)\]\s*->\s*\[([^\]]+)\]\s*(.*)$/);
        return match
          ? { ...issue, creator: match[1], assignee: match[2], shortTitle: match[3] }
          : { ...issue, creator: null, assignee: null, shortTitle: issue.title };
      });
    } catch {
      return [];
    }
  }

  getStatus() {
    return {
      id: this.id,
      path: this.path,
      repo: this.repo,
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
    // Ensure project directory exists in TBC_HOME
    fs.mkdirSync(this.agentDir, { recursive: true });
    this.running = true;
    log(`Starting project runner (data: ${this.agentDir})`, this.id);
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
      while (this.isPaused && this.running) {
        await sleep(1000);
      }
      if (!this.running) break;

      const config = this.loadConfig();
      const { managers, workers } = this.loadAgents();
      const allAgents = [...managers, ...workers];

      this.cycleCount++;
      log(`===== CYCLE ${this.cycleCount} (${workers.length} workers) =====`, this.id);

      for (const agent of allAgents) {
        if (!this.running) break;
        while (this.isPaused && this.running) {
          await sleep(1000);
        }
        await this.runAgent(agent, config);
      }

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

    // Ensure workspace directory exists for this agent
    const workspaceDir = path.join(this.agentDir, 'workspace', agent.name);
    fs.mkdirSync(workspaceDir, { recursive: true });

    return new Promise((resolve) => {
      // Replace {project_dir} placeholder with actual path
      let skillContent = fs.readFileSync(skillPath, 'utf-8');
      skillContent = skillContent.replaceAll('{project_dir}', this.agentDir);

      const args = [
        '-p', skillContent,
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
  const projectsPath = path.join(TBC_HOME, 'projects.yaml');
  try {
    if (!fs.existsSync(projectsPath)) {
      const defaultConfig = `# TheBotCompany - Project Registry
projects:
  # Example:
  # m2sim:
  #   path: ~/dev/src/github.com/sarchlab/m2sim
  #   enabled: true
`;
      fs.writeFileSync(projectsPath, defaultConfig);
      log(`Created ${projectsPath}`);
      return {};
    }
    const raw = fs.readFileSync(projectsPath, 'utf-8');
    const config = yaml.load(raw) || {};
    return config.projects || {};
  } catch (e) {
    log(`Failed to load projects.yaml: ${e.message}`);
    return {};
  }
}

function syncProjects() {
  const config = loadProjects();
  
  for (const [id, cfg] of Object.entries(config)) {
    if (!projects.has(id)) {
      const runner = new ProjectRunner(id, cfg);
      projects.set(id, runner);
      if (runner.enabled) {
        runner.start();
      }
    }
  }
  
  for (const [id, runner] of projects) {
    if (!(id in config)) {
      runner.stop();
      projects.delete(id);
    }
  }
}

// --- Static File Serving ---
function serveStatic(req, res, urlPath) {
  let filePath = path.join(MONITOR_DIST, urlPath === '/' ? 'index.html' : urlPath);
  
  // SPA fallback
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    filePath = path.join(MONITOR_DIST, 'index.html');
  }
  
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

// --- HTTP API ---
const server = http.createServer(async (req, res) => {
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

  // --- Global API ---
  
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      projectCount: projects.size,
      projects: Array.from(projects.values()).map(p => p.getStatus())
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      projects: Array.from(projects.values()).map(p => p.getStatus())
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reload') {
    syncProjects();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projectCount: projects.size }));
    return;
  }

  // POST /api/projects/clone - Clone a GitHub repo and check for spec.md
  if (req.method === 'POST' && url.pathname === '/api/projects/clone') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: repoUrl } = JSON.parse(body);
        if (!repoUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url' }));
          return;
        }

        const parsed = parseGithubUrl(repoUrl);
        if (!parsed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid GitHub URL. Expected format: https://github.com/username/reponame' }));
          return;
        }

        if (projects.has(parsed.id)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Project "${parsed.id}" is already registered` }));
          return;
        }

        fs.mkdirSync(parsed.projectDir, { recursive: true });

        if (fs.existsSync(path.join(parsed.repoDir, '.git'))) {
          try {
            execSync('git pull', { cwd: parsed.repoDir, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
            log(`Pulled latest for ${parsed.id}`);
          } catch (e) {
            log(`Git pull failed for ${parsed.id}: ${e.message}`);
          }
        } else {
          try {
            execSync(`git clone ${parsed.cloneUrl} repo`, {
              cwd: parsed.projectDir,
              encoding: 'utf-8',
              timeout: 120000,
              stdio: 'pipe'
            });
            log(`Cloned ${parsed.id}`);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Failed to clone repository: ${e.message}` }));
            return;
          }
        }

        const specPath = path.join(parsed.repoDir, 'spec.md');
        const hasSpec = fs.existsSync(specPath);
        let specContent = null;
        if (hasSpec) {
          specContent = fs.readFileSync(specPath, 'utf-8');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          id: parsed.id,
          path: parsed.repoDir,
          hasSpec,
          specContent,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/projects/add - Add a new project
  if (req.method === 'POST' && url.pathname === '/api/projects/add') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id, path: projectPath, spec } = JSON.parse(body);
        if (!id || !projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing id or path' }));
          return;
        }

        const resolvedPath = projectPath.replace(/^~/, process.env.HOME);

        // Write spec.md if spec data provided
        if (spec && (spec.whatToBuild || spec.successCriteria)) {
          const specPath = path.join(resolvedPath, 'spec.md');
          const specContent = `# Project Specification\n\n## What do you want to build?\n\n${spec.whatToBuild || ''}\n\n## How do you consider the project is success?\n\n${spec.successCriteria || ''}\n`;
          fs.writeFileSync(specPath, specContent);
          try {
            execSync('git add spec.md && git commit -m "[TBC] Add project specification" && git push', {
              cwd: resolvedPath, encoding: 'utf-8', stdio: 'pipe'
            });
          } catch {} // Best effort
        }

        const projectsPath = path.join(TBC_HOME, 'projects.yaml');
        const raw = fs.readFileSync(projectsPath, 'utf-8');
        const config = yaml.load(raw) || {};
        if (!config.projects) config.projects = {};

        config.projects[id] = { path: resolvedPath, enabled: true };

        fs.writeFileSync(projectsPath, yaml.dump(config, { lineWidth: -1 }));
        syncProjects();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id, path: resolvedPath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /api/projects/:owner/:repo - Remove a project
  if (req.method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2] && pathParts[3]) {
    const projectId = `${pathParts[2]}/${pathParts[3]}`;
    try {
      const projectsPath = path.join(TBC_HOME, 'projects.yaml');
      const raw = fs.readFileSync(projectsPath, 'utf-8');
      const config = yaml.load(raw) || {};
      
      if (config.projects && config.projects[projectId]) {
        // Stop the runner if running
        const runner = projects.get(projectId);
        if (runner) runner.stop();
        projects.delete(projectId);
        
        delete config.projects[projectId];
        fs.writeFileSync(projectsPath, yaml.dump(config, { lineWidth: -1 }));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: projectId }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Project not found' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Project-scoped API ---
  // Project IDs are owner/repo (two path segments)

  if (pathParts[0] === 'api' && pathParts[1] === 'projects' && pathParts[2] && pathParts[3]) {
    const projectId = `${pathParts[2]}/${pathParts[3]}`;
    const runner = projects.get(projectId);

    if (!runner) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    const subPath = pathParts.slice(4).join('/');

    // GET /api/projects/:id/status
    if (req.method === 'GET' && subPath === 'status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runner.getStatus()));
      return;
    }

    // GET /api/projects/:id/logs
    if (req.method === 'GET' && subPath === 'logs') {
      const lines = parseInt(url.searchParams.get('lines')) || 50;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: runner.getLogs(lines) }));
      return;
    }

    // GET /api/projects/:id/agents
    if (req.method === 'GET' && subPath === 'agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runner.loadAgents()));
      return;
    }

    // GET /api/projects/:owner/:repo/agents/:name
    if (req.method === 'GET' && pathParts[4] === 'agents' && pathParts[5]) {
      const agentName = pathParts[5];
      const details = runner.getAgentDetails(agentName);
      if (!details) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(details));
      return;
    }

    // GET /api/projects/:id/config
    if (req.method === 'GET' && subPath === 'config') {
      const configPath = path.join(runner.agentDir, 'config.yaml');
      const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ config: runner.loadConfig(), raw }));
      return;
    }

    // POST /api/projects/:id/config
    if (req.method === 'POST' && subPath === 'config') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { content } = JSON.parse(body);
          runner.saveConfig(content);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/projects/:id/comments
    if (req.method === 'GET' && subPath === 'comments') {
      const author = url.searchParams.get('author');
      const page = parseInt(url.searchParams.get('page')) || 1;
      const perPage = parseInt(url.searchParams.get('per_page')) || 20;
      const result = await runner.getComments(author, page, perPage);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/projects/:id/prs
    if (req.method === 'GET' && subPath === 'prs') {
      const prs = await runner.getPRs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prs }));
      return;
    }

    // GET /api/projects/:id/issues
    if (req.method === 'GET' && subPath === 'issues') {
      const issues = await runner.getIssues();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issues }));
      return;
    }

    // GET /api/projects/:id/repo
    if (req.method === 'GET' && subPath === 'repo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        repo: runner.repo, 
        url: runner.repo ? `https://github.com/${runner.repo}` : null 
      }));
      return;
    }

    // POST /api/projects/:id/:action (pause, resume, skip, start, stop)
    if (req.method === 'POST' && ['pause', 'resume', 'skip', 'start', 'stop'].includes(subPath)) {
      switch (subPath) {
        case 'pause': runner.pause(); break;
        case 'resume': runner.resume(); break;
        case 'skip': runner.skip(); break;
        case 'start': runner.start(); break;
        case 'stop': runner.stop(); break;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, action: subPath, projectId }));
      return;
    }
  }

  // --- Static Files ---
  if (SERVE_STATIC && fs.existsSync(MONITOR_DIST)) {
    serveStatic(req, res, url.pathname);
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
  log(`Server listening on http://localhost:${PORT}`);
  if (SERVE_STATIC && fs.existsSync(MONITOR_DIST)) {
    log(`Serving monitor from ${MONITOR_DIST}`);
  }
});

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
