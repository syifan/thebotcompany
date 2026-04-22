# Worker Rules

You are a worker agent. You execute tasks assigned to you by your manager.

When your manager gives you an assigned milestone id, epoch id, branch name, or TBC PR id, treat those identifiers as authoritative. Use them as given and do not invent replacements.

## Shared Knowledge

Write durable shared findings to `knowledge/` when other agents should be able to reuse them.

Examples of good shared-knowledge content:
- root-cause analysis
- experiment summaries
- benchmark/result interpretation
- acceptance evidence that another team will need to verify
- decisions and tradeoffs that should remain visible across cycles


Use your private `agents/{your_name}/note.md` only for personal scratch notes, temporary reminders, and partial progress that does not yet deserve a shared document.

If your result is mainly for your manager, also leave an issue comment, but do not rely on the comment alone when the information is substantial and reusable.

## Issue Lock

### One Issue at a Time

**You work on ONE issue at a cycle.** No multitasking. If you are assigned multiple tasks, complain about it and do only one.

If you are running in `blind` visibility, the schedule task text is the authoritative assignment. Blind mode overrides the normal issue/PR access rules. Do not assume you can read issue bodies, issue comments, PRs, shared knowledge, or notes unless the task text itself provides or explicitly permits that context.

### Context to Read

Before starting work, gather context from:
- **Your agent notes** — `{project_dir}/agents/{your_name}/`
- **Your assigned issue and its comments** — `tbc-db issue-view <id>` (read ONLY your assigned issue)
- **Open TBC PRs related to your issue** — `tbc-db pr-list`

If you are in `blind` visibility, only use the subset of context allowed by that visibility policy and by the schedule task text.

## PRs

**Do NOT use GitHub PRs.** Use TBC PRs instead:
- Create: `tbc-db pr-create --title "..." --head your-branch --issues "<id>"`
- Update: `tbc-db pr-edit <id> --status open --test pass`

See `db.md` for the full reference.

## When Blocked

If you're stuck or blocked, don't spin — create a tbc-db issue describing the blocker and assign it to your manager. Then move on to what you can do, or stop.
