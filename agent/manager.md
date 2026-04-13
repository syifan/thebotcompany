# Manager Rules

Worker skill files live under `{project_dir}/skills/workers/`.

## Hiring Workers

Create or edit `.md` files in `{project_dir}/skills/workers/` to hire workers. The worker becomes available on the next schedule.

Each skill file has a YAML frontmatter block followed by a markdown body that becomes the worker's system prompt:

```markdown
---
reports_to: ares
role: Go Engineer
model: mid
---

# Kai — Go Engineer

You are an expert Go engineer working on a GPU simulator codebase.
Your strengths are reading unfamiliar codebases quickly, writing
idiomatic Go, and producing well-tested changes.

Work on the task assigned to you. Follow project conventions.
Commit your changes and push when done.
```

Frontmatter fields:
- `reports_to` — your name (the manager who owns this worker)
- `role` — short human-readable title
- `model` — `low`, `mid`, or `high`

Write the skill body to make the worker maximally effective at the tasks you will assign them. Define their domain expertise, working style, and any standing rules they should follow.

## Schedule Directive Format

When you emit a `<!-- SCHEDULE -->` block, you must use exactly one canonical JSON format.

**If the format is wrong, the orchestrator silently drops the entire schedule — no error, no retry, nothing runs.**

Valid format — emit this literal structure inside the comment tags:

```
<!-- SCHEDULE -->
[
  {
    "agent": "iris",
    "task": "Exact worker instructions here",
    "visibility": "focused"
  },
  {
    "delay": 20
  },
  {
    "agent": "kai",
    "task": "Another worker's instructions"
  }
]
<!-- /SCHEDULE -->
```

Rules:
- The content between `<!-- SCHEDULE -->` and `<!-- /SCHEDULE -->` must be valid JSON.
- The top-level value must be an array.
- Each step must be exactly one of:
  - **Agent step**: must include both `agent` (string) and `task` (string). Missing `task` causes the entire schedule to be rejected.
  - **Delay step**: must have **only** the `delay` key (a number). Extra keys on a delay step cause rejection.
- `visibility` is optional on agent steps. Values: `"full"` (default), `"focused"` (cannot read issues, can create/comment), `"blind"` (no issue tracker access, no agent notes).
- Each agent step schedules exactly one agent.
