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

If a note belongs in public docs, move or rewrite it deliberately under
`docs/`. Do not assume a planning note is publishable just because it is
written in Markdown.

The current 0.8.0 MVP tracker is
`internal/plans/2026-05-24-guildhall-0-8-mvp-tracker.md`. Broader 0.8.0
design sources live in `internal/specs/`.
The proposed 0.9.0 task-shaping direction is
`internal/plans/2026-05-24-guildhall-0-9-task-shaping-and-finishability.md`.
The 0.9.0 implementation tracker is
`internal/plans/2026-05-27-guildhall-0-9-implementation-tracker.md`.
The 0.10.0 implementation tracker is
`internal/plans/2026-05-31-guildhall-0-10-implementation-tracker.md`.
The 0.9.0 trust and completeness proposal is
`internal/plans/2026-05-27-guildhall-0-9-trust-and-completeness-proposal.md`.
The late 0.9.0 internal benchmark and Hermes comparison lane is
`internal/plans/2026-05-27-guildhall-0-9-benchmarks-and-hermes-comparison.md`.
The 0.11.0 implementation tracker is
`internal/plans/2026-06-02-guildhall-0-11-implementation-tracker.md`.
The proposed 0.11.0 OpenRouter support plan is
`internal/plans/2026-05-28-guildhall-0-11-openrouter-support.md`.
The proposed 0.11.0 deterministic code-quality signal spec is
`internal/specs/2026-06-03-guildhall-0-11-deterministic-code-quality-signals.md`.
The proposed 0.10.0 external agent memory bridge spec is
`internal/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`.
The proposed 0.10.0 structural/domain intelligence spec is
`internal/specs/2026-05-29-guildhall-0-10-structural-domain-intelligence.md`.
The proposed 0.10.0 external task authority spec is
`internal/specs/2026-05-29-guildhall-0-10-external-task-authority.md`.
The proposed 0.10.0 state-machine substrate and local project graph spec is
`internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`.
Live product/runtime audit checklists live in `internal/audits/`.
Older exploratory design notes live in `internal/design-notes/`.
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
