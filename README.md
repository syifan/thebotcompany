# TheBotCompany

Multi-project AI agent orchestrator. Run autonomous AI agent teams across multiple GitHub repositories from a single service with a unified dashboard.

TheBotCompany manages teams of AI coding agents (powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code)) that collaborate on software projects — planning, discussing, researching, and executing code changes through GitHub issues and PRs.

## Features

- **Multi-project** — Manage multiple repos from one central orchestrator
- **Hermes-driven scheduling** — An AI project manager (Hermes) decides which agents run each cycle and in what mode
- **4 work modes** — `discuss`, `research`, `plan`, `execute` — agents are assigned modes per cycle
- **Issue lock system** — Each agent locks one issue at a time, following a plan→execute lifecycle
- **Manager hierarchy** — Hermes (PM), Athena (Strategist), Apollo (HR) oversee workers
- **Budget controls** — 24-hour rolling budget limiter with per-agent cost tracking
- **Unified dashboard** — Monitor all projects, agents, issues, and PRs in one place (mobile-friendly, dark mode)
- **Hot reload** — Add/remove projects, change config without restart

## Prerequisites

- **Node.js** ≥ 20
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** (`claude`) — installed and authenticated
- **[GitHub CLI](https://cli.github.com/)** (`gh`) — installed and authenticated
- A GitHub repository with an agent directory set up (see [Project Setup](#project-setup))

## Quick Start

```bash
# Install globally
npm install -g thebotcompany

# Initialize config directory
tbc init

# Add a project (point to a repo with an agent/ directory)
tbc add myproject ~/path/to/my/repo

# Start the orchestrator (background, logs to file)
tbc start

# Or run in dev mode (foreground, with dashboard HMR)
tbc dev
```

Open the dashboard at **http://localhost:3100** (production) or **http://localhost:5173** (dev mode).

## CLI Reference

```bash
tbc init                    # Initialize ~/.thebotcompany/
tbc start                   # Start orchestrator (background)
tbc stop                    # Stop orchestrator
tbc dev                     # Start in dev mode (foreground + Vite HMR)
tbc status                  # Show running status
tbc logs                    # Tail orchestrator logs
tbc projects                # List configured projects
tbc add <id> <path>         # Add a project
tbc remove <id>             # Remove a project
```

## Architecture

```
TheBotCompany
├── Orchestrator (Node.js server on port 3100)
│   ├── Per-project run loops (independent cycle timers)
│   ├── REST API for dashboard + control
│   └── Static file server (production dashboard)
├── Dashboard (React + Tailwind)
│   ├── Project overview with agent cards
│   ├── GitHub issues/PRs integration
│   ├── Cost tracking & budget controls
│   └── Agent response viewer
└── Agent Skill Files (per-project)
    ├── everyone.md        — Shared rules for all agents
    ├── managers/          — Hermes, Athena, Apollo
    └── workers/           — Project-specific coding agents
```

### How a Cycle Works

1. **Hermes runs first** — Reads agent states, issue locks, and project context
2. **Hermes outputs a schedule** — JSON block specifying which agents run and in what mode
3. **Orchestrator parses the schedule** — Spawns each scheduled agent with mode context injected
4. **Agents execute** — Each agent works within their assigned mode constraints
5. **Results posted** — Agent responses are posted to the GitHub tracker issue
6. **Sleep** — Wait for the configured interval before next cycle

### Managers

| Manager | Role | Description |
|---------|------|-------------|
| **Hermes** | Project Manager | Schedules agents, assigns modes, merges PRs, maintains tracker |
| **Athena** | Strategist | High-level project direction, architecture decisions |
| **Apollo** | HR | Fine-tunes agent skill files, disables underperforming agents |

Managers are shared across all projects. Per-project overrides (model, enabled/disabled) are configured in each project's `config.yaml`.

### Work Modes

| Mode | Allowed Actions | Prohibited |
|------|----------------|------------|
| `discuss` | Read issues/PRs, comment, participate in conversations | Code changes |
| `research` | Web search, run experiments via CI, gather information | Code changes |
| `plan` | Decide approach, write plans, update issue descriptions | Code changes |
| `execute` | Write code, create PRs, implement features/fixes | — |

## Project Setup

Each managed repository needs an `agent/` directory:

```
my-repo/
├── agent/
│   ├── everyone.md          # Shared rules (modes, response format, timeouts)
│   ├── managers/            # Manager skill files (copied from TheBotCompany)
│   │   ├── hermes.md
│   │   ├── athena.md
│   │   └── apollo.md
│   └── workers/             # Your project-specific agents
│       ├── alice.md         # e.g., frontend specialist
│       └── bob.md           # e.g., backend specialist
├── SPEC.md                  # Project specification (agents reference this)
└── ...
```

### Agent Skill Files

Worker skill files use YAML frontmatter for configuration:

```markdown
---
model: claude-sonnet-4-20250514
role: Backend Engineer
disabled: false
---
# AgentName

Description of what this agent does and what it's good at.

## Skills
- List of capabilities
- Technologies known
```

### Per-Project Configuration

Each project gets a `config.yaml` in its workspace (`~/.thebotcompany/<project-path>/workspace/config.yaml`):

```yaml
cycleIntervalMs: 1800000      # 30 min between cycles
agentTimeoutMs: 900000         # 15 min max per agent
model: claude-sonnet-4-20250514  # Default model for agents
trackerIssue: 1                # GitHub issue number used as task board
budgetPer24h: 40               # Max spend per 24h rolling window (USD)

# Per-project manager overrides
managers:
  hermes:
    model: claude-sonnet-4-20250514
  athena:
    disabled: true    # Skip strategist for this project
```

## Configuration

Global config and per-project data live in `~/.thebotcompany/`:

```
~/.thebotcompany/
├── projects.yaml              # Project registry
├── logs/                      # Aggregated logs
└── <org>/<repo>/
    └── workspace/
        ├── config.yaml        # Project configuration
        ├── state.json         # Cycle state (restart resilience)
        ├── cost.csv           # Per-agent cost tracking
        ├── workers/           # Worker note files
        │   └── <agent>/
        │       └── note.md    # Agent memory + issue lock
        └── responses/         # Agent response logs
```

### projects.yaml

```yaml
projects:
  m2sim:
    path: ~/dev/src/github.com/sarchlab/m2sim
    enabled: true
  ml-perf-survey:
    path: ~/dev/src/github.com/syifan/ml-perf-survey
    enabled: true
```

## API

All endpoints are served from the orchestrator on port 3100.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Global orchestrator status |
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/:id/status` | Project status + schedule |
| `GET` | `/api/projects/:id/agents` | Agent list with roles/models |
| `GET` | `/api/projects/:id/agents/:name` | Agent details + last response |
| `GET` | `/api/projects/:id/issues` | GitHub issues |
| `GET` | `/api/projects/:id/prs` | GitHub PRs |
| `POST` | `/api/projects/:id/pause` | Pause project |
| `POST` | `/api/projects/:id/resume` | Resume project |
| `POST` | `/api/projects/:id/skip` | Skip current agent/sleep |
| `POST` | `/api/projects/:id/issues` | Create issue (via AI) |
| `PATCH` | `/api/projects/:id/config` | Update project config |
| `PATCH` | `/api/projects/:id/agents/:name` | Update agent settings |
| `POST` | `/api/reload` | Reload projects.yaml |

## Cost Tracking

TheBotCompany tracks per-agent costs using Claude CLI usage output:

- **Sonnet**: $3 / $15 / $0.30 per MTok (input / output / cache)
- **Opus**: $15 / $75 / $1.50 per MTok
- **Haiku**: $0.80 / $4 / $0.08 per MTok

A 24-hour rolling budget limiter with EMA-based prediction prevents overspend. Configure `budgetPer24h` in each project's `config.yaml`.

## Development

```bash
# Clone the repo
git clone https://github.com/syifan/thebotcompany.git
cd thebotcompany

# Install dependencies
npm install
cd monitor && npm install && cd ..

# Run in dev mode (server + Vite HMR)
tbc dev

# Or run components separately
node src/server.js          # Server only
cd monitor && npm run dev   # Dashboard only
```

## License

[MIT](LICENSE)
