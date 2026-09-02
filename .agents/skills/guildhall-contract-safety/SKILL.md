---
name: guildhall-contract-safety
description: Govern Guildhall authoritative contracts, persisted schemas, structured agent results, project-state ownership, and model-independence boundaries. Use before changing task/project/workspace/runtime/delivery/validation schemas, API builders or shared summaries, migrations, agent output parsing, readiness/routing/approval logic, or any code that inspects model prose operationally.
---

# Protect Guildhall Contracts

## Classify before editing

1. Identify the authoritative contract owners, persisted data, readers, writers,
   cached projections, migrations, and user-visible surfaces in scope.
2. Record a `Contract Touch Decision` in the relevant internal spec, plan, or
   review note. Include work id, touched and considered contracts, follow-up,
   proof required/provided, waivers, owner review, and apply/revert behavior.
3. When persisted state changes, also record a `Schema Migration Decision`.
   Include change class, existing-data impact, migration id and ordering,
   compatibility reader, fixtures, tests, owner-facing plan, safety, and
   rollback behavior.

## Preserve one authority

- Put derived summary, readiness, next action, owner input, release/blocker,
  inbox, and task-summary decisions in a shared runtime utility or API builder.
- Cache them with the project snapshot and make every surface render that
  result. Extend the shared model for new presentations; do not rebuild the
  business rule in a view.
- Treat cross-surface disagreement as an ownership or projection defect first.

## Enforce model independence

Never let provider prose decide routing, sizing, decomposition, readiness,
proof, release scope, approval, or completion. If code or tests match model
wording, headings, adjectives, order, or verbosity operationally, stop the
affected loop and replace the matcher with typed fields, stable IDs, enums,
numeric metrics, or evidence references. Fail closed when structured data is
absent; do not keep a prose fallback or fixture exception.

Vary arbitrary provider prose while holding structured data constant in tests.
Exact copy assertions are valid only for system-authored text.

## Validate

Run the focused tests for the owner and every affected reader, then run:

- `pnpm lint:contracts` for contract-owning paths.
- `pnpm model:independence` for model-facing changes.
- `pnpm typecheck` and relevant persistence/migration fixtures for schema work.

Treat a model-independence failure as a replace-the-contract condition, not a
prompt-tuning task. Do not claim completion while a required decision or proof
record is missing.
