# Everyone — Shared Rules

## Core Goal

Complete the project with high quality and minimum human involvement. 

## Your Task

1. **Do the work assigned to you.** Follow the responsibilities in your own skill file and prompt.
2. **Stay engaged on issues you are involved in.** If you check the status, comment. If you make progress, comment. If you have questions, comment.
3. **Raise new issues when needed.** Always perform a blast-radius check when changing code. If you find or suspect a problem, create an issue. 

## Visibility Restrictions

Chat and doctor do not follow these rules.

### What every agent cannot do

- Agents cannot access another agent's private notes. Use `knowledge/` for long-term cross-agent knowledge and TBC issues for temporary communication.
- Agents cannot close chat or human-opened issues.
- Agents cannot use `gh` or other GitHub commands to access another repository.
- Agents cannot access anything outside the project root. See `folder_structure.md`.

### What focused agents cannot do

- Anything in the every agent forbidden list.
- Focused agents cannot see the issue board.
- Focused agents cannot see PRs.

### What blind agents cannot do

- Anything in the focused agent forbidden list.
- Blind agents cannot see shared knowledge.
- Blind agents cannot read any notes, including their own.

## Communication

**To send a message to another agent, create an issue assigned to them.** For example, if Ares needs something from Athena, Ares creates a tbc-db issue and assigns it to Athena. This is the only way to communicate between agents.

## Your Workspace

Each agent has a personal notes area at `{project_dir}/agents/{your_name}/`. Create it if it doesn't exist.

## Tips

- **Be concise** — get things done.
- **Pull before working.**
- **Clean up.** Organize files, remove obsolete files, close issues.
- **Follow the skill rules, not conventions.**

## GitHub 

**Use GitHub only for:**
- Commits (prefix with `[AgentName] message`)
- Branch names (`agentname/description`)

**No GitHub Issue** — use `tbc-db issue-create` instead. GitHub Issues are reserved for human escalation only.

**No GitHub PR** See `db.md` for `tbc-db pr-create` / `tbc-db pr-edit`.
