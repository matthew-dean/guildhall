# Hermes Quality Comparison - 2026-05-29

## Scope

- Branch/commit: `feature/0.9.0-orientation-proof-paths`, local 0.9.0 work
- Benchmark: neutral Guildhall-vs-Hermes quality comparator
- Fixture/subset: deterministic file smoke and Pantry Pulse explicit app task
- Models/providers: Guildhall and Hermes local development configurations; token
  and cost telemetry were treated as secondary context
- Runtime: local macOS development run; Guildhall used its normal task
  run-once path, Hermes used its normal CLI session path
- Automation policy: fully automated for the Guildhall lane

## Results

| Lane | Result | Score | Notes |
| --- | --- | --- | --- |
| Deterministic file smoke, Guildhall | pass | 100/100 | Created the expected marker file through Guildhall's normal work loop. |
| Deterministic file smoke, Hermes | pass | 100/100 | Created the expected marker file directly and faster. |
| Pantry Pulse explicit app, Guildhall initial artifact scan | fail / misleading | 5/100 | The worker created the app in the task worktree, but the comparator inspected only the project root. |
| Pantry Pulse explicit app, Guildhall regenerated artifact scan | partial pass | 87/100 | The generated app passed browser load, seeded items, filtering, Mark used, screenshots, warm palette, and non-blue-primary checks; it lost points because the accepted worktree artifact was not landed into the project root and the run did not exit cleanly. |
| Pantry Pulse explicit app, Hermes | pass | 100/100 | Hermes followed the explicit quality brief, produced a dependency-free app, and passed deterministic behavior/palette checks. |

## Interpretation

- What this proves: the neutral comparator can run both tools against the same
  prompt and grade user-visible artifacts. Hermes follows a detailed app-quality
  brief well. Guildhall can generate a good app artifact, but the run surfaced a
  real worktree-to-project-root completion gap.
- What this does not prove: it does not prove Hermes inferred product or design
  direction from sparse intent, because the explicit app prompt handed it the
  palette, behavior, accessibility, and quality bar. It also does not provide a
  stable cost comparison because provider/session cost fields were incomplete.
- Regressions or false-success risks: artifact discovery must follow Guildhall's
  accepted task worktree, but completion still needs the accepted result landed
  in the project root before the run can be scored as complete. Deterministic
  browser checks are not a full visual taste review.
- Follow-up: keep raw runs local, improve the comparator's visual-review score,
  and add a Guildhall completion requirement that prevents worktree-only app
  output from counting as done.

## Raw Evidence

Raw artifacts were generated locally under:

```text
internal/benchmarks/runs/2026-05-29-quality/
```

That directory is ignored by Git because it contains generated projects, raw
model sessions, screenshots, JSON reports, and repeated rerun outputs. The
durable record is this curated summary plus the benchmark harness/runbook.
