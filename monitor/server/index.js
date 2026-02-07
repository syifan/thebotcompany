import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Agent directory relative to monitor folder
const AGENT_DIR = path.resolve(__dirname, '../..');

app.use(cors());
app.use(express.json());

const ORCHESTRATOR_URL = 'http://localhost:3002';

// Get repo from git remote
function getRepoFromGit() {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: path.resolve(AGENT_DIR, '..'),
      encoding: 'utf-8'
    }).trim();
    // Parse: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match ? match[1] : null;
  } catch (e) {
    console.error('Error getting repo from git:', e.message);
    return null;
  }
}

const REPO = getRepoFromGit();
console.log(`Detected repo: ${REPO}`);

// Proxy orchestrator API
app.get('/api/orchestrator/status', async (req, res) => {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/status`);
    if (response.ok) {
      res.json(await response.json());
    } else {
      res.status(response.status).json({ error: 'Orchestrator error' });
    }
  } catch (e) {
    res.status(503).json({ error: 'Orchestrator offline', offline: true });
  }
});

app.post('/api/orchestrator/:action', async (req, res) => {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/${req.params.action}`, { method: 'POST' });
    if (response.ok) {
      res.json(await response.json());
    } else {
      res.status(response.status).json({ error: 'Orchestrator error' });
    }
  } catch (e) {
    res.status(503).json({ error: 'Orchestrator offline', offline: true });
  }
});

// GET /api/state - Read orchestrator state
app.get('/api/state', (req, res) => {
  try {
    const statePath = path.join(AGENT_DIR, 'state.json');
    if (!fs.existsSync(statePath)) {
      return res.json({ cycleCount: 0, currentAgentIndex: 0 });
    }
    const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/logs - Read last N lines of orchestrator.log
app.get('/api/logs', (req, res) => {
  try {
    const logPath = path.join(AGENT_DIR, 'orchestrator.log');
    const lines = parseInt(req.query.lines) || 50;
    
    if (!fs.existsSync(logPath)) {
      return res.json({ logs: [] });
    }
    
    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n').filter(line => line.trim());
    const lastLines = allLines.slice(-lines);
    
    res.json({ logs: lastLines });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents - List worker and manager agents
app.get('/api/agents', (req, res) => {
  try {
    const workersDir = path.join(AGENT_DIR, 'workers');
    const managersDir = path.join(AGENT_DIR, 'managers');
    const workspaceDir = path.join(AGENT_DIR, 'workspace');
    
    const workers = [];
    const managers = [];
    
    // Parse role from heading like "# Name (Role)"
    const parseRole = (content) => {
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/^#\s*\w+\s*\(([^)]+)\)/);
        if (match) return match[1];
      }
      return null;
    };
    
    // Read worker agents
    if (fs.existsSync(workersDir)) {
      const workerFiles = fs.readdirSync(workersDir).filter(f => f.endsWith('.md'));
      for (const file of workerFiles) {
        const name = file.replace('.md', '');
        const content = fs.readFileSync(path.join(workersDir, file), 'utf-8');
        const role = parseRole(content);
        workers.push({ name, role, file });
      }
    }
    
    // Read manager agents
    if (fs.existsSync(managersDir)) {
      const managerFiles = fs.readdirSync(managersDir).filter(f => f.endsWith('.md'));
      for (const file of managerFiles) {
        const name = file.replace('.md', '');
        const content = fs.readFileSync(path.join(managersDir, file), 'utf-8');
        const role = parseRole(content);
        managers.push({ name, role, file });
      }
    }
    
    res.json({ workers, managers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents/:name - Get agent details
app.get('/api/agents/:name', (req, res) => {
  try {
    const { name } = req.params;
    const workersDir = path.join(AGENT_DIR, 'workers');
    const managersDir = path.join(AGENT_DIR, 'managers');
    const workspaceDir = path.join(AGENT_DIR, 'workspace', name);
    
    let skillPath = path.join(workersDir, `${name}.md`);
    let isManager = false;
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(managersDir, `${name}.md`);
      isManager = true;
    }
    
    if (!fs.existsSync(skillPath)) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const skill = fs.readFileSync(skillPath, 'utf-8');
    
    // Get workspace files
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
    
    res.json({ name, isManager, skill, workspaceFiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/config - Read config.yaml
app.get('/api/config', (req, res) => {
  try {
    const configPath = path.join(AGENT_DIR, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      return res.json({ config: null });
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(content);
    res.json({ config, raw: content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/config - Save config.yaml
app.post('/api/config', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Missing content' });
    }
    // Validate YAML
    yaml.load(content);
    const configPath = path.join(AGENT_DIR, 'config.yaml');
    fs.writeFileSync(configPath, content);
    
    // Commit and push the config change
    const repoDir = path.resolve(AGENT_DIR, '..');
    try {
      execSync('git add agent/config.yaml', { cwd: repoDir, encoding: 'utf-8' });
      execSync('git commit -m "[Monitor] Update config.yaml"', { cwd: repoDir, encoding: 'utf-8' });
      execSync('git push', { cwd: repoDir, encoding: 'utf-8' });
    } catch (gitErr) {
      // If commit fails (e.g., no changes), that's okay
      console.log('Git commit/push:', gitErr.message);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: `Invalid YAML: ${error.message}` });
  }
});

// GET /api/comments - Fetch GitHub issue comments
app.get('/api/comments', async (req, res) => {
  try {
    const configPath = path.join(AGENT_DIR, 'config.yaml');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(configContent);
    const issueNumber = config.trackerIssue || 1;
    
    const { author, page = 1, per_page = 20 } = req.query;
    
    // Use gh CLI to fetch comments
    const { execSync } = await import('child_process');
    
    let cmd = `gh api repos/${REPO}/issues/${issueNumber}/comments --paginate -q '.[] | {id, author: .user.login, body, created_at, updated_at}'`;
    
    const output = execSync(cmd, { 
      cwd: path.resolve(AGENT_DIR, '..'),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024 
    });
    
    // Parse JSONL output and extract agent name from first line
    let comments = output.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const comment = JSON.parse(line);
        // Extract agent name from first line like "# [AgentName]" or "## [AgentName]"
        const agentMatch = comment.body.match(/^#{1,2}\s*\[([^\]]+)\]\s*\n*/);
        if (agentMatch) {
          comment.agent = agentMatch[1];
          comment.body = comment.body.slice(agentMatch[0].length).trim();
        } else {
          comment.agent = comment.author; // fallback to GitHub author
        }
        return comment;
      })
      .reverse(); // Most recent first
    
    // Filter by agent if specified
    if (author) {
      comments = comments.filter(c => 
        c.agent.toLowerCase() === author.toLowerCase()
      );
    }
    
    // Pagination
    const startIdx = (parseInt(page) - 1) * parseInt(per_page);
    const paginatedComments = comments.slice(startIdx, startIdx + parseInt(per_page));
    
    res.json({ 
      comments: paginatedComments,
      total: comments.length,
      page: parseInt(page),
      per_page: parseInt(per_page),
      hasMore: startIdx + parseInt(per_page) < comments.length
    });
  } catch (error) {
    console.error('Error fetching comments:', error.message);
    res.status(500).json({ error: error.message, comments: [] });
  }
});

// GET /api/prs - List open PRs
app.get('/api/prs', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const output = execSync('gh pr list --state open --json number,title,createdAt,headRefName --limit 50', {
      cwd: path.resolve(AGENT_DIR, '..'),
      encoding: 'utf-8',
      timeout: 30000
    });
    // Parse author from title format: [AgentName] Description
    const prs = JSON.parse(output).map(pr => {
      const match = pr.title.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (match) {
        return { ...pr, agent: match[1], shortTitle: match[2] };
      }
      return { ...pr, agent: null, shortTitle: pr.title };
    });
    res.json({ prs });
  } catch (e) {
    console.error('Error fetching PRs:', e.message);
    res.json({ prs: [] });
  }
});

// GET /api/issues - List open issues
app.get('/api/issues', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const output = execSync('gh issue list --state open --json number,title,createdAt,labels --limit 50', {
      cwd: path.resolve(AGENT_DIR, '..'),
      encoding: 'utf-8',
      timeout: 30000
    });
    // Parse creator and assignee from title format: [Creator] -> [Assignee] Description
    const issues = JSON.parse(output).map(issue => {
      const match = issue.title.match(/^\[([^\]]+)\]\s*->\s*\[([^\]]+)\]\s*(.*)$/);
      if (match) {
        return { ...issue, creator: match[1], assignee: match[2], shortTitle: match[3] };
      }
      return { ...issue, creator: null, assignee: null, shortTitle: issue.title };
    });
    res.json({ issues });
  } catch (e) {
    console.error('Error fetching issues:', e.message);
    res.json({ issues: [] });
  }
});

// POST /api/issues/create - Create issue via Claude Code
app.post('/api/issues/create', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Missing issue description' });
    }
    
    const { execSync } = await import('child_process');
    const repoDir = path.resolve(AGENT_DIR, '..');
    
    // Get model from config
    const configPath = path.join(AGENT_DIR, 'config.yaml');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(configContent);
    const model = config.model || 'claude-sonnet-4-20250514';
    
    // Use Claude Code to refine and create the issue
    const prompt = `You are helping create a GitHub issue. The user provided this description:

"${text}"

SAFETY: First verify you are in the correct repo (${REPO}) by checking the remote URL. If not, abort.

Create a well-formatted GitHub issue with:
1. Title format: [Human] -> [Assignee] Description
   - If the user mentions a specific agent to assign, use that agent name
   - If no assignee is clear from the description, assign to Athena
2. A detailed description with context in the body

Use the gh CLI to create the issue. Run:
gh issue create --title "[Human] -> [Assignee] ..." --body "..."

The body should be markdown formatted. Add a "human-request" label.
Do not ask questions, just create the issue based on the description provided.`;

    execSync(`claude --model ${model} --dangerously-skip-permissions --print "${prompt.replace(/"/g, '\\"')}"`, {
      cwd: repoDir,
      encoding: 'utf-8',
      timeout: 120000
    });
    
    res.json({ success: true });
  } catch (e) {
    console.error('Error creating issue:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/repo - Get GitHub repo URL
app.get('/api/repo', (req, res) => {
  res.json({ 
    repo: REPO, 
    url: REPO ? `https://github.com/${REPO}` : null 
  });
});

// POST /api/bootstrap - Run bootstrap script
app.post('/api/bootstrap', async (req, res) => {
  try {
    const bootstrapPath = path.join(AGENT_DIR, 'bootstrap.sh');
    if (!fs.existsSync(bootstrapPath)) {
      return res.status(404).json({ error: 'bootstrap.sh not found' });
    }
    
    const output = execSync('bash bootstrap.sh', {
      cwd: AGENT_DIR,
      encoding: 'utf-8',
      timeout: 60000
    });
    
    res.json({ success: true, output });
  } catch (e) {
    console.error('Bootstrap error:', e.message);
    res.status(500).json({ error: e.message, output: e.stdout || '' });
  }
});

app.listen(PORT, () => {
  console.log(`Monitor API server running on http://localhost:${PORT}`);
});
