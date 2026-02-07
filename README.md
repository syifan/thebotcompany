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
# Install dependencies
npm install

# Configure projects
cp projects.yaml.example projects.yaml
# Edit projects.yaml to add your repos

# Start the service
npm start
```

## Project Structure

Each managed repository should have an `agent/` folder:

```
your-repo/
└── agent/
    ├── config.yaml      # Project-specific config
    ├── managers/        # Manager agent skills
    ├── workers/         # Worker agent skills  
    └── workspace/       # Shared workspace
```

## Configuration

### projects.yaml

```yaml
projects:
  my-project:
    path: ~/dev/my-project
    enabled: true
```

### Per-project config.yaml

```yaml
cycleIntervalMs: 1800000    # 30 min between cycles
agentTimeoutMs: 900000      # 15 min max per agent
model: claude-opus-4-6
trackerIssue: 1
```

## API

- `GET /api/status` - Global status
- `GET /api/projects` - List all projects
- `GET /api/projects/:id/status` - Project status
- `POST /api/projects/:id/pause` - Pause project
- `POST /api/projects/:id/resume` - Resume project
- `POST /api/projects/:id/skip` - Skip current agent/sleep
- `POST /api/reload` - Reload projects.yaml

## License

MIT
