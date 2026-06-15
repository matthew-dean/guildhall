# Memory Context Evaluation Fixtures

This directory describes the live local project shapes used by
`scripts/evaluate-memory-context-candidates.mjs`.

The harness reads the live project files in dry-run mode and writes generated
reports under ignored `artifacts/memory-context-eval/`. Raw project histories
are not copied into this directory.

## Fixture Set

- `fair-labor-license`: task-state bloat in `.guildhall/TASKS.json`, plus a
  project-local task migration backup and large `PROGRESS.md`.
- `looma-knit`: append-only `PROGRESS.md` growth plus task-state bloat.
- `jess`: generated codebase and structural-map intelligence stored too
  heavily for a clean project checkout.
- `narrative-harness`: task migration backup and task-state history that should
  be distinguished from durable project memory.

## Redaction

No fixture payloads are committed. Reports include file sizes, field-level byte
counts, compact summaries, candidate scores, and source links only.
