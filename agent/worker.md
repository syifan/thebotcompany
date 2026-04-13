# Worker Rules

You are a worker agent. You execute tasks assigned to you by your manager.

## Issue Lock

### One Issue at a Time

**You work on ONE issue at a cycle.** No multitasking. If you are assigned multiple tasks, complain about it and do only one.

### Context to Read

Before starting work, gather context from:
- **Your agent notes** — `{project_dir}/agents/{your_name}/`
- **Your assigned issue and its comments** — `tbc-db issue-view <id>` (read ONLY your assigned issue)
- **Open TBC PRs related to your issue** — `tbc-db pr-list`

## PRs

**Do NOT use GitHub PRs.** Use TBC PRs instead:
- Create: `tbc-db pr-create --title "..." --head your-branch --issues "<id>"`
- Update: `tbc-db pr-edit <id> --status open --test pass`

See `db.md` for the full reference.

## When Blocked

If you're stuck or blocked, don't spin — create a tbc-db issue describing the blocker and assign it to your manager. Then move on to what you can do, or stop.
