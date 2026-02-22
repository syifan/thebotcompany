# TheBotCompany

Human-free software development with self-organizing AI agent teams.

## Features

- **Human-free execution** — Agents plan, discuss, research, and implement autonomously across full development cycles
- **Self-organizing teams** — AI managers (Athena, Ares, Apollo) plan, implement, and verify milestones without human intervention
- **Multi-project** — Manage multiple repos from one central orchestrator with independent cycles
- **Full observability** — Watch agents work through GitHub PRs and issues; every decision, discussion, and code change is visible
- **Async human intervention** — Agents escalate via GitHub issues when they need human input; step in at your convenience
- **Budget controls** — 24-hour rolling budget limiter with per-agent cost tracking
- **Unified dashboard** — Monitor all projects, agents, issues, and PRs in one place (mobile-friendly, dark mode, push notifications)

![TheBotCompany Dashboard](screenshot.png)
*Monitor agents, costs, issues, and reports across all your projects from a single dashboard.*

## Prerequisites

- **Node.js** ≥ 20
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** (`claude`) — installed and authenticated
- **[GitHub CLI](https://cli.github.com/)** (`gh`) — installed and authenticated

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

## Configuration

### Environment Variables

Running `tbc start` or `tbc dev` for the first time will interactively prompt you to set a dashboard password and port. The config is saved to `~/.thebotcompany/.env`.

| Variable | Description |
|----------|-------------|
| `TBC_PASSWORD` | Dashboard authentication password (set during first-run setup) |
| `TBC_PORT` | Server port (default: 5173, set during first-run setup) |
| `ANTHROPIC_AUTH_TOKEN` | Claude Code auth token. Can be set per-project in the dashboard. |

> **Note:** VAPID keys for push notifications are auto-generated on first start. No manual setup needed.

### Project Configuration

Each project has a YAML config at `~/.thebotcompany/dev/<project-path>/workspace/config.yaml`:

```yaml
cycleIntervalMs: 1800000    # Time between cycles (default: 30 min)
agentTimeoutMs: 3600000     # Max time per agent run (default: 1 hour)
model: claude-opus-4-6            # Default model for all agents
trackerIssue: 1             # GitHub issue number for tracking
budgetPer24h: 100           # Max spend per 24h in USD (0 = unlimited)
```

These can also be edited from the dashboard's project settings.

## How It Works

### Three-Phase State Machine

Each project runs through a repeating cycle of three phases:

```
┌──────────┐     milestone      ┌────────────────┐    claim complete    ┌──────────────┐
│  Athena   │ ──────────────►   │ Implementation │ ──────────────────►  │ Verification │
│ (Strategy)│                   │   (Ares)       │                      │   (Apollo)   │
└──────────┘                   └────────────────┘                      └──────────────┘
     ▲                                │                                       │
     │          deadline missed       │            pass ✅ / fail ❌          │
     └────────────────────────────────┴───────────────────────────────────────┘
```

1. **Athena Phase** — Evaluates the project, defines the next milestone with a cycle budget, and optionally schedules research workers for evaluation before committing
2. **Implementation Phase (Ares)** — Ares coordinates workers to implement the milestone. Runs until Ares claims complete or the cycle budget is exhausted
3. **Verification Phase (Apollo)** — Apollo's team independently verifies the milestone. Pass → back to Athena for the next milestone. Fail → back to Ares with fix cycles

### Managers

| Manager | Role | When it runs |
|---------|------|-------------|
| **Athena** | Strategy — defines milestones, maintains roadmap, manages research workers | Start of each milestone cycle |
| **Ares** | Implementation — schedules workers, reviews PRs, coordinates execution | Every cycle during implementation |
| **Apollo** | Verification — independently verifies milestone completion | Every cycle during verification |

### Workers

Workers are project-specific agents defined in the repo's `agent/workers/` directory. Managers hire, schedule, and assign tasks to workers. Each worker has a skill file (markdown with YAML frontmatter) defining their role, model, and who they report to.

### Project Completion

Athena can end a project by outputting a `<!-- PROJECT_COMPLETE -->` tag:

```html
<!-- PROJECT_COMPLETE -->
{"success": true, "message": "All milestones achieved. Project complete."}
<!-- /PROJECT_COMPLETE -->
```

This pauses the project and marks it as complete in the dashboard.

## Project Structure

### Repository Layout

Each managed repo needs an `agent/` directory:

```
your-repo/
├── agent/
│   ├── everyone.md           # Shared rules for all agents
│   ├── manager.md            # Shared rules for managers
│   ├── worker.md             # Shared rules for workers
│   ├── db.md                 # Database (SQLite) usage guide
│   ├── managers/
│   │   ├── athena.md         # Strategy manager skill
│   │   ├── ares.md           # Implementation manager skill
│   │   └── apollo.md         # Verification manager skill
│   └── workers/
│       ├── leo.md            # Example worker
│       └── maya.md           # Example worker
├── spec.md                   # Project specification (created by Athena)
├── roadmap.md                # Project roadmap (maintained by Athena)
└── ...                       # Your actual project files
```

### Worker Skill File Format

```markdown
---
model: claude-opus-4-6
role: Backend Developer
reports_to: ares
---
# Leo

Your instructions here...
```

| Frontmatter | Description |
|-------------|-------------|
| `model` | Model to use (overrides project default) |
| `role` | Short description shown in dashboard |
| `reports_to` | Which manager schedules this worker (`ares`, `athena`, or `apollo`) |

### TheBotCompany Data Directory

```
~/.thebotcompany/
├── .env                      # Environment variables
├── projects.yaml             # Project registry
├── logs/
│   └── server.log            # Orchestrator logs
└── dev/
    └── <project-path>/
        └── workspace/
            ├── config.yaml   # Project config
            ├── state.json    # Orchestrator state
            └── project.db    # SQLite database (issues, reports, comments)
```

## CLI Reference

```bash
tbc init                    # Initialize ~/.thebotcompany/
tbc start                   # Start orchestrator + dashboard (background)
tbc stop                    # Stop orchestrator
tbc dev                     # Start in dev mode (foreground + Vite HMR)
tbc status                  # Show running status
tbc logs                    # Tail orchestrator logs
tbc projects                # List configured projects
tbc add <id> <path>         # Add a project
tbc remove <id>             # Remove a project
```

## Dashboard

The dashboard provides:

- **Project overview** — Status, phase, milestone progress, cycle count
- **Agent reports** — Full history of agent outputs with markdown rendering
- **Issue tracker** — SQLite-backed issues (agents communicate via issues, not GitHub issues for internal coordination)
- **PR monitoring** — Live GitHub PR status
- **Cost tracking** — Per-agent and per-project cost breakdown (last call, average, 24h, total)
- **Controls** — Pause/resume, skip agent, bootstrap, configure settings
- **Notifications** — Browser push notifications for milestones, verifications, and errors
- **Settings** — Theme (light/dark/system), auth token management, notification preferences

### Authentication

The dashboard has read-only mode by default. Enter the `TBC_PASSWORD` via the login button to enable write operations (pause, resume, config changes, etc.).

## Hosting

To expose the dashboard externally (e.g., via Cloudflare Tunnel):

1. Set `TBC_PORT` in `.env` to your desired port
2. Run `tbc start` (serves the built dashboard + API on that port)
3. Point your tunnel to `localhost:<TBC_PORT>`

For development with HMR, use `tbc dev` which runs Vite on port 5173 and proxies API calls to port 3100.

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
node src/server.js                # Server only
cd monitor && npm run dev         # Dashboard only (proxies API to :3100)

# Build dashboard for production
cd monitor && npm run build
```

## License

[MIT](LICENSE)
