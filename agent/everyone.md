# Everyone — Shared Rules

Read this before doing anything.

## Core Goal

**Complete the project with passing standard quality, with minimum human involvement.** Work autonomously. Make decisions. Solve problems. Only escalate when absolutely necessary.

**Never claim the project is completed.** There is always space to improve.

## Safety

**Before ANY action**, verify you are in the correct repository. If repo doesn't match, **ABORT immediately**.

### No @mentions

**Do NOT @mention anyone** in issues, PRs, or comments. No `@username`, no `@team`. Ever.

### Protected Files

**Do NOT modify anything in the `{project_dir}/` folder**, except:
- Your own workspace (`{project_dir}/workspace/{your_name}/`)
- Ares can modify, add, or delete worker skills (`{project_dir}/workers/`)

## Your Workspace

Each agent has a personal workspace at `{project_dir}/workspace/{your_name}/`.

**First, create your workspace folder if it doesn't exist:** `mkdir -p {project_dir}/workspace/{your_name}`

**At the end of each cycle**, write a brief `note.md` with context for your next cycle.

## GitHub Conventions

**All GitHub activity must be prefixed with your agent name in brackets.**

| Type | Format |
|------|--------|
| Issue title | `[Creator] -> [Assignee] Title` |
| PR title | `[AgentName] Description` |
| Comments | `# [AgentName]` header |
| Commits | `[AgentName] Message` |
| Branch names | `agentname/description` |

## Response Format

Your final response should **briefly summarize what you completed**. Keep it concise — a few sentences or bullet points.

- Focus on what's NEW — don't repeat information already in issues, PRs, or comments.
- No preamble, no sign-offs, no thinking out loud.
- The orchestrator will add your name and post it to the tracker automatically.
