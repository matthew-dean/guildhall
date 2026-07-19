# Guildhall 0.12.0 Release Acceptance Audit

Date: 2026-07-19
Status: ready for publication, not published
Scope: unified project state, bounded projections, release lifecycle, and the
Narrative Harness release-cycle proof

## User job

A user opening Guildhall must be able to answer, without reconstructing state
from several pages or loading every project detail:

- Which release or bounded scope is selected?
- How much of that scope is done, deferred, blocked, or still unfinished?
- What can be done next, and is Start or Resume actually available?
- Does Overview, Map, Work, Activity, Release, Thread, task detail, and CLI
  tell the same story?
- If the release is shipped, does it stay shipped after a read, a restart, or
  a later-scope selection?

The acceptance bar is therefore a shared-state and release-cycle proof, not a
visual snapshot of one route.

## Acceptance evidence

### Installed product and fleet loading

Commands:

```sh
pnpm build
pnpm dev:install
guildhall stop && guildhall start
curl -s http://localhost:7777/api/stale-server
```

The installed bundle reported `stale:false`. The service reported 7 projects,
0 startup refresh errors, and equal boot/current build mtimes. The fleet
projection returned the required projects (`narrative-harness`, `looma-knit`,
`jess`, and `fair-labor-license`) without loading cards in a project-state
loading or error state.

The bounded service audit remains green. Fleet and project responses stay within
the measured response budgets and do not assemble full task, thread, proof,
Git-history, transcript, or debug payloads for the initial card projection.

### Narrative Harness release boundary

Command:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/matthew/Library/Caches/ms-playwright \
  pnpm audit:release-acceptance
```

Result: 42 checks passed; 0 failed.

The selected release is the durable Stage 1 headless drafting and evaluation
release. The same saved boundary is reported as:

| State | Value |
| --- | ---: |
| Included work | 15 |
| Done | 15 |
| Unfinished | 0 |
| Blocked | 0 |
| Proof blocked | 0 |
| Deferred later work | 24 |
| Durable lifecycle | shipped |
| Current readiness | complete / ready |

The distinction matters: `shipped` is the durable release lifecycle, while
`complete` and `ready` describe the current scope's computed readiness. The
24 deferred items do not reopen the shipped release.

### Cross-surface agreement

The acceptance audit reads the authoritative APIs for Overview, Work, Map,
Activity, Spine, Release summary, Release detail, Thread, and included and
deferred task detail. It also invokes:

```sh
node dist/cli.js status narrative-harness --json
```

Every surface agrees on the selected release id, release label, shipped
lifecycle, included/deferred counts, current freshness, and database authority.
The CLI uses the saved release projection directly; it does not reopen task
detail or derive a competing release summary.

The human CLI form is intentionally small and bounded:

```text
Narrative Harness
  Release: Stage 1: Headless Drafting And Evaluation MVP [shipped]
  Progress: 15/15 done / 24 deferred / 0 blocked
  Readiness: ready
  Next: Review completed scope.
```

### Desktop and mobile route proof

The acceptance script uses Playwright against the installed service at both
1440x1000 and 390x844 for:

- `/projects/narrative-harness/overview`
- `/projects/narrative-harness/map`
- `/projects/narrative-harness/work`
- `/projects/narrative-harness/release`

All eight route/viewport checks found the expected primary heading, no
horizontal document overflow, and no element extending beyond the viewport.

### Source and static verification

The isolated source-wide run completed with:

- 381 test files passed, 1 skipped.
- 5,296 tests passed, 3 skipped, and 11 todo.
- No provider credentials or persistent user configuration were used.

The following audits passed:

```text
pnpm audit:project-state-agreement
pnpm audit:project-state-performance
pnpm audit:project-spine
pnpm lint:data-layer
pnpm lint:contracts
pnpm lint:reductions
git diff --check
```

The agreement audit found no cross-project state mismatches. The performance
audit found the bounded fleet, service, Narrative Harness, and Thread response
budgets within limits. The spine audit found Narrative Harness rich-progressed,
with 15 selected items, 24 deferred items, 15 proven items, and no selected
scope gaps or active pins.

### Failure and recovery evidence

The installed release-cycle replay recorded in the preceding flow-audit
sections proves that proof failures can be recovered through the shared release
state, that a worker stop produces a resumable checkpoint, and that a shipped
release survives service restart without reopening. The current acceptance run
replays the settled end state through every read surface and the CLI after the
fresh installed restart. No synthetic read-time release or task records are
used to make the settled result appear complete.

Later-scope activation and explicit close remain separate lifecycle operations:
selecting a scope activates only a planned or deferred release, while selecting
an already shipped release does not reopen it. Explicit Close is the only
operation in this flow that transitions a ready release to shipped.

## Known non-blocking warnings

These are recorded so they cannot be mistaken for hidden success:

- `pnpm lint:design` still reports the repository's pre-existing advisory
  design-token/style baseline. It is not a 0.11 release gate and the exact
  acceptance routes pass geometry and overflow proof.
- `scripts/browser-route-proof.mjs` still contains older generic fixture DOM
  assertions that fail with bridge errors on historical routes. Direct API
  reads are healthy, and the exact Narrative Harness acceptance route proof
  passes at both required viewport sizes. The generic fixture audit is a
  follow-up, not evidence that the accepted product routes fail.
- The release-preparation worktree is now staged at `0.12.0`. This audit does
  not publish to npm, create a tag, or push the release branch.

None of these warnings is a release-blocking contradiction, data-loss risk,
synthetic-state bug, or critical regression in the accepted product flow.

## Contract Touch Decision

- Work id: `release-acceptance-cli-surface-2026-07-19`.
- Touched contracts: the read-only `guildhall status` output, the shared saved
  release-state boundary, and the `audit:release-acceptance` verification
  command.
- Considered but not touched: persisted task/release schemas, transcript and
  process-log retention formats, provider configuration, task mutation
  commands, and web route-specific summary logic.
- Required follow-up: none for the 0.11 publication gate. The design baseline
  and historical generic route fixture audit remain separately tracked.
- Proof required: CLI and web/API surfaces must report one saved release
  identity and one bounded count set.
- Proof provided: the 42-check installed acceptance audit and focused CLI
  tests pass; CLI output matches the database-backed API projection.
- Apply/revert: source-only revert is safe; no persisted state needs rollback.

## Schema Migration Decision

- Persisted schema touched: none by the final acceptance harness or CLI status
  surface.
- Scope/change class: read-only projection and verification tooling.
- Existing data impact: none; the audit reads existing saved release state and
  does not manufacture or rewrite task, release, transcript, or event records.
- Migration id: none required.
- Compatibility reader: none added.
- Fixtures/tests: focused CLI formatting coverage plus the installed
  cross-surface acceptance script.
- Owner-facing plan text: this document is the owner-facing publication gate.
- Rollback/revert: remove the audit script, package entry, and CLI surface;
  no data rollback is required.

## Decision

Guildhall has met the defined product acceptance threshold for publication as
0.12.0. The implementation is release-ready and the Narrative Harness cycle
is proven through a bounded shipped release. The separate publication process
still requires the repository typecheck and dependency-cruise gates to be
resolved and npm credentials to be available. No tag or npm publication is
performed by this audit.

## Publication gate status

The publisher's normal gate is intentionally still authoritative:

- `pnpm typecheck`: passed on the 0.12.0 branch.
- `pnpm lint:deps`: passed with 58 advisory no-orphans warnings and no errors.
- `npm whoami`: blocked by HTTP 401 because npm is not authenticated locally.

The remaining publication prerequisite is npm authentication. This branch has
not published to npm or created a release tag.
