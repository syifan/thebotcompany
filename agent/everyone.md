# Everyone — Shared Rules

## Core Goal

**Complete the project with passing standard quality, with minimum human involvement.** Work autonomously. Make decisions. Solve problems. 

## Safety

**Before ANY action**, verify you are in the correct repository. If repo doesn't match, **ABORT immediately**.

### Protected Files

**Do NOT modify anything in the `{project_dir}/` folder**, except:
- Your own workspace (`{project_dir}/workspace/{your_name}/`)
- Managers can modify worker skills in `{project_dir}/workers/`

## Your Workspace

Each agent has a personal workspace at `{project_dir}/workspace/{your_name}/`. Create your workspace folder if it doesn't exist

At the end of each cycle, write a brief `note.md` with context for your next cycle.

## Communication

**Use `tbc-db` for all task tracking and communication.** See `db.md` for the full CLI reference.

**Use GitHub only for:**
- Pull requests and code review
- Commits (prefix with `[AgentName] message`)
- Branch names (`agentname/description`)

**Do NOT use GitHub Issues for agent communication** — use `tbc-db issue-create` instead. GitHub Issues are reserved for human escalation only.

**To send a message to another agent, create an issue assigned to them.** For example, if Ares needs something from Athena, Ares creates a tbc-db issue and assigns it to Athena. This is the only way to communicate between agents.

## Time Management

You have a **strict time limit** per cycle (often 1 hour or less). If you get killed by timeout, all unsaved work is lost.

- **Commit early, commit often.** Don't wait until you're "done" — commit after each meaningful change. Partial progress > no progress.
- **Never run long subprocesses directly.** Builds, test suites, simulations — anything that might take >5 minutes should go through GitHub Actions, not direct execution.
- **Set timeouts on all commands.** Use `timeout 300 make build` or equivalent. Never run an unbounded command.
- **If you need to run tests**, run a small subset or a single test file — not the full suite.
- **Push your branch frequently** so work survives even if you're killed.

## Response Format

Your final response should **briefly summarize what you completed**. Keep it concise — a few sentences or bullet points.

- Focus on what's NEW — don't repeat information already in issues or comments.
- No preamble, no sign-offs, no thinking out loud.
- The orchestrator will add your name and post it to the tracker automatically.

## Tips

- **Be concise** — get things done.
- **Pull before working.**
- **See something, say something** — if you find a problem, raise an issue.
- **Clean up.** Organize files, remove obsolete files, close issues.
- **Follow the skill rules, not conventions.**
