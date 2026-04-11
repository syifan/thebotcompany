# Folder Structure

Treat the project directory as having four top-level areas:

- `repo/` — the git repository and all tracked source files
- `knowledge/` — private project knowledge, such as `spec.md`, `roadmap.md`, decisions, and analysis
- `skills/` — private project skills and worker skill material
- `workspace/` — operational state and agent scratch space

## Workspace Layout

Inside `workspace/`:

- `project.db` — the canonical TBC project database
- `orchestrator.log` — project orchestration log
- `responses/` — saved response artifacts
- `agents/<agent_name>/` — the personal notes and files for each agent

## Rules

- Do not treat `knowledge/` or `skills/` as part of the git repo
- Do not create or expect `spec.md` at repo root
- Per-agent personal files belong in `workspace/agents/<agent_name>/`
- Project-wide operational state belongs directly under `workspace/`
