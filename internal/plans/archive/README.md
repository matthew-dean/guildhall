# Archived Planning Documents

These documents are retained as historical design and implementation records.
They are **not active instructions** and should not be resumed as standalone
plans.

The active source of truth is:

- [`2026-07-14-project-state-architecture-pivot.md`](../2026-07-14-project-state-architecture-pivot.md)

The active pivot consolidates the old project spine, map/structure, release,
task hierarchy, execution-state, storage, and Git Story/Closure work into one
project-state model. Consult an archived document only to recover prior
decisions, implementation evidence, or migration history. When an archived
document conflicts with the active pivot, the pivot wins.

The active folders are intentionally smaller than the archive. A document
belongs here when it has a current owner and a live implementation or research
job. Completed, explicitly deferred, superseded, or release-era planning
documents belong in this archive even when they still contain useful code
examples. Do not treat a file's presence under `internal/` as evidence that it
is current.

## Archived Sets

- **Orientation and structure:** project orientation/proof paths, intake
  structure simplification, the project-orientation spine, and the old
  Structure/project-graph UI spec.
- **Scopes and releases:** unified releases and release-scope projection.
- **Execution and task state:** task decomposition and task-schema/runtime
  evidence split, plus the superseded state-machine/project-graph model.
- **Import and re-intake:** the earlier evidence-to-work-graph intake and
  project re-intake implementation plans, including the superseded
  `structural-domain-intelligence` and `re-intake-project` specs.
- **Storage and architecture:** architecture replacement and project-state
  storage governance.
- **Git Story and Closure:** the earlier Git Story/Closure product model.
- **Completed and deferred lanes:** old flow follow-ups, trust/completeness,
  release-hardening, memory, contract-governance, and deferred external-agent
  plans whose useful evidence is retained but whose planning instructions are
  no longer current.

The remaining dated release plans for 0.8 through 0.11 are archived under this
same boundary. Their names and dates are historical identifiers, not signals
that those releases or plans are currently active.

Additional structural specs live under [`specs/`](specs/): flexible work
hierarchy, delivery spine, logical work and delivery steps, iterative work
campaigns, and first-class child-work planning. They are retained for
implementation history only; the active pivot is the sole source of truth for
how those concerns relate.
