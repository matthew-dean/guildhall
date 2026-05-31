# Guildhall 0.8.0 MVP Tracker

**Status:** shipped planning tracker; release artifacts are the release-status authority
**Owner:** Guildhall 0.8.0 release work
**Primary priority:** Pressure-Test Intake
**New release blockers:** Git Story Closure; Task State Boundary

This tracker was the single internal truth for what belonged in the 0.8.0 MVP.
For shipped status, use the `v0.8.0` tag, `docs/releases/0.8.0.md`, and
`docs/versions/0.8.0/`.
The older 0.8.0 specs remain useful design sources, but they are no longer a
promise that every candidate slice ships in 0.8.0.

## Source Docs

- `internal/plans/2026-05-23-guildhall-0-8-pressure-test-intake.md` is the
  detailed implementation plan for the primary 0.8.0 slice.
- `internal/plans/2026-05-24-guildhall-0-8-git-story-closure.md` is the
  detailed implementation plan for the 0.8.0 Git Story Closure blocker.
- `internal/plans/2026-05-24-task-schema-runtime-evidence-split.md` is the
  detailed implementation plan for the 0.8.0 Task State Boundary blocker.
- `internal/audits/2026-05-24-task-schema-boundary-audit.md` is the evidence
  audit for why task definitions must split from runtime, git/workspace state,
  and evidence history.
- `internal/specs/2026-05-22-guildhall-0-8-practices-deep-intake-worker-modes-and-personas.md`
  is the broader design source for practices, worker modes, Pressure-Test
  Intake, operational unblockers, language maps, practices, and personas.
- `internal/specs/2026-05-23-guildhall-request-intake-and-thread-actions.md`
  is the broader design source for New Request, Thread cards, routed actions,
  project-owned state, local history, and operational unblockers.
- `internal/specs/2026-05-22-guildhall-0-8-html-artifacts-and-agent-ui-protocol.md`
  is the design source for rich artifacts. Only the smallest safe artifact
  proof belongs in 0.8.0.
- `internal/specs/2026-05-22-guildhall-0-8-podman-project-runtime.md` is the
  deferred Podman/runtime-isolation source spec. It is not part of the 0.8.0
  MVP; it now belongs to the proposed 0.9.0 task-shaping and finishability
  direction.
- `internal/audits/flow-audit.md` remains the live checklist and evidence log.
- `internal/design-notes/ux-review-calibration-and-work-review-integration.md`,
  `internal/research/2026-05-25-ux-review-calibration-source-notes.md`, and
  `internal/plans/2026-05-25-review-calibration-and-failure-corpus.md` are
  follow-on 0.9.0 planning sources for calibrated work review. They are not
  0.8.0 MVP blockers.

## MVP Thesis

0.8.0 should make Guildhall trustworthy at the beginning and end of work.

At the beginning, a messy request should become the right kind of work:
ordinary task, question, settings proposal, repair, or Pressure-Test Intake.
For broad or risky work, Guildhall should ask one good question at a time,
persist what it learns, and produce a buildable plan with assumptions and
deferrals.

At the end, a finished task should not leave the user guessing whether the
repo is dirty, committed, pushed, in a PR, merged, deferred, or blocked. That
is Git Story Closure.

Across the whole lifecycle, a task should mean "the work", not "every runtime
thing Guildhall did while working on it." That is Task State Boundary.

## 0.8.0 Must Ship

### 1. Pressure-Test Intake

**Status:** implemented in the current 0.8.0 branch; final release sweep still
required.

Scope:

- New Request routing for release, feature, task, question, settings, repair,
  clarification, and multi-intent requests.
- Persisted Pressure-Test Intake state with domains, inspected evidence, asked
  questions, answers, assumptions, deferrals, decisions, and language-map
  candidates.
- Thread cards for request and pressure-test question flows.
- One-question-at-a-time answer submission.
- Existing-card reuse evidence before creating duplicates.
- Spec Agent operating contract for Pressure-Test Intake.
- Focused runtime tests and at least one browser proof on the active target
  project before release.

Release bar:

- A broad release request can start intake without hand-editing state.
- A user answer updates durable intake state, advances or closes a domain, and
  renders the next useful question in Thread.
- A completed intake can produce a buildable spec or release plan with explicit
  assumptions and deferrals.
- Ordinary small tasks still take the shorter task/spec path.

### 2. Git Story Closure

**Status:** implemented for the 0.8.0 MVP; final full-suite release sweep
still required.

Problem:

Guildhall already knows about task worktrees, branches, landing strategies, and
`mergeRecord`, but those pieces do not yet add up to a clear product contract.
Tasks can look finished while the repo still has uncommitted changes,
unpushed commits, a branch with no upstream, a pending PR, a skipped merge, or
a stale task worktree. The user then has to reconstruct the real git story by
hand.

MVP contract:

- Every project and task gets a live Git Story Snapshot.
- Every project gets an explicit Git Story Policy copied from the system/global
  Git Story config at project setup or discovery time, then refined by
  discovered repo facts and project-level overrides.
- Current work closure blocks on unresolved git stories, not just known
  Guildhall-owned dirty checkout residue.
- Thread and task provenance show the current closure state and the next safe
  action.
- The product distinguishes local-only/deferred work from accidentally
  unfinished work.
- Guildhall may auto-commit, auto-push, and auto-open PRs only when the copied
  project policy says to do so. The shipped system default should ask first,
  but users can change their system default to automate more and opt specific
  projects out.
- Auto-generated commit messages use the built-in Commit Story practice:
  describe the actual completed work, fall back to changed-path context when
  the task title is weak, stay concise, and never add AI attribution.
- Guildhall never force-pushes, rebases shared branches, or rewrites published
  history unless the user explicitly configures that dangerous behavior for the
  project and confirms it at the point of use.

Project discovery and intake:

- Detect whether the project is a git repo, its default branch, current branch,
  remote/upstream state, and whether existing branches/PRs imply a branch-based
  or PR-based workflow.
- Copy the current system/global Git Story config into the project as the
  initial policy. Discovery can annotate or suggest changes, but it should not
  silently replace the user's global preference.
- Ask only for missing intent, such as whether completed Guildhall work should
  usually be committed automatically, pushed automatically, opened as a PR, left
  local for review, or decided per task. If the copied system config already
  answers those questions, do not ask them again.
- Keep the policy visible in Settings near `landingBranch`, `landing_strategy`,
  and worktree isolation settings.

Closure states:

- `clean`: no local changes and no unpublished branch work detected.
- `dirty_uncommitted`: tracked or untracked changes are present.
- `committed_local`: branch has local commits not pushed upstream.
- `no_upstream`: branch exists but has no upstream.
- `pushed`: branch commits are pushed and no PR is known.
- `pr_open`: an open PR exists for the branch.
- `merged`: branch/PR has landed or the task `mergeRecord` proves landing.
- `local_only`: user or project policy says the work should remain local.
- `deferred`: the git story is intentionally postponed with a recorded reason.
- `conflict`: merge/push/PR creation failed and needs human choice.
- `unknown`: Guildhall could not inspect git state.

Snapshot inputs:

- `git status --porcelain=v1 -b`
- current branch and upstream
- ahead/behind counts
- uncommitted and untracked file counts, with path samples
- local commits ahead of upstream
- task `worktreePath`, `branchName`, `baseBranch`, and `mergeRecord`
- optional `gh pr view` / `gh pr list` result when available and cheap

User-visible surfaces:

- Projects home: compact project git health chip for dirty, unpushed, PR, or
  unresolved task-worktree state.
- Thread task card: Git Story section when a task is in review, gate, blocked,
  done, or has unresolved git state.
- Provenance drawer: full snapshot details beside `mergeRecord`.
- Closure: blocker group for dirty repos, local commits, no upstream,
  pending PRs, skipped merges, stale task worktrees, and unknown inspection
  failures.

MVP actions:

- Inspect diff.
- Commit local changes, with explicit file scope and policy-aware automation.
- Push branch, respecting normal fetch-first errors and project push policy.
- Open PR or show the existing PR, respecting project PR policy.
- Mark local-only.
- Mark deferred with reason.

Out of scope for 0.8.0:

- autonomous force-push;
- rebasing already-pushed branches;
- automatic review-thread resolution;
- full GitHub check polling and mergeability automation;
- multi-host provider-specific PR dashboards.
- making fully autonomous git writes the default for new users.

Release bar:

- A done task with dirty work, local-only commits, no upstream, skipped merge,
  or pending PR cannot silently appear fully closed.
- A project with dirty/unpushed work is visible from the project list or home
  before the user opens individual tasks.
- Current work closure gives a concrete list of unresolved git stories and the
  safest next action for each one.
- Marking work `local_only` or `deferred` records an explicit reason and stops
  it from masquerading as accidental residue.
- A user can configure their default to auto-commit completed work while a
  project can still opt out and require confirmation.
- A new project inherits the user's current system Git Story config, so a user
  who globally prefers auto-commit does not have to re-answer that preference
  during every project intake.

Implementation notes:

- `src/runtime/git-story.ts` owns the snapshot/state model and summary rules.
- Project-level policy reads from global config when no project override exists;
  the API exposes that copied view without rewriting project config during the
  `.gitignore` cleanup lane.
- `commit`, `push`, `open-pr`, `local-only`, and `defer` actions are exposed as
  policy-gated endpoints. When a completed task has dirty task-worktree changes
  and the resolved project policy says `commit: auto`, the orchestrator
  auto-commits the completed task work before landing. The default UI path
  still requires confirmation when the policy says `ask`.
- Projects Home, Thread, Provenance, and Closure now surface
  unresolved Git Story state.

### 3. Task State Boundary

**Status:** audit and implementation plan complete; implementation required
before 0.8.0 can be called release-ready.

Problem:

Project-local `TASKS.json` currently mixes task definition, runtime execution
state, worktree/git placement, and evidence history. In live projects this has
put machine paths, `~/.guildhall` worktree paths, notes, review verdicts,
adjudications, escalations, gate results, and remediation counters into a file
that should describe the work. That directly caused the FLL git inspection bug
and undermines Git Story Closure because task records can carry stale runtime
placement as if it were task truth.

MVP contract:

- Project-local `TASKS.json` remains the portable task-definition file.
- System-local project history stores runtime state, task workspaces, git
  provenance, notes, gate output, review verdicts, adjudications, escalations,
  agent issues, merge records, and checkpoints.
- Old task files continue to render and run through compatibility projection.
- New writers stop adding runtime/evidence fields to project-local task
  definitions.
- Task Drawer, Thread, Overview, and Release use effective task projections
  backed by runtime/evidence APIs.
- A migration can extract legacy runtime/evidence fields idempotently and
  rewrite project-local task definitions only after system-local evidence is
  safely written.

Release bar:

- FLL-style legacy task records with many verdicts, adjudications, notes,
  escalations, worktree paths, and retry counters project correctly.
- New task ticks do not recreate legacy runtime/evidence fields in
  project-local `TASKS.json`.
- Git Story inspection resolves task workspace state from system-local runtime
  storage, not task-local `worktreePath`.
- Evidence tabs still show history, expert review, gates, and provenance.
- Migration has a dry-run and an apply path with backup and idempotency tests.

### 4. Provider Default Visibility

**Status:** implemented in the current 0.8.0 branch; keep in MVP.

Scope:

- Restore the global default provider to the configured OpenAI-compatible
  provider when local config drifted to Codex.
- Warn when preferred provider and scoped model overrides disagree.
- Show the default provider/model group on Projects home.
- Route the chip to global provider settings.

Release bar:

- A user can see the machine-default provider/model before opening a project.
- Provider/model scope mismatches stay visible until fixed.

## 0.8.0 Should Ship If Already Green

These are useful but should not expand the release. Keep the smallest already
implemented proof if focused tests are green; otherwise move the unfinished
piece to 0.9.0.

### Worker Modes

Keep the minimum `build`, `diagnose`, and `tdd` mode metadata and context
injection if it is already covered by focused tests. Defer the broader practice
library.

### Project Language Map

Keep deterministic language-map extraction from accepted intake answers and
docs if it remains compact and does not introduce large committed memory diffs.
Defer semantic enrichment.

### Guided Operational Unblockers

Keep only the routing/protocol foundation if it is already present: detected
provider/deploy/migration/access blockers should become resumable blocker
records with inspected evidence and one-step user actions. Defer broad provider
runbooks.

### Rich Artifacts

Keep durable artifact storage and safe read-only protocol primitives only if
they are already tested. Defer interactive artifact events and full component
renderer expansion.

### Capability Requests

Keep the fake `mount_directory` request/grant proof only as a protocol testbed.
Real host mount grants and runtime brokering move to a future release.

### Local History And Project Memory Hygiene

Keep the minimum guardrails that prevent bulky generated history from being
mistaken for normal committed project state. Defer full retention UI,
export/delete controls, and large-scale compaction.

## Deferred To 0.9.0 Or Later

- Full practice library with Settings UI, approval workflows, triggers, and
  promotion.
- Full persona library with task-scoped participation rules and reviewer
  roster editing.
- Podman/containerized project runtime as a default execution environment;
  tracked forward in
  `internal/plans/2026-05-24-guildhall-0-9-task-shaping-and-finishability.md`.
- Host-tool broker and real mount-grant workflows.
- Full rich artifact renderer with interactive decisions/checklists.
- Long-thread virtualization and complete local history management UI.
- Automatic GitHub review-thread resolution and PR mergeability polling.
- Autonomous PR landing beyond explicit, user-confirmed commit/push/open-PR
  actions.
- Broad provider-specific operational runbooks.

## Release Readiness Checklist

- [x] Pressure-Test Intake implementation plan exists.
- [x] Pressure-Test Intake foundation is represented in the live flow audit.
- [x] Provider default visibility is represented in the live flow audit.
- [x] Git Story Closure implementation plan exists.
- [x] Task State Boundary audit exists.
- [x] Task State Boundary implementation plan exists.
- [x] Task runtime/evidence stores exist under system-local project history.
- [x] Compatibility projection supports legacy task files.
- [ ] New writers no longer persist runtime/evidence fields to project-local
  `TASKS.json`. Current slice mirrors high-value evidence/workspace writes to
  the new stores while preserving legacy writes for compatibility; the
  remaining work is to flip canonical writers over fully.
- [x] Task-state migration is idempotent and covered by live-shaped fixtures.
- [ ] Task Drawer, Thread, Overview, and Closure render from effective task
  projections. Current slice adds evidence/review/history/git-story endpoints
  and Git Story workspace-store reads; drawer/surface rewiring remains.
- [x] Git Story Snapshot model and tests exist.
- [x] Project/service API exposes git story summary.
- [x] Thread and Provenance render git story state.
- [x] Current work closure blocks unresolved git stories.
- [x] Commit/push/open-PR/local-only/deferred actions obey project Git Story
  Policy and record durable evidence.
- [x] Focused Vitest suite passes.
- [x] `pnpm typecheck` passes.
- [x] `pnpm build` passes.
- [x] Browser smoke covers Projects Home and at least one unresolved
  Git Story Closure state.
- [x] Flow audit top section reflects the final shipped 0.8.0 state.

## Git Story Closure Implementation Plan Sketch

Write the detailed plan in a separate implementation-plan file before touching
runtime code. The plan should stay small and test-first:

1. Add git-story domain types and a snapshot inspector around the existing
   `GitDriver` instead of expanding `mergeRecord`.
2. Add unit tests for dirty, clean, ahead, no-upstream, skipped-merge, pending
   PR, local-only, deferred, and unknown states.
3. Add a project-level API summary that aggregates base checkout and active
   task worktrees.
4. Add release-readiness blockers from the summary.
5. Add Git Story Policy settings and discovery/intake seeding.
6. Render the summary in Thread, Provenance, and Projects home.
7. Add explicit action endpoints for mark-local-only and mark-deferred first.
8. Add commit/push/open-PR actions behind policy evaluation after the read-only
   story is visible and tested.

## Release Decision Rule

0.8.0 can ship when Pressure-Test Intake works, provider defaults are visible,
and Git Story Closure prevents silent dirty/unpushed/PR limbo.

Everything else is allowed into the release only if it is already implemented,
tested, and does not make those three outcomes harder to trust.
