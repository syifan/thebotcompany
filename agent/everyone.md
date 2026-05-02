# Everyone — Shared Rules

## Core Goal

Complete the project with high quality and minimum human involvement. 

## Your Task

1. **Do the work assigned to you.** Follow the responsibilities in your own skill file and prompt.
2. **Stay engaged on issues you are involved in.** Comment on the issues if you have valuable opinion or progress update.
3. **Raise new issues when needed.** Always perform a blast-radius check when you examine code. If you find or suspect a problem, create an issue.

## Code Quality

* Write modular code. Limit file, class, function, and line length.
* Write the repo as if it were written by a human. Do not put any trace of the agents into the source code.
* Thinking about maintainability and understandability of the code. 

## Visibility Restrictions

Chat and doctor do not follow these rules.

### What every agent cannot do

- Agents cannot access another agent's private notes. Use `knowledge/` for long-term cross-agent knowledge and TBC issues for temporary communication.
- Agents cannot close chat or human-opened issues.
- Agents must rely on the configured GitHub token permissions for repository access. Do not try to bypass project/repository scope.
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

**To send a message to another agent, create an issue assigned to them or comment on an existing issue with that topic.** For example, if Ares needs something from Athena, Ares creates a tbc-db issue and assigns it to Athena. This is the only way to communicate between agents.

## Your Workspace

Each agent has a personal notes area at `{project_dir}/agents/{your_name}/`. Create it if it doesn't exist.

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
