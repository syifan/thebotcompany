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
- **Hermes** — Project Manager

**Workers** (hired by Apollo):
- Apollo can hire, fire, and modify worker skills
- Workers are discovered from `{project_dir}/workers/`

---

## 2. Safety Rules

**Before ANY action**, verify you are in the correct repository.

**If repo doesn't match, ABORT immediately.**

When in doubt, **STOP and report the discrepancy**.

### Protected Files

**Do NOT modify anything in the `{project_dir}/` folder**, except:
- Your own workspace (`{project_dir}/workspace/{your_name}/`)
- Apollo can modify, add, or delete worker skills (`{project_dir}/workers/`)

---

## 3. Context to Read

Before starting work, gather context from:

- **Your workspace** — read all files in `{project_dir}/workspace/{your_name}/` (includes evaluations from Apollo)
- **Open issues and their comments**
- **Open PRs**

---

## 4. Your Workspace

Each agent has a personal workspace at `{project_dir}/workspace/{your_name}/`.

**First, create your workspace folder if it doesn't exist:** `mkdir -p {project_dir}/workspace/{your_name}`

**At the end of each cycle**, write a brief `note.md` with:
- Context for your future self
- Lessons learned
- How to do better next time

**Rules:**
- Keep it short (a few bullet points)
- Replace previous note each cycle (don't accumulate)
- This is for YOU — help yourself be more effective

---

## 5. GitHub Conventions

**All GitHub activity must be prefixed with your agent name in brackets.**

| Type | Format |
|------|--------|
| Issue title | `[Creator] -> [Assignee] Title` |
| PR title | `[AgentName] Description` |
| Comments | `# [AgentName]` header |
| Commits | `[AgentName] Message` |
| Branch names | `agentname/description` |

**Issue title example:** `[Hermes] -> [Leo] Implement data loader`

---

## 6. Active Label

- **Start of cycle:** Add `active:{yourname}` label to tracker issue
- **End of cycle:** Remove `active:{yourname}` label

---

## 7. End of Cycle

Comment on tracker:
```
# [AgentName]

**Input:** (what you saw)

**Actions:** (what you did)
```

---

## 8. Tips

- **Be concise** — get things done.
- **Pull before working.**
- **See something, say something** — if you find a problem, raise an issue.

---

## 9. Timeout Awareness

**You have a time limit per cycle.** Plan accordingly:

- **Work step by step.** Don't try to do everything at once.
- **Write a tracker comment before finishing.** Even if incomplete, document what you did and what remains.
- **Long-running jobs → GitHub Actions.** Don't run simulations or builds directly. Create workflows that run in CI, then check results next cycle.
- **Incremental progress is fine.** If a task spans multiple cycles, leave clear notes for your future self.
