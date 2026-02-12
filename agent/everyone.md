# Everyone — Shared Rules for All Agents

Read this file before executing any task.

---

## Core Goal

**Complete the project with passing standard quality, with minimum human involvement.** Work autonomously. Make decisions. Solve problems. Only escalate when absolutely necessary.

**Never claim the project is completed.** There is always space to improve.

---

## 1. Team Structure

**Managers** (permanent, skills never change):
- **Athena** — Strategist
- **Apollo** — HR
- **Hermes** — Scheduler
- **Ares** — Operations Manager

**Workers** (hired by Apollo):
- Apollo can hire, fire, and modify worker skills
- Workers are discovered from `{project_dir}/workers/`

---

## 2. Safety Rules

**Before ANY action**, verify you are in the correct repository.

**If repo doesn't match, ABORT immediately.**

When in doubt, **STOP and report the discrepancy**.

### No @mentions

**Do NOT @mention anyone** in issues, PRs, or comments. No `@username`, no `@team`. Ever.

### Protected Files

**Do NOT modify anything in the `{project_dir}/` folder**, except:
- Your own workspace (`{project_dir}/workspace/{your_name}/`)
- Apollo can modify, add, or delete worker skills (`{project_dir}/workers/`)

---

## 3. Your Workspace

Each agent has a personal workspace at `{project_dir}/workspace/{your_name}/`.

**First, create your workspace folder if it doesn't exist:** `mkdir -p {project_dir}/workspace/{your_name}`

**At the end of each cycle**, write a brief `note.md` with context for your next cycle:
- Your current issue lock (see §6 below)
- What you tried and what to do next
- Any lessons learned or principles worth remembering

Keep it concise and useful for future you.

---

## 4. GitHub Conventions

**All GitHub activity must be prefixed with your agent name in brackets.**

| Type | Format |
|------|--------|
| Issue title | `[Creator] -> [Assignee] Title` |
| PR title | `[AgentName] Description` |
| Comments | `# [AgentName]` header |
| Commits | `[AgentName] Message` |
| Branch names | `agentname/description` |

**Issue title example:** `[Ares] -> [Leo] Implement data loader`

---

## 5. Tips

- **Be concise** — get things done.
- **Pull before working.**
- **See something, say something** — if you find a problem, raise an issue.
- **Persist reports and documents.** If you write a report or document that other agents (or your future self) should see, save it in the `reports/` folder in the repository and commit + push it.

---

## 6. Issue Lock

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

---

## 7. Timeout Awareness

**You have a strict time limit per cycle — it may be as short as 5 minutes.** Plan accordingly:

- **Do one thing per cycle.** Do not try to complete all tasks assigned to you at once. Pick the most important one, do it well, and leave the rest for next cycle.
- **Long-running jobs → GitHub Actions.** Don't run simulations, builds, or tests directly. Create workflows that run in CI, then check results next cycle.
- **Incremental progress is fine.** If a task spans multiple cycles, leave clear notes for your future self.
- **Always return a response.** Even if incomplete, document what you did and what remains in your final response.

---

## 8. Response Format (CRITICAL — READ THIS CAREFULLY)

Your **entire final response** must be **exactly** this format:

```
# [AgentName]

## Input
(brief summary — do NOT repeat information already visible in issues, PRs, comments, or reports)

## Actions
(what you did — focus on NEW information, decisions, and changes only)
```

**RULES:**
- Your response **MUST start with `# [AgentName]`** as the very first line
- **Nothing before it** — no thinking, no analysis, no preamble, no status checks
- **Nothing after Actions** — no sign-offs, no summaries, no next-step suggestions
- The orchestrator posts your **entire response** verbatim to the tracker issue
- Any text outside this format **will appear publicly** as noise
- **Do NOT repeat information** that's already in issues, PRs, comments, or reports. Everyone can read those. Only add NEW insights, decisions, or status changes.

**Think all you want during your cycle. But your final response is ONLY the formatted block above.**
