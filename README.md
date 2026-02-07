# TheBotCompany

Multi-project AI agent orchestrator. Run autonomous AI agent teams across multiple repositories from a single service.

## Features

- **Multi-project**: Manage multiple repos from one central service
- **Independent cycles**: Each project runs on its own timer
- **Parallel execution**: Agents from different projects can run simultaneously
- **Hot reload**: Add/remove projects without restart
- **Unified dashboard**: Monitor all projects in one place

## Quick Start

```bash
# Install globally
npm install -g .

# Initialize config directory
tbc init

# Add your projects
tbc add m2sim ~/dev/src/github.com/sarchlab/m2sim
tbc add ml-perf-survey ~/dev/src/github.com/syifan/ml-perf-survey

# Start the service
tbc start
```

## Configuration

Config and project data live in `~/.thebotcompany/`:

```
~/.thebotcompany/
├── projects.yaml    # Project registry
├── logs/            # Aggregated logs
└── dev/src/github.com/  # Per-project data (derived from git remote)
    └── <org>/<repo>/
        ├── repo/                # Cloned repository
        └── workspace/           # Agent data
            ├── config.yaml
            ├── managers/
            ├── workers/
            ├── workspace/   # Per-agent workspaces
            └── orchestrator.log
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

### Per-project config.yaml

```yaml
cycleIntervalMs: 1800000    # 30 min between cycles
agentTimeoutMs: 900000      # 15 min max per agent
model: claude-opus-4-6
trackerIssue: 1
```

## CLI

```bash
tbc init               # Initialize ~/.thebotcompany
tbc start              # Start the orchestrator service
tbc status             # Show running status
tbc projects           # List configured projects
tbc add <id> <path>    # Add a project
tbc remove <id>        # Remove a project
```

## API

- `GET /api/status` - Global status
- `GET /api/projects` - List all projects
- `GET /api/projects/:id/status` - Project status
- `POST /api/projects/:id/pause` - Pause project
- `POST /api/projects/:id/resume` - Resume project
- `POST /api/projects/:id/skip` - Skip current agent/sleep
- `POST /api/reload` - Reload projects.yaml

## Monitor

The dashboard runs separately:

```bash
cd monitor
npm install
npm run dev
```

Then open http://localhost:5173

## License

MIT
