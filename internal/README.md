# Internal planning

This directory is for Guildhall planning material that should not be published
on the public docs site.

Use this directory for:

- future-release specs and implementation plans;
- private product strategy;
- commercially sensitive notes;
- agent-facing operating instructions;
- raw research and design exploration that has not been sanitized for readers.
- source-backed research notes that support internal plans, specs, audits, and
  design notes.

## Documentation generation boundary

The authored documentation source is the root `docs/` content used for the
next development version. `docs/versions/<version>/` is a one-time snapshot
created by the release publisher from that release's source state; it is not a
second working copy and must not be refreshed by the normal docs build.
`scripts/prepare-versioned-docs.mjs` only creates the ignored `docs/current/`
and `docs/next/` projections from the frozen release snapshot and canonical
development docs. Use `scripts/version-docs.mjs --from-ref <commit-or-tag>`
only for an explicit historical snapshot repair, with `--force` as a visible
exception rather than an ordinary synchronization step.

If a note belongs in public docs, move or rewrite it deliberately under
`docs/`. Do not assume a planning note is publishable just because it is
written in Markdown.

The active product pivot is
`internal/plans/2026-07-14-project-state-architecture-pivot.md`. It supersedes
the older orientation, map, structural-domain, release, re-intake,
task-shaping, execution-history, and closure plans rather than adding another
parallel planning vocabulary. The
historical material remains available under `internal/plans/archive/`, with
the archive policy and index in `internal/plans/archive/README.md`.

Only plans and specs with a current implementation or research owner remain in
the active folders. Completed, deferred, superseded, and release-era planning
material belongs under `internal/plans/archive/`; it is historical evidence,
not a second backlog. Independent active specs remain under `internal/specs/`
and `internal/plans/`; release-era and completed specs live under
`internal/specs/archive/`. All active specs must be interpreted through the project-state
pivot whenever they describe project summaries, releases, task hierarchies,
execution, or user orientation.
Live product/runtime audit checklists live in `internal/audits/`.
Older exploratory design notes live in `internal/design-notes/`.
Superseded architectural notes are explicitly marked under
`internal/design-notes/archive/` and are historical context only.
Source-backed research notes live in `internal/research/`.

## Release state

For whether a version has shipped, prefer release artifacts over inference from
planning trackers:

1. a Git tag such as `v0.8.0`;
2. the public release note under `docs/releases/<version>.md`;
3. the matching versioned docs snapshot under `docs/versions/<version>/`;
4. `package.json` and install docs only as supporting evidence.

Internal MVP trackers describe what a release was trying to ship. After a
release lands, they may retain planning-era notes and should not be treated as
the release-status authority.
