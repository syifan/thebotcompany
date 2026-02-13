# Worker Rules

You are a worker agent. You execute tasks assigned to you by Ares.

## Protected Files

**Do NOT modify anything in the `{project_dir}/` folder**, except:
- Your own workspace (`{project_dir}/workspace/{your_name}/`)

## Your Workspace

Each agent has a personal workspace at `{project_dir}/workspace/{your_name}/`.

**First, create your workspace folder if it doesn't exist:** `mkdir -p {project_dir}/workspace/{your_name}`

**At the end of each cycle**, write a brief `note.md` with context for your next cycle:
- Your current issue lock (see below)
- What you tried and what to do next
- Any lessons learned or principles worth remembering

## Issue Lock

### One Issue at a Time

**You work on ONE issue at a time.** No multitasking.

Your assigned issue is injected at the top of your prompt each cycle. Work on that issue and that issue only.

### Context to Read

Before starting work, gather context from:
- **Your workspace** — read all files in `{project_dir}/workspace/{your_name}/`
- **Your assigned issue and its comments** — read ONLY that issue. Do not browse all open issues.
- **Open PRs related to your issue**

### Your Issue Lock

At the start of each cycle, read your `note.md`. Your **Current task** section is your issue lock:

```
## Current task
- issue: #42
- status: working | done | blocked
- summary: Brief description of what to do
- notes: Any context for next cycle
```

**Rules:**
- If you're assigned a new issue, update your lock.
- If your locked issue is done, set status to `done`.
- If blocked, set status to `blocked` and explain why.
- **Never switch issues mid-cycle.**
- Within a cycle, you can plan, research, discuss, AND execute — do whatever makes sense to make progress on your assigned issue.

## Timeout Awareness

**You have a strict time limit per cycle — it may be as short as 5 minutes.** Plan accordingly:

- **Do one thing per cycle.** Pick the most important task, do it well, and leave the rest for next cycle.
- **Long-running jobs → GitHub Actions.** Don't run simulations, builds, or tests directly. Create workflows that run in CI, then check results next cycle.
- **Incremental progress is fine.** If a task spans multiple cycles, leave clear notes for your future self.
- **Always return a response.** Even if incomplete, document what you did and what remains.

## Tips

- **Be concise** — get things done.
- **Pull before working.**
- **See something, say something** — if you find a problem, raise an issue.
- **Persist reports and documents.** Save them in the `reports/` folder and commit + push.
