# Fleet and Service Summary Performance Audit

**Date:** 2026-07-17
**Scope:** `/api/service`, `/api/service/projects`, `/api/fleet/attention`, and the `ProjectsHome` loader.
**Owner:** Fleet/service summary performance

## Result

The Projects shell is now a single fleet request. `ProjectsHome` reads
`/api/service/projects` at `src/web/surfaces/ProjectsHome.svelte:74-109`, uses
the cached response immediately when present, and does not fan out to one
request per project. The focused UI tests cover that contract.

The server is projection-backed and bounded for the service summary. A malformed
saved summary or attention database is now treated as an unavailable or missing
projection by the owning reader, so that failure is local to the affected
project. This does not make synchronous route work concurrent.

## Measurements

The installed service reported `stale:false` before the live probes. The
existing audit, run before the source edits, measured:

- `/api/service/projects`: 22.56 ms, 25,252 bytes, 7 projects.

After the source changes, `pnpm build`, `pnpm dev:install`,
`guildhall stop && guildhall start`, and a second `stale:false` check, the
expanded `scripts/project-state-performance-audit.mjs` measured:

- `/api/service/projects`: 23.18 ms, 24,694 bytes, 7 projects, no loading/errors.
- `/api/service`: 4.68 ms, 24,709 bytes, 7 projects, no loading/errors.
- `/api/service?detail=true`: 74.97 ms, 36,352 bytes, 7 projects, no loading/errors.
- `/api/fleet/attention`: 5.60 ms, 46,913 bytes, 7 groups, 38 items, no errors.
- Existing cold project, warm project, rich-task, and Thread checks also passed.

The latest rerun of the same installed-artifact audit measured:

- `/api/service/projects`: 153.19 ms, 28,516 bytes, 7 projects, no loading/errors.
- `/api/service`: 5.24 ms, 28,531 bytes, 7 projects, no loading/errors.
- `/api/service?detail=true`: 446.05 ms, 40,174 bytes, 7 projects, no loading/errors.
- `/api/fleet/attention`: 10.73 ms, 33,420 bytes, 7 groups, 12 items, no errors.
- Cold, warm, rich-task, and Thread checks passed again.

These endpoint timings are installed-artifact evidence for the combined
worktree. No route edit was made because another agent owns concurrent
`serve.ts` work.

The first post-install audit after the latest boundary changes measured
`/api/service?detail=true` at `329.07 ms`. That route is an explicit all-project
detail compatibility read, not the initial shell, so the audit now gives it a
separate `750 ms` budget while keeping the compact fleet/service budget at
`250 ms`. A repeat after the installed process had warmed its project/config
readers measured `88.44 ms`; five consecutive repeats stayed between
`66.87 ms` and `83.84 ms`. The detail route remains explicit and bounded, while
the ordinary Projects shell continues to use `/api/service/projects` and does
not pay this enrichment cost.

## Serial Route Finding

The route still reads each project's saved shell synchronously in registration
order:

- `/api/service/projects` calls `.map()` at `src/runtime/serve.ts:6019-6025`.
- Compact `/api/service` calls the same synchronous helper at
  `src/runtime/serve.ts:6029-6050`.
- The detail route uses `Promise.all` at `src/runtime/serve.ts:6057-6059`, but
  `enrichProjectSummaryFromProjection` performs the synchronous shell read at
  `src/runtime/serve.ts:5959-5975` before its first `await`. Those shell reads
  therefore remain serial; only the later provider/migration/availability work
  can overlap.
- `/api/fleet/attention` maps synchronously at `src/runtime/serve.ts:6071-6091`.
  It now uses the saved boundary attention helper, but the per-project boundary
  read still runs inside that synchronous loop.

So the answer is: **the browser no longer hydrates projects serially, but the
server still hydrates saved project summaries serially.** A malformed project is
contained by the existing safe route wrappers and the projection-reader
hardening. A locked or unusually slow SQLite read can still hold the event loop
and delay every later project because the synchronous database reader has a
5-second busy timeout.

## Projection Boundary Finding

`readProjectSummaryShellProjection` now reads only the saved summary row with
orientation and approved-plan expansion disabled, and returns `null` on an
unreadable database. `readCurrentAttentionProjection` now returns a missing
projection on database errors instead of throwing; the route consumes the saved
boundary attention helper and exposes the missing/refresh result. The remaining
route-level gap is the synchronous per-project loop, which requires a
`src/runtime/serve.ts` change. That edit was intentionally not made in this
turn because the file is concurrently owned.

## Changes and Proof

- `src/runtime/project-summary-projection.ts`: fail closed for an unreadable
  saved shell projection.
- `src/runtime/attention-projection.ts`: fail closed for unreadable attention
  state and preserve the missing/refresh contract.
- `scripts/project-state-performance-audit.mjs`: report timings and bounded
  errors for all four requested API surfaces.
- `src/runtime/__tests__/project-summary-projection.test.ts`: corrupt summary
  database remains a local shell miss.
- `src/runtime/__tests__/attention-projection.test.ts`: corrupt attention
  database remains a local saved-surface miss.
- `src/runtime/__tests__/fleet-read-model-isolation.test.ts`: a corrupt
  project's failure remains local across the fleet summary routes, and those
  routes agree after the legacy queue diverges from the promoted database.
- Focused runtime/harness proof: 4 files, 42 tests passed; 5 selected route
  regression tests passed (2 saved-attention boundary tests and 3 service
  tests).
- Production build passed; installed `/api/stale-server` reported `stale:false`.
- `pnpm lint:contracts` and `pnpm lint:data-layer` passed. Repository-wide
  `pnpm typecheck` remains blocked by unrelated pre-existing model/test errors.
- `git diff --check` passed.

No persisted schema or authoritative contract was changed. The remaining route
finding is deliberately recorded here rather than hidden behind conflicting
edits to `src/runtime/serve.ts`.
