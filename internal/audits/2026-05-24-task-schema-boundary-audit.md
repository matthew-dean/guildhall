# Task Schema Boundary Audit

Date: 2026-05-24

## Why this audit exists

The current `Task` schema is doing too many jobs. It stores task identity and
task scope, but it also stores live coordinator leases, filesystem/runtime
workspace choices, git closure state, review history, escalation history,
agent notes, gate output, and remediation counters.

That conflation caused a visible product bug: task records carried
`worktreePath` values such as `~/.guildhall/worktrees/...`; Node did not expand
`~` when running git with that value as `cwd`, so Guildhall reported
`spawn git ENOENT` even though the target project had git installed.

The deeper bug is not only tilde expansion. The task record is carrying data
that belongs to different authority layers.

## Evidence collected

Code evidence:

- `src/core/task.ts:436-636` defines one large `Task` object containing task
  spec fields (`title`, `description`, `spec`, `acceptanceCriteria`), runtime
  fields (`assignedTo`, `revisionCount`, `retryWindow`,
  `remediationAttempts`), evidence/audit arrays (`notes`, `gateResults`,
  `reviewVerdicts`, `adjudications`, `escalations`, `agentIssues`), and git
  runtime/provenance fields (`worktreePath`, `branchName`, `baseBranch`,
  `mergeRecord`, `gitStory`).
- `src/core/task.ts:444-445` says `projectPath` is an absolute path, but live
  project data contains relative values (`frontend/`, `database/`, `.`,
  `../looma`) and absolute values. The field is actually task scope, not a
  consistent runtime path.
- `src/runtime/orchestrator.ts:2290-2405` persists `worktreePath`,
  `branchName`, and `baseBranch` onto the task after worktree creation.
- `src/runtime/serve.ts:1216-1227` reads `task.worktreePath`,
  `task.mergeRecord`, and `task.gitStory` to build Git Story inspection input.
- `src/tools/escalation.ts:85-99` appends escalation records to the task,
  changes `status` to `blocked`, and writes `blockReason`.
- `src/tools/escalation.ts:184-233` uses resolved escalation history plus
  `revisionCount` to create and interpret `retryWindow`.
- `src/tools/report-issue.ts:80-90` appends agent issues to the task without
  changing status.
- `src/tools/report-issue.ts:187-195` treats unresolved unbroadcast issues as a
  coordinator inbox.
- `src/tools/run-gates-tool.ts:88-125` writes gate command results directly
  into `task.gateResults`.
- `src/tools/task-queue.ts:139-180` allows update calls to mutate task status,
  assignment, block reason, human judgment, gate results, and notes.
- `src/tools/task-queue.ts:191-210` infers `assignedTo` from `status`, which
  makes it a live execution lane marker, not user-authored task content.
- `src/runtime/orchestrator.ts:5315-5425` reads prior `reviewVerdicts` to
  detect repeated dissent and appends one verdict per reviewer persona per
  review round.
- `src/runtime/orchestrator.ts:5570-5585` appends an `AdjudicationRecord` to the
  task and also writes a separate `DECISIONS.md` entry, proving the record is
  audit/evidence material.
- `src/runtime/orchestrator.ts:5168-5225` mutates `handoffSequence` and
  `handoffStep` during execution by adding completion timestamps and handoff
  notes.
- `src/runtime/orchestrator.ts:2689-2695` applies `task.permissionMode` to the
  dispatched agent, which means the field is a per-task runtime safety clamp.
- `src/runtime/orchestrator.ts:3688-3855` writes `mergeRecord` based on
  auto-commit, checkpointing, merge, push, and PR outcomes.

Live data evidence:

- `/Users/matthew/git/oss/fair-labor-license/.guildhall/TASKS.json` has 6
  tasks with 60 `reviewVerdicts`, 5 `adjudications`, 11 `escalations`, and 39
  `notes` stored project-locally.
- FLL `task-auth-complete` carried 60 review verdicts, 5 adjudications, 5
  escalations, 21 notes, `revisionCount: 6`, a `retryWindow`, and git runtime
  metadata.
- FLL `task-db-bootstrap` is `done` but still carries 2 resolved escalations
  and 9 notes.
- `/Users/matthew/git/oss/looma-knit/.guildhall/TASKS.json` has 38 tasks with
  17 escalations and 214 notes stored project-locally.
- `/Users/matthew/git/oss/narrative-harness/.guildhall/TASKS.json` has
  home-relative worktree paths, 4 review verdicts, and 27 notes.
- Existing projects disagree on `projectPath`: examples include `.`,
  `frontend/`, `database/`, `frontend/server/`, `model`, `docs`, `app`,
  `../looma`, and absolute paths under `/Users/matthew/git/oss/...`.

## Field meanings and storage recommendations

### Task-owned specification fields

These are genuinely part of the task definition and should remain task-owned:

- `id`
- `title`
- `description`
- `domain`, as routing intent
- `request`, if it is the durable user request that created the task
- `spec`
- `acceptanceCriteria`
- `productBrief`
- `openQuestions`, for currently open user questions
- `outOfScope`
- `dependsOn`
- `priority`
- `origination`
- `proposedBy`
- `proposalRationale`
- `parentGoalId`
- `createdAt`
- `updatedAt`
- `completedAt`

`projectPath` should remain task-owned only after it is redefined. It should be
a task scope path, preferably project-relative and normalized, not a runtime
filesystem path. Runtime code should resolve it through project settings at the
edge.

### Current-state projection fields

These are valid for the user to see on a task, but should be projections over
runtime/evidence records rather than the canonical long-term storage for all
history:

- `status`
- `blockReason`
- open escalation summary
- latest gate summary
- latest review summary
- latest git story summary
- terminal completion/release summary

The task can cache these for UI speed if needed, but the source of truth should
be system-local runtime/evidence storage.

### Runtime execution state

These fields are not task content. They describe how Guildhall is currently
executing or recovering the task and should move to system-local runtime state:

- `assignedTo`: current execution lane or lease, inferred from status today.
- `revisionCount`: workflow counter used by review/retry control.
- `retryWindow`: recovery window derived from resolving max-revision
  escalations.
- `remediationAttempts`: coordinator recovery counter.
- `handoffStep`: execution pointer inside a handoff plan.
- `permissionMode`, if derived from settings. If explicitly set by the user for
  one task, model it as a task override, not ambient runtime state.

### Workspace and git runtime state

These fields should not live on task definition records:

- `worktreePath`
- `branchName`
- `baseBranch`

They belong in a system-local task workspace record keyed by project id and
task id. The record should be derived from global/project worktree settings,
not copied into every task by default. Project-level overrides should point to
the nearest settings object that actually specifies values.

`mergeRecord` is git/release provenance. It should move to system-local git
story evidence, while the task UI can show a terminal summary such as "merged",
"pushed", "PR open", or "local only".

`gitStory.override` is different: if the user explicitly marks a task
`local_only` or `deferred`, that is a task-level decision. It should remain as a
small task override or task decision record, but not be mixed with computed git
inspection data.

### Evidence and audit history

These are clearly evidence/audit, not task definition:

- `notes`
- `gateResults`
- `reviewVerdicts`
- `adjudications`
- resolved `escalations`
- resolved `agentIssues`
- `humanJudgment`, unless it is an unresolved current answer needed to unblock
  the task

They should move to system-local evidence storage keyed by task id. The task
view can project recent snippets and current blockers, but the project-local
task file should not become a transcript database.

### Mixed fields that need splitting

`escalations` should split into:

- current blocker projection on task/effective view, when unresolved
- full escalation event history in system-local evidence

`agentIssues` should split into:

- unresolved coordinator-inbox items in runtime state
- resolved issue history in evidence

`handoffSequence` should split into:

- task-authored handoff plan, if a task genuinely requires a specialist
  sequence
- handoff execution state and handoff notes in runtime/evidence

`shelveReason` should split into:

- terminal task disposition (`shelved`, reason code, short detail)
- policy runtime fields (`policyApplied`, `requeueCount`) outside the task
  definition
- long-form rejection/pre-rejection history in evidence

`humanJudgment` should be deprecated in favor of structured questions,
escalations, or task decisions. A free-form field is too ambiguous to model
cleanly.

## Proposed schema boundary

Use three canonical layers:

1. Project-local task definition:
   - Portable task spec, task scope, dependencies, current user-facing status,
     and explicit task-level overrides.
   - No machine paths, no worktree paths, no transcript history, no raw gate
     output, no long review history.

2. System-local runtime state:
   - Execution leases, active agent lane, worktree placement, branch
     assignment, current retry/revision counters, open coordinator issues, and
     recovery windows.
   - May reference task ids and project ids, but should not be copied into the
     project task definition by default.

3. System-local evidence/audit:
   - Notes, gate outputs, review verdicts, adjudications, escalation history,
     issue history, remediation decisions, git/merge provenance, and
     checkpoint/proof packets.
   - The UI should query this when showing History, Experts, Provenance, and
     Release details.

## Migration implications

- Add a task-state migration that extracts runtime/evidence fields from
  project-local `.guildhall/TASKS.json`.
- Keep a compatibility reader that can project old fields into the new
  effective task shape.
- Normalize `projectPath` as `scopePath` or equivalent, project-relative where
  possible.
- Stop writing new `worktreePath`, `branchName`, `baseBranch`, notes, verdicts,
  adjudications, and gate output into project-local task records.
- Update Git Story to resolve workspace records and git policy from
  system/project settings rather than reading task-local worktree fields.
- Update Task Drawer tabs so History/Experts/Provenance are backed by
  evidence/runtime APIs, not by raw task fields.

## Bottom line

The current schema is not merely overgrown. It crosses authority boundaries.
Tasks should know what work they are, what they need, what they depend on, and
what their current user-facing state is. They should not know where Guildhall
put a checkout, which branch was minted as a runtime detail, every sentence an
agent wrote, every persona verdict ever produced, or every resolved operational
event.
