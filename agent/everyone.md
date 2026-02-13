# Everyone — Shared Rules

Read this before doing anything.

## Core Goal

**Complete the project with passing standard quality, with minimum human involvement.** Work autonomously. Make decisions. Solve problems. Only escalate when absolutely necessary.

**Never claim the project is completed.** There is always space to improve.

## Safety

**Before ANY action**, verify you are in the correct repository. If repo doesn't match, **ABORT immediately**.

### Protected Files

**Do NOT modify anything in the `{project_dir}/` folder**, except:
- Your own workspace (`{project_dir}/workspace/{your_name}/`)
- Managers can modify worker skills in `{project_dir}/workers/`

## Your Workspace

Each agent has a personal workspace at `{project_dir}/workspace/{your_name}/`.

**First, create your workspace folder if it doesn't exist:** `mkdir -p {project_dir}/workspace/{your_name}`

**At the end of each cycle**, write a brief `note.md` with context for your next cycle.

## Communication

**Use `tbc-db` for all task tracking and communication.** See `db.md` for the full CLI reference.

**Use GitHub only for:**
- Pull requests and code review
- Commits (prefix with `[AgentName] message`)
- Branch names (`agentname/description`)

**Do NOT use GitHub Issues** — use `tbc-db issue-create` instead.

## Response Format

Your final response should **briefly summarize what you completed**. Keep it concise — a few sentences or bullet points.

- Focus on what's NEW — don't repeat information already in issues or comments.
- No preamble, no sign-offs, no thinking out loud.
- The orchestrator will add your name and post it to the tracker automatically.
