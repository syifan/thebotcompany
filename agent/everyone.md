# Everyone — Shared Rules

## Core Goal

**Complete the project with passing standard quality, while keeping the working tree clean, the issue tracker accurate, and the project state durable.**

## Shared Knowledge

- There is a private shared knowledge base under `knowledge/`.
- Read `knowledge/spec.md` and `knowledge/roadmap.md` before major work when they exist.
- Treat `folder_structure.md` as authoritative for project layout.
- Worker skill files live under `{project_dir}/skills/workers/`.

## General Rules

- Prefer changing repo files in `repo/` only when the task is about product code.
- Keep project-private notes, analyses, and planning out of the git repo.
- Use the canonical project database via `tbc-db`; do not bypass it.
- Use TBC PRs, not GitHub PRs.
- Use `tbc-db pr-create` and `tbc-db pr-edit` for PR state changes.
- Keep issue and PR state accurate.
- Leave clear, durable state for the next cycle.
