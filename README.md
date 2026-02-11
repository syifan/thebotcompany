# TheBotCompany

Human-free software development with self-organizing AI agent teams.

## Features

- **Human-free execution** — Agents plan, discuss, research, and implement autonomously across full development cycles
- **Self-organizing teams** — AI managers (Hermes, Athena, Apollo) hire, evaluate, schedule, and coordinate worker agents without human intervention
- **Multi-project** — Manage multiple repos from one central orchestrator with independent cycles
- **Budget controls** — 24-hour rolling budget limiter with per-agent cost tracking
- **Unified dashboard** — Monitor all projects, agents, issues, and PRs in one place (mobile-friendly, dark mode)

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

## How It Works

TheBotCompany runs in cycles. Each cycle, an AI project manager (**Hermes**) reads the current state of the project — open issues, agent progress, PR status — and decides which agents should run and what they should do.

### Managers

Three AI managers oversee each project:

- **Hermes** (PM) — Schedules agents, assigns work modes, merges PRs, maintains the task tracker
- **Athena** (Strategist) — Sets project direction, manages milestones, creates issues from high-level goals
- **Apollo** (HR) — Evaluates agent performance, tunes skill files, hires/disables agents

Hermes runs every cycle. Athena and Apollo are called in by Hermes when needed.

### Work Modes

Each cycle, agents are assigned one of four modes:

- **discuss** — Participate in issue/PR conversations (no code changes)
- **research** — Gather information, run experiments via CI (no code changes)
- **plan** — Decide approach and write a plan (no code changes)
- **execute** — Write code, create PRs, implement changes

Agents follow a natural lifecycle: plan → research → plan → execute, locking one issue at a time until it's done.

### Project Structure

Each managed repo has an `agent/` directory with skill files defining manager and worker roles. Workers are defined per-project; managers are shared. Configuration (cycle interval, timeout, budget, model) lives in `~/.thebotcompany/` per project.

### Human Escalation

Agents solve most problems autonomously. When something truly needs human input, managers create a GitHub issue prefixed with "HUMAN:" and can pause the project if fully blocked.

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
