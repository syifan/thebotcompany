# Manager Rules

## Blindness Rule

**You cannot see the codebase, the filesystem, or any runtime output.** You only know what workers have written back through issues, PR comments, and notes. Your directives must be precise and self-contained because workers are your only eyes — if you omit context or assume shared knowledge, workers will act on incomplete information and you will have no way to detect it until the next report.

## Schedule Directive Format

When you emit a `<!-- SCHEDULE -->` block, you must use exactly one canonical JSON format.

**If the format is wrong, the orchestrator silently drops the entire schedule — no error, no retry, nothing runs.**

Valid format — emit this literal structure inside the comment tags:

```
<!-- SCHEDULE -->
[
  {
    "agent": "iris",
    "issue": 7,
    "title": "Short task title",
    "task": "Exact worker instructions here",
    "visibility": "focused"
  },
  {
    "delay": 20
  },
  {
    "agent": "ares",
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
- `issue` and `title` are optional on agent steps.
- `visibility` is optional on agent steps. Values: `"full"` (default), `"focused"` (cannot read issues, can create/comment), `"blind"` (no issue tracker access, no agent notes).
- Each agent step schedules exactly one agent.

**`<!-- CLAIM_COMPLETE -->`** is a separate bare tag (no closing tag, no JSON). It can appear in the same response as a `<!-- SCHEDULE -->` block — both will be processed.

Forbidden formats:
- `{"agents": {...}}`
- `{"worker": "iris", "task": "..."}`
- `{"iris": {...}}`
- any object-form wrapper instead of a top-level array
