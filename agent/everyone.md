# Everyone — Shared Rules

## Core Goal

**Complete the project with passing standard quality, with minimum human involvement.** Work autonomously. Make decisions. Solve problems.

## Your Task

1. **Review your own open issues.** Check whether they have already been resolved or are no longer relevant, and close them when appropriate.
2. **Do the work assigned to you.** Follow the responsibilities in your own skill file and prompt.
3. **Stay engaged on issues you are involved in.** If you check status, comment. If you make progress, comment. If you have questions, comment.
4. **Raise new issues when needed.** If you suspect a problem, create an issue.

## Shared Knowledge

- There is a private shared knowledge base under `knowledge/`.
- Read `knowledge/spec.md` and `knowledge/roadmap.md` before major work when they exist.
- Treat `folder_structure.md` as authoritative for project layout.
- Worker skill files live under `{project_dir}/skills/workers/`.

## Communication

**Use `tbc-db` for all task tracking and communication.** See `db.md` for the full CLI reference.

**Use GitHub only for:**
- Commits (prefix with `[AgentName] message`)
- Branch names (`agentname/description`)

**Do NOT use GitHub Issues for agent communication** — use `tbc-db issue-create` instead. GitHub Issues are reserved for human escalation only.

**Use TBC PRs, not GitHub PRs.** See `db.md` for `tbc-db pr-create` / `tbc-db pr-edit`.

**To send a message to another agent, create an issue assigned to them.** For example, if Ares needs something from Athena, Ares creates a tbc-db issue and assigns it to Athena. This is the only way to communicate between agents.

## Your Workspace

Each agent has a personal notes area at `{project_dir}/agents/{your_name}/`. Create it if it doesn't exist.

At the end of each cycle, write a brief `note.md` with context for your next cycle.

## Time Management

You have a **strict time limit** per cycle (often 1 hour or less). If you get killed by timeout, all unsaved work is lost.

- **Commit early, commit often.** Don't wait until you're "done" — commit after each meaningful change. Partial progress > no progress.
- **Never run long subprocesses directly.** Builds, test suites, simulations — anything that might take >5 minutes should go through GitHub Actions, not direct execution.
- **Set timeouts on all commands.** Use `timeout 300 make build` or equivalent. Never run an unbounded command.
- **If you need to run tests**, run a small subset or a single test file — not the full suite.
- **Push your branch frequently** so work survives even if you're killed.

## Tips

- **Be concise** — get things done.
- **Pull before working.**
- **See something, say something** — if you find a problem, raise an issue.
- **Clean up.** Organize files, remove obsolete files, close issues.
- **Follow the skill rules, not conventions.**
