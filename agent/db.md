# Database — Agent Communication

All task tracking and communication happens through `tbc-db`, a CLI tool backed by SQLite. **Do NOT use GitHub Issues for task tracking or communication.** GitHub is only for PRs and code.

All commands are available as `tbc-db <command>` — no setup needed, just run them.

## Quick Reference

### Issues

```bash
# Create an issue
tbc-db issue-create --title "Fix memory leak" --creator ares --assignee leo --body "Details here"

# List open issues
tbc-db issue-list

# List issues assigned to you
tbc-db issue-list --assignee leo

# List closed issues
tbc-db issue-list --status closed

# View an issue with all comments
tbc-db issue-view 42

# Edit an issue
tbc-db issue-edit 42 --title "New title" --body "Updated body"
tbc-db issue-edit 42 --assignee maya

# Close an issue
tbc-db issue-close 42
```

### Comments

```bash
# Add a comment to an issue
tbc-db comment --issue 42 --author leo --body "Fixed in commit abc123"

# List comments on an issue
tbc-db comments 42
```

### TBC PRs

```bash
# Create a local TBC PR record
tbc-db pr-create --title "Fix memory leak" --head leo/fix-memory-leak --summary "Ready for review" --issues "42"

# List active TBC PRs
tbc-db pr-list

# View one TBC PR
tbc-db pr-view 7

# Update a TBC PR record
tbc-db pr-edit 7 --status open --test pass

# Add a comment to a TBC PR
tbc-db pr-comment 7 --author leo --body "Ready for Apollo review"

# List comments on a TBC PR
tbc-db pr-comments 7
```

### Advanced

```bash
# Run a raw SQL query
tbc-db query "SELECT * FROM issues WHERE status = 'open' ORDER BY created_at DESC LIMIT 10"
```

## Rules

- **Always use your agent name** as `--creator` or `--author`
- **One issue per task** — keep issues focused and small
- **Close issues when done** — don't leave stale issues open
- **Comment on progress** — leave notes so other agents (and your future self) know what happened
- **Don't create duplicate issues** — check `issue-list` first

## Schema

| Table | Key Columns |
|-------|-------------|
| `issues` | id, title, body, status (open/closed), creator, assignee, labels, created_at |
| `comments` | id, issue_id, author, body, created_at |
| `agents` | id, name, role, reports_to, model, disabled |
| `milestones` | id, description, cycles_budget, cycles_used, phase, status |
| `tbc_prs` | id, title, summary, base_branch, head_branch, status, issue_ids, test_status |

## Visibility

Your access to the tracker may be restricted by your manager:
- **Full**: You can access everything
- **Focused**: You can only read/write specific allowed issues assigned to you, plus create new issues
- **Blind**: You cannot read the tracker, but you can still create new issues to raise blockers or findings

If you get "Access denied", respect the restriction and work with what you have.

## PR Workflow

- For agent-delivered work, create a **TBC PR** with `tbc-db pr-create` instead of `gh pr create`
- Update the record as work progresses with `tbc-db pr-edit`
- Use `tbc-db pr-comment` for review notes, progress updates, handoffs, and verification feedback on a TBC PR
- Use `pr-list`, `pr-view`, and `pr-comments` to inspect active TBC PRs and their discussion
- GitHub PRs are optional mirrors, not the default workflow
