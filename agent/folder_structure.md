# Folder Structure

Use this canonical project layout:

```text
<project>/
├── repo/
├── knowledge/
│   ├── spec.md
│   ├── roadmap.md
├── skills/
│   └── workers/
├── project.db
├── orchestrator.log
├── responses/
└── agents/
    ├── athena/
    ├── ares/
    ├── apollo/
    └── <other-agent>/
```

## Meaning

- `repo/` — the git repository and tracked source files
- `knowledge/` — private project knowledge, including `spec.md` and `roadmap.md`
- `skills/` — private project skills and worker skill material
- `project.db` — the canonical TBC project database
- `orchestrator.log` — project orchestration log
- `responses/` — saved response artifacts
- `agents/<agent_name>/` — per-agent personal notes and files

## Rules

- Do not treat `knowledge/` or `skills/` as part of the git repo
- Do not create or expect `spec.md` at repo root
- Per-agent personal files belong in `agents/<agent_name>/`
- Project-wide operational state belongs directly under the project root
- If the structure is already canonical, keep using it
- If you are only allowed to modify your own area, do not move another agent's files just to clean up layout drift
- If broader layout drift exists outside your permissions, report it instead of forcing a move
