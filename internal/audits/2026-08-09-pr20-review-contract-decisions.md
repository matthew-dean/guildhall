# PR 20 Review Contract Decisions

## Contract Touch Decision

- **Work id:** `pr20-review-repair-2026-08-09`.
- **Touched contracts:** pressure-test release-intake creation identity and retry behavior; the optional persisted `PressureTestIntake.handoff` completion marker; persisted `ProjectActionModel.workSummary`; persisted project-scope dependency and parent identity fields; current action projection for terminal releases; and the review-calibration cases `unimplemented-task-proof-recovery` and `vague-approval-state`.
- **Contracts considered but not touched:** task queue identity, release membership, task dependency authority, public API response shapes, model-provider prose, and public documentation. The retry repair reuses the existing intake response and does not introduce a client idempotency field.
- **Required follow-up:** none. A later API version may add an explicit client request id if callers need to intentionally repeat byte-identical release requests as separate intakes.
- **Proof required:** retry the same request concurrently; keep distinct slug-equivalent requests distinct; replace stale terminal action projections; round-trip dependency and parent scope fields through SQLite and compact API reads; run the exact Narrative Harness and Looma progressive-scope rendered checks; validate the changed calibration corpus; run focused tests, `pnpm typecheck`, `pnpm model:independence`, and `pnpm lint:contracts`.
- **Proof provided:** focused regressions cover intake retry/collision behavior and terminal current projection. Existing database and compact-read regressions cover dependency fields. The final command results are recorded in the commit report for this decision.
- **Waivers:** no behavioral or proof waivers.
- **Owner-review items:** an exact retry, defined by the same target type, exact title, and raw request, returns the existing intake. A changed title or request remains a distinct intake and receives the next collision-safe suffix.
- **Apply/revert behavior:** apply the retry lookup under the existing intake write lock and rebuild terminal actions from current readiness. Revert code and tests together; do not remove persisted handoff or dependency data during rollback.

## Schema Migration Decision

- **Persisted schemas touched:** pressure-test JSON records gain optional `handoff`; project-summary JSON gains optional `actionModel.workSummary`; SQLite `work_scope` gains `dependency_blocked` and `dependency_task_ids_json` in schema 37 and continues carrying `parent_task_id` through compact scope-row projections.
- **Scope and change class:** additive compatibility fields plus a derived-read repair. No task, release-membership, or dependency-authority schema changes.
- **Existing data impact:** existing pressure-test records without `handoff` parse unchanged; existing summaries without `workSummary` keep their prior presentation fallback; databases before schema 37 receive the two dependency columns with `false` and an empty list until the current projection repopulates them.
- **Migration ids:** `0.13.0/pressure-test-intake-handoff`, `0.13.0/project-action-work-summary`, and database schema 37 `project-scope-dependency-summary`.
- **Safety and required-before-run behavior:** JSON additions require no eager rewrite. The SQLite migration runs on writable database open before scope-row reads or writes use the new columns. A projection refresh repairs defaulted dependency state from authoritative task dependencies.
- **Compatibility reader:** `PressureTestIntake` keeps `handoff` optional; action-model readers tolerate missing `workSummary`; scope-row readers normalize missing dependency fields to `false` and `[]`.
- **Fixtures and tests:** completed-intake materialization tests cover old and new handoff states; project-action-model tests cover summary/current action behavior; schema-36 upgrade, release-selection round trip, and compact release-readiness tests cover dependency fields; the Narrative Harness and Looma rendered fixtures prove parent/child suppression with exact progressive counts; calibration validation covers the changed lifecycle cases.
- **Owner-facing plan text:** no migration action is required. Existing projects upgrade when Guildhall opens their writable state database.
- **Rollback/revert behavior:** stop new writes before rolling back. JSON readers from the previous build ignore additive fields, but rolling back a schema-37 database requires the normal pre-migration backup/restore path rather than dropping columns in place. Preserve intake files so a forward repair can recover materialized handoffs.
