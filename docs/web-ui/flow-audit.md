---
title: Web UI flow audit
help_topic: web.flow_audit
help_summary: |
  Living test plan for walking a real project through Guildhall setup,
  workspace intake, task shaping, execution, and completion from the browser.
---

# Web UI flow audit

This is the active browser test plan for the Guildhall project surface. Keep it
updated while auditing `t-minus-t` so another agent can resume without guessing.

## Test workspace

- Guildhall repo: `/Users/matthew/git/oss/guildhall`
- Test project: `/Users/matthew/git/oss/t-minus-t`
- Serve command: `cd /Users/matthew/git/oss/t-minus-t && pnpm exec guildhall serve --port 4177`
- Browser target: `http://localhost:4177/`
- Expected project shape: a VSCode extension that lets users write TypeScript
  syntax in `.js` files and view/save it as JSDoc-backed JavaScript, with a
  converter package plus an extension package.

## Current Principle

Thread is the command surface. If the UI asks the user to understand hidden
state, jump across pages for a simple answer, or wait on a vague "agent is
working" card, fix the flow. The user should be able to answer questions,
correct the agent, and ask for direct action from Thread.

## Current Follow-Ups

- [x] Delete stale Looma/Knit spec-stall tasks when they surface as false
  `Needs you` items, instead of merely shelving them and leaving inbox noise
  behind.
- [x] Default workspace import to a single-project assumption unless the
  workspace clearly presents multiple top-level project roots.
- [x] Preserve nested subproject scope hints only when the workspace really is
  multi-project, instead of treating any nested folder as its own project.
- [x] Filter obvious placeholder/import-formatting debris like `(none)` and
  spec-summary scaffold bullets before draft tasks are created.
- [x] Keep task-drawer transcript notes aligned with canonical acceptance
  criteria so stale specifier notes do not contradict the real task.
- [x] Refresh Thread immediately on runtime activity that matters for user
  confidence, especially review back-to-work transitions and failed tools.
- [x] Let hard verifier failures dominate the active operator view instead of
  leaving softer reviewer guidance as the loudest signal.
- [x] Restore worker ownership whenever review/gate/adjudication bounces a task
  back to `in_progress`, so retries resume a coherent worker session.
- [x] Add bounded per-turn context manifests so we can inspect what each agent
  saw without dumping entire raw prompts into the UI.
- [x] Surface recent context manifests in the task drawer with section sizes,
  prompt previews, and health warnings.
- [x] Add context health checks for oversized prompts, missing phase context,
  and subproject/worktree mismatches.
- [x] Prune and cap context snapshots so debug visibility stays bounded instead
  of growing without limit.
- [x] Let reviewer fallback treat provider throttling as infra noise, not a
  fake revision request, when work is already verified and the remaining truth
  should be decided in `gate_check`.
- [x] Let deterministic review itself treat “all ACs met, no hard gates yet”
  as a handoff to `gate_check` instead of a fake revise loop back to the
  worker.
- [x] Skip same-task agent snapshot resumes when the task has been updated more
  recently than the saved session, so review/worker lanes do not wake up
  inside stale conversations.
- [x] Normalize deterministic review handoffs so `gate_check` tasks are
  assigned to `gate-checker-agent` and revision bounces return to
  `worker-agent`.
- [x] Keep worker verification turns from sleeping after a successful shell
  tool return; a completed command should stay completed.
- [x] Derive structured acceptance criteria from the saved spec when a task
  reaches review with good markdown but an empty `acceptanceCriteria` array.
- [x] Let worker self-critique reconcile against spec-derived criteria so
  deterministic reviewer fallback grades the task’s real contract.
- [x] Accept `prompt` / `restatement` aliases on `post-user-question` and
  expose a real tool schema so spec intake does not die on first-turn naming
  mismatches.
- [x] Make retryable gate-provider throttles clear stale escalation residue, so
  resumed `gate_check` tasks do not still halt later runs as falsely escalated.

## Automation Backlog

- [x] `guildhall-automation-001` Reduce workspace-import noise and preserve
  subproject scope.
- [ ] `guildhall-automation-002` Shape importer output into a usable Guildhall
  backlog.
- [x] `guildhall-automation-003` Get one real task from intake to spec review
  without manual cleanup.
- [x] `guildhall-automation-004` Run implementation, review, and gates against
  real project truth.
- [x] `guildhall-automation-005` Automate the PR and merge path for completed
  tasks.
- [ ] `guildhall-automation-006` Scale from one-task autonomy to unattended
  queue throughput.

## Architecture Backlog

- [x] `guildhall-architecture-001` Reframe provider UX around authenticated
  CLIs plus OpenAI-compatible / Anthropic-compatible custom providers.
- [x] `guildhall-architecture-002` Normalize effective provider runtime config
  across preflight, orchestrator lanes, provider tests, and UI status.
- [x] `guildhall-architecture-003` Add provider capability manifests for
  routing, fallback, and UI explainability.
- [x] `guildhall-architecture-004` Add a shared provider client pool with
  bounded concurrency and provider-health events.
- [x] `guildhall-architecture-005` Add bounded lane scheduling for spec,
  worker, review, and coordinator lanes.
- [ ] `guildhall-architecture-006` Prove unattended throughput in stages:
  finish one, finish three, then run until blocked or exhausted.

## Task Log Rule

- Update this checklist in the same turn that code or live-browser findings
  change the real state of the work.
- Treat this document as the canonical resume surface for ongoing Guildhall
  debugging and Looma/Knit testing.

## Latest Progress

- Completed the `0.5.0` macOS packaging slice. Guildhall now has a
  buildable packaged artifact at `artifacts/macos/guildhall-macos`,
  a tarball at `artifacts/macos/guildhall-macos.tar.gz`, LaunchAgent install
  and uninstall scripts, a plist template, and a curl-first installer script.
  The packaged launcher now resolves correctly through the
  `~/.guildhall/bin/guildhall` symlink, and the artifact includes a portable
  production dependency tree instead of assuming the source repo's
  `node_modules`. Verified with focused tests plus a temp-home installer smoke:
  the installer wrote the LaunchAgent under `~/Library/LaunchAgents`,
  started the service, answered `/api/version`, and `guildhall stop` shut it
  down cleanly.
- Recorded the packaging-runtime decision for `0.5.0` in
  `docs/design/deno-vs-node-packaging.md`. Measured result: keep the
  Node-based packaged executable. The Deno experiment only compiled with
  `--no-check`, produced a larger binary, started more slowly, and failed the
  real `serve --no-open` startup path, so it is not the right packaging pivot
  for this release.
- Added the `0.5.0` proof tests and release note. Focused proof now covers:
  fleet-level service start with no selected project, attach-existing-folder,
  initialization inside the nested project shell, per-project start/stop, and
  a selected project that still surfaces the proven narrow automation lane as
  terminal success from inside the new service/project structure.
- Added repo-local dev installer ergonomics for the macOS packaged artifact.
  `pnpm dev:install` now builds the current branch artifact, runs the real
  installer against it, verifies the installed CLI, and surfaces the resolved
  `guildhall` path. `pnpm dev:uninstall` stops the service, removes the
  LaunchAgent and packaged runtime, and preserves user project registry/state.

- Closed the retry-window failure family with live proof on `task-016`.
  Resolved `max_revisions_exceeded` retries now start a persisted fresh
  revision window (`retryWindow.startedAt` + `baseRevisionCount`) instead of
  inheriting historical debt forever. Live proof on Looma/Knit:
  `task-016` resumed from `revisionCount: 8`, self-healed
  `retryWindow.baseRevisionCount: 8`, handed off `in_progress -> review ->
  gate_check`, then bounced `gate_check -> in_progress` with
  `revisionCount: 9`, `currentCycleRevisionCount: 1`, and no new open
  escalation. That proves the first post-retry bounce now counts against the
  fresh window instead of immediately re-triggering historical
  `maxRevisions`.
- Defined the next failure family explicitly: stale reviewer baggage surviving a
  human retry. After a `max_revisions_exceeded` escalation is resolved,
  Guildhall now suppresses older reviewer notes in both worker context and
  serve-layer `latestReviewerSummary` until a new review pass actually happens.
  Live proof target: resolving and retrying `task-016` should stop surfacing
  the old reviewer blob before the next reviewer run.
- Defined the next failure family explicitly: worker self-critique exists but
  Guildhall misses it when the note uses the worker's persona role label (for
  example `Backend Engineer`) instead of `worker` / `implementer`. Live proof
  target: `task-016` should surface `latestSelfCritique` from the existing
  worker note, and recovery should stop asking to rewrite that note when it is
  already present.
- Release focus is now explicitly narrowed to start-to-finish automation.
  Product/UI follow-ups are tabled unless they directly block unattended task
  completion:
  - coordinator detail polish
  - layering / overlay sanity sweep
  - task drawer information hierarchy
- Found and fixed a real automation-lane ownership bug: resolving a blocked
  escalation back to `in_progress` could leave the task with
  `assignedTo: null`, which made reopened work look active without actually
  restoring the worker lane. Escalation resolution now restores the correct
  lane owner (`worker-agent`, `reviewer-agent`, or `gate-checker-agent`), and
  both the serve layer and orchestrator now self-heal stale active ownership
  when older task records still carry the broken shape.
- Batch-proof prep exposed a more serious truth bug: task-scoped shell commands
  could still execute in the base repo even after worktree isolation was set
  up, which let generated artifacts like `web/app/types/supabase.ts` leak out
  of `task-012` and leave the main Looma/Knit checkout dirty after a task was
  marked done. The shell tool now remaps project-root cwd requests into the
  current task worktree before execution, and we added focused shell tests for
  omitted cwd and nested project-root cwd cases. Batch proof stays paused until
  a fresh replay confirms the base repo stays clean.
- Batch proof then exposed the last real autonomy policy gap: freshly drafted
  `spec_review` tasks were intentionally excluded from the picker, so a
  continuous unattended run could intake multiple tasks but would park every
  one of them at “awaiting approval” forever. Normal drafted specs now route to
  the owning coordinator for approval/trim, while the reserved bootstrap tasks
  (`task-meta-intake` and `task-workspace-import`) still stay manual.
- Batch proof then exposed a review-packet truth bug on the second queued
  task: worker notes written with the live `implementer` role were being
  ignored by self-critique readers that only recognized `worker` /
  `implementation`. The review packet, acceptance-criteria reconciliation, and
  task API summaries now all treat `implementer` notes with explicit
  `Self-critique` content as valid worker self-critiques, so reviewer fan-out
  stops bouncing clean worker handoffs for a critique that already exists.
- Batch proof is now narrowed to one last throughput policy problem: for tiny
  single-file cleanups, the worker still defaults to broad repo-level
  verification (`pnpm -F web test`, full lint/typecheck/build) instead of a
  file-scoped proof. In Looma/Knit that means unrelated standing failures keep
  bouncing narrow tasks (`task-015`, and previously `task-014`) even after the
  target file is fixed, because the unattended lane still treats whole-app test
  health as authoritative for a one-line local cleanup.
- The next runtime pass now splits worker verification from hard gates. Narrow
  tasks with likely target files no longer inherit the broad repo-wide `test`
  fallback by default, and single-file test work now derives a focused
  `pnpm vitest --run <file>` command instead of `pnpm -F web test`. Hard gates
  at `gate_check` still keep the broader authoritative gate list.

- Reframed the coordinators UI around the actual product story. Settings →
  Coordinators now explains that coordinators are review lanes, not folders;
  spells out creation paths, current edit truth (`guildhall.yaml`), and the
  required `domain` vs optional `path` split. The Coordinators board now reads
  as live ownership: each lane shows domain, optional scoped path, a clearer
  “protects” summary, calmer task counts, and only a prioritized slice of
  domain tasks instead of dumping the whole history into each column.
- Tightened the spec-approval card button language. Those cards now use
  `Open task` and `Revise spec` instead of the mushier `Open` / `Change`
  pair, so their actions match the workflow vocabulary used elsewhere in
  Thread.
- Fixed the Thread phase-count chip tone so it matches the section state.
  Paused in-flight buckets no longer get a warn-colored count just because the
  underlying turns are still marked active in the data model; truly live work
  remains warn, while approval-paused sections can read as accent instead.
- Made the Thread card status chip less naive. Paused task cards no longer
  inherit a generic `now` badge just because the turn is still marked active;
  they now show `paused`, while active spec-review cards show `awaiting
  approval`.
- Cooled down paused checklist rows inside Thread task cards. Active checklist
  steps now read `Paused` instead of `Now` when the parent task has no live
  agent, and their status lights stop pulsing in that state.
- Made the Thread phase header tell the truth for paused work. When the whole
  `inflight` section only contains paused task cards with no live agent, the
  section label now reads `Paused` instead of the misleading `In flight`.
- Made the top-bar task-count chip stateful so it stops contradicting paused
  task cards. The count still tracks non-terminal work, but the label now
  reads `active` only while Guildhall is actually running; otherwise it reads
  `paused`.
- Tightened paused-task copy in Thread so the body text matches the action
  hierarchy. Cards now say things like `Work is paused. Resume work...` or
  `Gate checks are paused...` instead of the generic `Waiting for worker
  activity`, and task cards now consistently use `Open task` instead of the
  vague `Open`.
- Tightened the active-task CTA model in Thread. Paused task cards no longer
  default to the vague `Tell agent` path; they now use stateful resume actions
  like `Start work`, `Resume work`, `Resume review`, or `Resume gates`, with
  freeform guidance demoted to `Add note`.
- Restored the left rail's full-height behavior after simplifying the shell
  scroll model. The page still owns scrolling, but the rail now pins to the
  viewport below the global header with a full-height minimum again instead of
  collapsing to content height.
- Switched the Guildhall shell back to the simpler scroll model the user
  actually wants: the page scrolls, while the global header, left rail, and
  project topbar use sticky positioning. This removes the internal
  full-viewport shell assumptions that had been fighting the browser and makes
  the chrome behavior match a more normal document flow.
- Fixed the top-level app shell sizing that was still making the page a little
  too tall. The real overflow source was `Header + full-height ProjectView`
  stacked together, not missing `box-sizing`. `App.svelte` now owns the
  viewport height with a two-row shell, and `ProjectView` fills the remaining
  row instead of claiming another full viewport for itself.
- Simplified the topbar run controls again. `Start` and `Stop` now share the
  same primary button slot, and the overflow menu no longer duplicates visible
  actions like `New task` or `Stop`.
- Normalized the web shell height contract again after the toolbar refactor.
  The app already had global `box-sizing: border-box`, but `ProjectView`
  was still mixing `calc(100vh - 44px)` on the shell with `height: 100vh` on
  the sticky rail. The shell now uses a single `100dvh` viewport baseline,
  and the root app nodes are explicitly normalized to full height so we stop
  getting the annoying one-screen-plus-a-few-pixels overflow that lets the
  toolbar drift off-screen.
- Shrunk reclaimed worker prompts again by replacing the full markdown spec
  body with a clipped `Spec Overview` summary section while keeping the
  structured acceptance-criteria list separate below. This removes duplicated
  spec AC/out-of-scope prose from long task contexts.
- Tightened reclaimed worker context for noisy review loops. Context building no
  longer treats command-shaped backticks or wildcard test globs as exact likely
  target files, and worker task summaries now trim generic agent notes plus
  avoid duplicating giant reviewer prose in both `Latest Required Revisions`
  and `Agent Notes`.
- Blocked tasks no longer surface `spec_fill_pending` inbox nags. The spec-fill
  wizard now treats `blocked` / `shelved` as terminal for intake-completeness
  nudges, which removes stale "Missing product brief" noise from tasks that are
  already truthfully blocked for another reason.
- Pointed the live Looma/Knit project back at `openai-api` after DeepInfra
  billing was restored, replacing the stale project-local `llama-cpp`
  preference/model override that had been forcing Codex CLI fallback.
- `guildhall-automation-001` is complete.
- Added a design note for protocol-first provider abstraction and bounded queue
  throughput in `docs/design/provider-abstraction-and-throughput.md`.
- Seeded a matching Guildhall architecture backlog covering provider taxonomy,
  runtime normalization, capability manifests, shared client pooling, lane
  scheduling, and staged throughput proof.
- `guildhall-architecture-001` is complete: provider/setup docs and UI now
  speak in protocol families instead of treating LM Studio as a first-class
  provider concept.
- `guildhall-architecture-002` is in progress: shared provider metadata and
  preferred-provider family classification now exist in the runtime layer as
  groundwork for fuller status/routing normalization.
- `guildhall-architecture-002` now also drives a shared provider-status
  snapshot into `/api/project` and live run status, including provider family
  and label fields for preferred and active providers.
- `guildhall-architecture-002` is now complete: reviewer fanout resolves
  through the same provider-aware runtime policy in both orchestrator dispatch
  and provider status, so requested vs effective reviewer concurrency is
  normalized instead of guessed independently.
- `guildhall-architecture-003` is now complete: provider status carries a
  capability manifest for preferred and active providers, including
  streaming/tool-call support, resumability, reasoning-side-channel shape, and
  recommended concurrency.
- `guildhall-architecture-003` also uses those manifests for real routing and
  explainability:
  reviewer fanout is clamped through provider-aware policy, and structured
  routing decisions now explain why a provider was selected, rejected, or had
  its model assignment swapped.
- `guildhall-architecture-004` is now in progress: next step is replacing
  bespoke provider-client construction with a shared pool keyed by normalized
  runtime identity.
- `guildhall-architecture-004` has started landing in code: equivalent
  OpenAI-compatible and local-server runtime configs now reuse pooled clients,
  while resumable-session providers like Claude remain intentionally unpooled
  until we add session-aware pool semantics.
- `guildhall-architecture-004` now also has provider-health tracking at the
  pool boundary: pooled clients record recent success/failure state and
  consecutive failures, and the Project view can warn when a pooled provider
  has degraded.
- `guildhall-architecture-004` now also emits provider health into the live
  workspace runtime: pooled-provider health changes update active run status
  and appear on the event stream as `provider_health_changed`, so the UI can
  react without waiting for a full refresh cycle.
- `guildhall-architecture-004` now also makes degraded stateless clients
  operationally matter: after repeated retryable failures or a fatal failure,
  the next equivalent pooled acquisition recycles that client instead of
  reusing the same poisoned transport instance forever.
- `guildhall-architecture-004` is now complete: the shared pool handles
  stateless client reuse, provider-level concurrency limits, health tracking,
  live `provider_health_changed` events, and degraded-client recycling.
- `guildhall-architecture-005` is now complete: Guildhall resolves explicit
  spec/worker/review/coordinator lane settings, clamps them against dispatch
  capacity and provider policy, uses those budgets during task selection, and
  exposes the effective lane plan in provider status.
- `guildhall-architecture-006` is now in progress: next step is staged
  unattended-throughput proof on top of the bounded lane scheduler.
- Gate execution is now stricter than the model. When a task has an
  authoritative `current_task_success_gates` list, the `run-gates` tool
  reconciles or overrides stale model-supplied commands instead of trusting
  copied bootstrap/spec text. This closes the live bug where `task-006`
  reached `done` with `No projects matched the filters...` stored for
  typecheck/build even though the real `knit/web` commands passed.
- Worker recovery on Looma/Knit `task-011` is now stricter after malformed
  `write-file` calls: the query loop injects an immediate path-specific retry
  instruction after the first empty `write-file` payload instead of waiting
  for a second failure and only giving a generic "do not repeat that" nudge.
- Focused malformed `write-file` repair is now less brittle: the repair path
  feeds the prior tool error back into the retry prompt and lets the actual
  `write-file` tool recover alias-shaped inputs like `path` / `text` instead
  of rejecting them early in the query loop.
- Reclaimed worker turns now carry an explicit `Resume From Current Worktree`
  block listing the active task worktree and its changed files, and the worker
  prompt now tells resumed tasks to start from those changed files or the exact
  failing verification target before broad repo research. Live Looma/Knit
  replay confirmed one concrete improvement: `task-011` no longer reopens raw
  `MEMORY.md` on reclaim. The remaining blocker is narrower: the worker still
  spends too much early budget on test-layout discovery instead of immediately
  opening the changed worktree test file it already owns.
- Reclaimed worker context now also derives `Likely Target Files` from the
  task spec and automated verification commands, resolved against the active
  worktree when present. This gives tasks like Looma/Knit `task-011` a concrete
  source-file and test-file pair even when the worktree is clean, so the next
  live question is whether the worker starts from those exact files instead of
  root-level directory browsing.
- Repaired `task-006`'s stored Looma/Knit gate record so its persisted
  typecheck/build outputs now reflect the real `pnpm --dir web ...` commands
  that pass on `knit/main`, rather than the earlier stale filter-based output.
- `guildhall-architecture-006` now has a real stop-summary contract:
  unattended runs no longer just go idle and disappear; they can now report
  whether they stopped because the queue is all terminal, waiting on humans,
  blocked on escalations, dependency-stalled, or explicitly stopped.
- The paused shell now surfaces that stop summary directly in ProjectView, so
  operators can see why a run ended without digging through raw event lines.
- Hardened the live shell against stale run state: dynamic `/api/*` responses
  now send `Cache-Control: no-store`, the shared project/inbox fetches opt out
  of cache reuse, and the shared project store now ignores out-of-order refresh
  responses so a late "still running" fetch cannot overwrite a newer stopped
  snapshot.
- Did a shell clarity pass too: Thread copy is shorter, setup direction
  language is plainer, and paused-stop notices now summarize outcomes in
  operator language (`Run finished`, `Waiting on input`, `Blocked`) instead of
  echoing full orchestrator sentences with duplicated counts.
- Optional setup no longer masquerades as a blocker. In Thread, a setup phase
  made only of skippable steps now labels itself `Optional`, and skippable
  setup cards carry an explicit `optional` chip instead of reading like hard
  prerequisites.
- Low-severity policy cleanup is now quieter. `Do this next` ignores inbox
  items that are only low severity, so the home shell can go calm when the
  only remaining work is optional/project-policy housekeeping.
- Notifications now mirrors that calmer model: high/medium items stay in the
  main `Needs you` list, while low-severity items move to a separate
  `Housekeeping` section with a clear “nothing is blocked right now” state
  when only optional cleanup remains.
- Thread now defaults optional setup out of the way. When the only setup turns
  are skippable, the setup phase collapses by default so the first viewport is
  not dominated by advisory cleanup.
- Live Looma/Knit verification confirmed the backend stop summary on
  `/api/project` after unattended runs. Browser-use remains a noisy verifier
  for long-lived background refresh because its injected async fetch layer can
  error after the node-repl exec frame ends, so `guildhall-architecture-006`
  stays open until we prove the same behavior in a cleaner live browser pass.
- Seeded a fresh grounded Looma/Knit task for the next autonomy proof:
  `task-006` — `Add E2E login -> create page -> edit -> search flow`.
  This task is scoped to `/Users/matthew/git/oss/looma-knit/knit`, starts in
  `exploring`, and is meant to exercise the newly cleaned publication lane on
  a real product-facing happy path rather than another helper-only test.
- A new grounded Looma/Knit autonomy run exposed a different intake stall:
  the spec-agent had enough repo context and did use tools, but it spent too
  many turns on read-only research and then hit the max-turn limit without
  writing a brief, posting a question, drafting a spec, or raising a scoped
  escalation.
- Hardened the shared query engine against that failure mode. Roles can now
  declare "durable progress" tools; after repeated research-only tool turns,
  Guildhall injects a corrective nudge that tells the agent to stop
  researching and record a brief, question, spec, or escalation instead of
  drifting into turn-limit exhaustion.
- The spec-agent now uses that new guardrail and its prompt explicitly says
  that once repo evidence shows the task may already be partly or fully done,
  it must convert that evidence into a brief, focused question, remaining
  delta spec, or scoped escalation within the next turn or two.
- Preserved-progress hardening landed too: if a spec turn hits the max-turn
  limit after already writing durable task state, Guildhall now preserves that
  state instead of blindly escalating over it. Writing a spec from `exploring`
  without an explicit status now promotes the task to `spec_review`.
- Tightened startup session hydration so a fresh task no longer resumes an old
  pending spec conversation unless the persisted snapshot names the same task
  id. Live Looma/Knit restart confirmed the noisy `Resumed spec agent from
  prior snapshot` cross-task bleed is gone on a fresh task.
- Cold-start local-model reality check: even with the cross-task resume bug
  fixed, a fresh grounded Looma/Knit task (`task-006`) still hit the spec
  turn limit with no brief, question, or spec written. So the next bottleneck
  is no longer stale session contamination; it is the local model/provider
  path still failing to convert a real intake into durable output from a cold
  start.
- Live Looma/Knit proof advanced meaningfully: `task-008` reached `done`
  through Guildhall, but the remaining trust gap is still real gate truth.
  The workspace-root bootstrap snapshot says `no package.json`, while the
  task itself belongs to `/Users/matthew/git/oss/looma-knit/knit`, which has
  the real package manager and gate scripts. The next fix is to make
  `gate_check` derive authoritative gates from the task's own project path
  instead of blindly inheriting the outer workspace bootstrap block.
- Provider-scoped model resolution exposed another real config bug during the
  DeepInfra switch: if a workspace had exactly one provider-scoped model block
  left (for example only `llama-cpp`), Guildhall would wrongly reuse that lone
  block for an explicit different preferred provider. Fixed by making
  provider-specific resolution return empty when the requested provider has no
  matching block, instead of falling through to the sole unrelated entry.
- Root cause on `task-006` is now sharper: the cold-start local model *did*
  try to write durable progress, but it sent near-miss tool payloads like
  `append-exploring-transcript { item: ... }` and `update-product-brief
  { productBrief: ... }`. The next hardening slice is to make those tools
  recover from common nested/stringified payload shapes instead of rejecting
  them and burning the turn budget.
- That hardening landed, and a follow-up runtime guard now refuses repeated
  read-only research tool turns after Guildhall has already nudged the
  spec-agent to record durable progress. Fresh Looma/Knit intake `task-008`
  then reached `spec_review` on the NVIDIA provider in a single `one_task`
  pass.
- Remaining polish from that live pass: the fallback brief path was too happy
  to treat an evidence preamble ("Based on the grep results...") as the
  userJob. Tightened the inference to fall back to a cleaner verification /
  remaining-delta framing when the assistant prose is just narrating evidence.
- The next unattended-run blocker appeared immediately after that: once
  `task-008` moved from `ready` to `in_progress`, `/api/project` timed out
  while the worker was running. Sampling the live process showed the server
  blocked inside a synchronous child-process spawn from the shell tool.
- Fixed that by making the worker-facing `shell` tool run asynchronously via
  spawn instead of `execSync`, while leaving the bootstrap runner on its
  existing sync helper for now. The next live check is to confirm a running
  worker no longer freezes project/status API reads.
- DeepInfra/Qwen3.6 bring-up exposed one more shell-tool brittleness: the
  worker could issue a correct command but omit `cwd`, and the tool would fail
  before execution even though runtime context already knew the task project
  path. The shell tool now defaults `cwd` from the active tool context so
  real task runs do not die on that omission.
- Another live Looma/Knit review leak surfaced right after that: `task-005`
  had a good saved markdown spec with acceptance criteria, but its structured
  `acceptanceCriteria` array was empty, so deterministic reviewer fallback
  graded it like "no contract defined" and bounced verified work back to
  `in_progress`. Guildhall now derives criteria from `## Acceptance Criteria`
  in the saved spec when structured ACs are missing, and worker self-critique
  can reconcile against those derived criteria before fallback review runs.
- Fresh DeepInfra/Qwen3.6 intake on `task-009` surfaced a cleaner spec-lane
  contract bug: the model tried to post a structured user question with a
  natural `prompt` field, but `post-user-question` only accepted `body` and
  advertised an empty JSON schema, so the turn died and escalated. The tool
  now accepts `prompt` / `restatement` aliases and exposes the real argument
  shape to models.
- Notifications `Loading…` on Looma/Knit turned out to be a client-side crash,
  not a hung inbox endpoint. `/api/project/inbox` returned immediately, but
  InboxTab keyed rows by `kind + title`, and multiple escalations shared that
  tuple. Svelte threw `each_key_duplicate`, leaving Notifications stuck at
  Loading until refresh. Inbox row keys now include escalation/task identity,
  with a small web-lib regression test for duplicate-title escalations.
- The same pass exposed stale-shell caching during local restarts: after a
  successful rebuild/restart, the browser could still reuse an older
  `/web/app.js`, replaying already-fixed client crashes. The SPA shell and web
  assets now send no-store headers, and dashboardHtml appends a build-derived
  `?v=` stamp to `app.js` and `app.css` so fresh reloads pick up the actual
  current bundle.
- Notifications now reuses the shell's already-loaded inbox state instead of
  maintaining a second independent fetch lifecycle. Live Looma/Knit verification
  on `http://localhost:7844/notifications` now shows the real inbox rows
- Latest Looma/Knit proof on `task-008` got further again: review no longer
  collapses immediately into bogus persona dissent, and `/api/project` stays
  responsive during worker turns. The next truthful blockers are narrower:
  reviewer fallback still bounces already-verified work back to `in_progress`
  when provider 429s arrive before gate data exists, and the worker can still
  waste turns by narrating that a finished shell command might be "still
  running" and then calling `sleep`.
- That runtime slice is now fixed. Review fallback reconciles acceptance
  criteria from the latest worker self-critique and, on reviewer
  infrastructure failures, can advance already-verified work to `gate_check`
  instead of fabricating a worker revision. The worker no longer gets a
  `sleep` tool, so it cannot burn turns pretending a completed shell command
  might still be running.
- Fresh Looma/Knit proof on `task-008` confirmed the new behavior live:
  `review -> gate_check via reviewer-deterministic-fallback`. The remaining
  blocker moved one lane later: `gate-checker-agent` still hard-fails the run
  on NVIDIA `429 Too Many Requests`, leaving the task correctly parked in
  `gate_check` but stopping the one-task run with an agent-error outcome.
- Gate-check backoff is now being hardened the same way: retryable provider
  throttling during `gate_check` is being converted from a generic agent-error
  into a resumable provider-backoff state so one-task runs stop honestly while
  preserving `gate_check` as the source of truth.
- Fresh Looma/Knit rerun from `gate_check` finished cleanly: `task-008` reached
  `done` in a one-task run on the NVIDIA path. So the immediate review →
  gate-check → completion proof now exists for a real grounded task, even
  though the project still needs better explicit gate truth than the current
  empty-root bootstrap fallback.
  immediately, with `Loading…` gone and the repeated escalation titles rendered
  safely.
- `guildhall-automation-003` is now complete in the live Looma/Knit flow. The
  spec lane preserves durable progress after turn-limit churn, answered intake
  questions no longer strand a task in `exploring`, and grounded `task-006`
  moved from a fresh ask through structured questioning into `spec_review`
  without manual queue cleanup.
- Review handoff is stricter now too: when the only remaining unmet acceptance
  criteria are automated hard-verification steps, Guildhall bypasses persona
  review churn and hands the task straight to `gate_check` instead of treating
  runnable verification as implementation debt.
- `guildhall-automation-005` is now complete too. Grounded Looma/Knit
  `task-006` ran in a dedicated task worktree on `knit/`, replayed through
  narrowed task-scoped gates, and recorded a successful local ff-only merge
  back to `main` without manual PR bookkeeping.
- The next staged-throughput pass exposed two honest blockers on fresh
  Looma/Knit tasks: worktree setup treated untracked `.guildhall/` repo-local
  state as a dirty subrepo, and spec-agent max-turn recovery still escalated
  even when the assistant had already written enough plain-text brief/question
  content to preserve.
- Both are now hardened. `NodeGitDriver.isClean()` ignores untracked
  `.guildhall/` bookkeeping while still treating real source changes as dirty,
  and spec max-turn recovery now salvages the latest assistant prose more
  defensively, persists fallback brief/question state before escalation, and
  recognizes "my read ..." preambles where the actual user job lives on the
  following bullet.
- Live replay immediately found the next qualitative gap: the fallback brief
  path could still fossilize agent research narration like "let me check the
  worktree" as the task's `userJob`. Tightened inference so research/audit
  chatter is ignored for brief authorship while preserving any structured
  question cards from the same turn.
- Fresh staged-throughput replay now gets meaningfully farther live: `task-010`
  and `task-011` both reached `spec_review`, both were approved into `ready`,
  and `task-010` was claimed into a real worker worktree with concrete edits to
  `web/tests/unit/shared/subdomain.test.ts`.
- The new blocker is the worker-side analogue of the old spec-turn problem:
  `task-010` hit the worker turn limit after making real file edits, but
  Guildhall still escalated it straight to `blocked` instead of preserving that
  durable code progress for review or resumable revision. `task-011` was
  claimed next, so the queue itself is moving; the durability gap has simply
  shifted from spec-intake to worker completion.
- Worker-side turn-limit preservation is now implemented and test-covered. If
  an `in_progress` task hits the worker turn limit but its task worktree is
  already dirty with real code edits, Guildhall preserves the task in
  `in_progress` instead of escalating immediately to `blocked`.
- Live Looma/Knit replay now shows that worker preservation fix paying off:
  `task-010` resumed from its old blocked state, finished the subdomain test
  expansion, passed its scoped Vitest run and typecheck, and handed off into
  `review` instead of getting trapped by the old turn-limit path.
- The next honest gap is reviewer durability. A reviewer can emit a real
  plain-text verdict without successfully calling `update-task`, which used to
  leave the task stuck in `review`. Guildhall now preserves that reviewer note
  and applies the deterministic review decision so the queue keeps moving.
- The next staged-throughput blocker is inside reviewer fanout itself. A
  persona reviewer was able to hang inside a bare `agent.generate()` call with
  almost no operator visibility, which left the whole one-task run parked in
  `review` despite the worker having already completed real work. Persona
  fanout calls are now bounded by a per-persona timeout and convert timeout
  hangs into infrastructure-only revise verdicts, so fanout can fall through to
  the single-reviewer path instead of freezing the review lane forever.
- Live replay then exposed the same class of hang one step later: once fanout
  fell through, the single reviewer path still had no wall-clock timeout around
  the main `generateWithEvents()` turn. The core dispatch path now applies a
  per-agent turn timeout, treats `timed out after ...ms` as infrastructure-like
  reviewer failure, and lets deterministic fallback absorb a hung reviewer turn
  instead of leaving `task-010` silently parked in `review`.
- The next gate-truth issue turned out to be command-shape drift, not product
  code failure. `task-010` still carried the common `pnpm --filter @knit-app
  test -- <file>` shape, which expanded back out to unrelated suite failures.
  Task-scoped gate normalization now rewrites that form into direct single-file
  Vitest runs, and `run-gates` persists its hard-gate results back onto the
  task immediately.
- Live Looma/Knit proof: `task-010` now completes cleanly end to end. Review
  reaches `gate_check`, the authoritative gates run as `pnpm --dir web
  typecheck`, `pnpm build`, `cd web && pnpm vitest --run
  tests/unit/shared/subdomain.test.ts`, and `pnpm lint`, all four pass, and
  the task transitions `gate_check -> done` with recorded gate results.
- The next live task (`task-011`, use-presence lifecycle tests) is now the
  active throughput proof. It is no longer stuck in setup or intake; the worker
  is actively reading the composable, existing test patterns, and Nuxt/Vitest
  environment before writing the new unit test file.
- Thread column width now uses a real target width again. The column had been
  using `max-width: 680px`, which let it shrink unexpectedly; it now uses
  `width: 680px; max-width: 100%` so desktop stays stable while smaller
  viewports still collapse safely.
- `guildhall-architecture-003` now also uses those manifests for a real routing
  decision: provider capability policy can clamp reviewer fanout to a safe
  effective concurrency, and the UI surfaces that adjustment as an info notice
  instead of a vague warning.
- Workspace import now defaults to a single-project interpretation and only
  preserves subproject scope when multiple top-level project roots are clearly
  present.
- Importer heuristics now filter migration-guide/spec-template/group-header
  junk, keep explanatory planning bullets as context, and fuzzily dedupe
  near-identical tasks from the same planning file.
- Live Looma/Knit draft improved from `677 / 583` to `312 / 219`
  (`inputSignals / drafted`).

## Current 20-Item Push List

- [x] Preserve the latest meaningful assistant prose across later tool-only turns.
- [x] Stop empty tool-only assistant turns from wiping `last_assistant_text`.
- [x] Let `append-exploring-transcript` recover from `{}` using runtime metadata.
- [x] Let `post-user-question` recover from `{}` using runtime metadata.
- [x] Teach `post-user-question` to infer structured choice payloads from prior assistant prose.
- [x] Verify inferred `post-user-question` payloads can post multiple questions in sequence.
- [x] Teach fallback question parsing to handle simple `Pick one: X or Y` prose.
- [x] Teach fallback question parsing to split numbered questionnaire prose into multiple `choice` cards.
- [x] Teach fallback question parsing to handle markdown-headed numbered sections.
- [x] Stop gating fallback question creation on narrow phrase matching when structured drafts are inferable.
- [x] Auto-persist plain spec-agent exploring prose into the exploring transcript.
- [x] Add a fallback `productBrief` draft when spec-agent prose clearly states a “best read/guess”.
- [x] Teach fallback brief parsing to understand “my read of this task title” phrasing.
- [x] Normalize bulleted “my read” lines so fallback brief inference still works.
- [x] Verify live Looma/Knit runs now preserve transcript plus structured questions after sloppy tool turns.
- [x] Verify a live Looma/Knit run now preserves both a drafted brief and a structured question.
- [x] Reduce over-batching when the inferred questionnaire is too broad for a first intake turn.
- [x] Make spec-agent question inference prefer the highest-signal 1-3 questions instead of 6-8.
- [ ] Add an explicit live/browser check that Thread renders the inferred brief and question cards coherently.
- [ ] Re-run a real Knit task from intake toward implementation using the hardened exploring flow.

## Pass Checklist

1. Setup
   - Walk first-run setup in the browser.
   - At each step, ask what a new user would know, what they would not know,
     and whether the next action is obvious.
   - Verify provider detection, restart banners, and meta-intake status reflect
     real state.

2. Project spec
   - Run or resume meta-intake.
   - Verify it detects `t-minus-t` as a VSCode extension for converting
     on-disk JSDoc JavaScript into in-view TypeScript and back.
   - Confirm coordinators, bootstrap, levers, and project brief match the repo.

3. Workspace import
   - Review detected goals and tasks.
   - Verify imported README bullets do not duplicate title/rationale.
   - Verify imported TODO comments do not become worker-ready tasks without
     spec-agent shaping.

4. Task setup
   - Use Thread to guide Guildhall toward tasks covering TypeScript features.
   - Try direct Thread replies/tool-like commands when the provided card does
     not fit the need.
   - Verify user answers immediately change visible project/task state.

5. Execution and completion
   - Push at least one task through intake, spec review, ready, worker,
     review, gates, and done when feasible.
   - At each transition, verify Thread, drawer, Work, and Notifications agree.
   - Check that "done" means a concrete repo change plus passing verification,
     not just an agent claim.

6. Reset rule
   - If the test project state becomes too tangled to reason about, stop and
     request action-time confirmation before deleting Guildhall state files.
   - Candidate reset files are expected to be under
     `/Users/matthew/git/oss/t-minus-t/guildhall.yaml`,
     `/Users/matthew/git/oss/t-minus-t/.guildhall/`, and
     `/Users/matthew/git/oss/t-minus-t/memory/`.

## Findings So Far

- Workspace import previously inserted imported TODO comments as `ready`
  tasks. That made Thread show "Agent is working" for vague TODO crumbs before
  the spec agent had shaped them. Fixed by importing candidates as
  `exploring`.
- `resume` previously appended a message but did not reliably move a task back
  into spec-agent intake. Fixed so a human reply on a non-terminal task returns
  it to `exploring`.
- Thread single-question replies staged an answer behind a separate footer,
  which felt like "Send did nothing." Fixed so a single active question submits
  immediately; multi-question batches still stage and submit as a group.
- Thread in-flight cards now expose a direct "Tell agent" action so the user
  can correct or redirect the agent without opening the drawer.
- While meta-intake was running, Thread still marked the next setup step as the
  active turn and showed the meta-intake card as "next." Fixed by making
  remaining setup turns pending while the reserved meta-intake task is active.
- Meta-intake asked "Pick all that apply" using a `choice` question, but the
  UI behaved like single-select. Fixed AgentQuestion to switch to multi-select
  when the prompt asks for all/select all/all that apply.
- After answering meta-intake questions, Thread showed the task as shaping but
  the top Start button stayed disabled because bootstrap was incomplete. Fixed
  ProjectView so the reserved meta-intake task can resume the orchestrator even
  while bootstrap is still blocking ordinary work.
- Answering a question while the orchestrator was also writing `TASKS.json`
  corrupted the file with trailing bytes. Fixed the hot runtime/task answer
  write paths to use atomic replace writes, and repaired the test workspace
  `TASKS.json`.
- Agent questions displayed raw Markdown in prompts (`**converter-core**`).
  Fixed AgentQuestion to render prompts/restatements through Markdown.
- Meta-intake kept interviewing coordinator-by-coordinator and repeatedly hit
  the max-turn limit instead of drafting. Tightened the seed prompt: draft
  from repo evidence by default, ask at most two questions, and avoid
  one-question-per-coordinator mandate collection.
- Resetting project-local Guildhall state while role sessions still existed in
  `~/.guildhall/data/sessions` caused meta-intake to resurrect an old draft and
  present it as fresh output. Fixed by refusing meta-intake session recovery
  from snapshots older than the newly seeded meta-intake task.
- The spec agent could still load an old same-workspace role session and
  regenerate the stale draft. Fixed by adding a per-project `memory/.session-epoch`
  namespace to role session ids; deleting `memory/` now creates fresh agent
  sessions.
- The setup identity endpoint kept stale initialized state when files were
  deleted while `guildhall serve` was still running. Fixed by refreshing the
  project before handling setup identity writes.
- In-progress work looked static unless the user already knew the orchestrator
  was running. Added a shared pulsing status light for live agent work without
  animating the whole card.
- Coordinator review copy assumed the user knew what a coordinator was. Fixed
  the Thread and setup review cards to explain that coordinators route future
  tasks to specialists and review work in their area.
- Agent-question cards rendered agent ids and slug choices directly. Fixed the
  UI to display friendly role names and title-cased choice labels, and updated
  meta-intake instructions to ask about project areas/review lanes instead of
  "coordinator domains".
- Multiple-choice question cards were visually weak and treated labels as raw
  strings. Fixed choices to render as full-width selectable rows with
  title/detail treatment, markdown formatting, and a clear selected state.
- "Coordinator" was still Guildhall jargon. Added `guide.coordinators` as a
  docs-backed help topic, wired the circled question-mark help icon into
  coordinator review cards, and lengthened the copy to explain review lanes,
  routing, reviewers, and autonomous handling.
- The task drawer's "Spec fill" checklist answered what the agent was doing,
  but Thread only showed a vague in-flight summary. Thread now projects the
  spec-fill wizard into the in-flight card as live-updating title,
  description, brief, and acceptance-criteria steps.
- Internal ids leaked into user-facing cards (`goal-...`, `task-import-...`,
  `_meta`, `_workspace_import`). Fixed the first visible pass by hiding raw ids
  on Workspace Import and task cards, formatting reserved domains as friendly
  labels, and switching newly generated import ids to compact deterministic
  hashes instead of title-length slugs.
- Native `title` popups are not enough for collapsed navigation. Added a
  reusable `Tooltip` component and wired the collapsed left rail plus docs help
  icons through it.
- Project direction copy sounded like agents start from nothing unless the user
  writes the perfect paragraph. Softened the step copy and prefilled an editable
  draft from README context when no saved direction exists.
- Workspace Import still showed "Approve & import" after approval. Fixed the
  imported state to show "Imported findings" and hide the approval actions.
- Thread thought setup was complete because the reserved meta-intake/import
  tasks counted as the first user task. Fixed first-task progress to ignore
  reserved system tasks, then created a real first task for the TypeScript
  round-trip workflow.
- Pressing Start after that looked inert: the orchestrator started, ran
  bootstrap, and stopped because the test project build failed. Fixed the shell
  and Inbox to surface the failed bootstrap gate from `memory/bootstrap.json`
  instead of leaving the user to infer it from a stopped run.
- Ready still made the blocker harder to act on: it hid command output, skipped
  to policy levers in the "Do this next" banner, and read provider status from
  a non-existent endpoint. Fixed Ready so it shows llama.cpp as configured,
  shows the failed command output inline, labels the bootstrap action "Run
  again", and suppresses lower-priority nudges while the top inbox item is
  already the current page.
- After bootstrap passed and Start worked, the run still looked inert during a
  long spec-agent model call because the supervisor only emitted an event after
  the agent returned. Added `agent_started` / `agent_finished` lifecycle
  events and taught Thread to show "Model call in progress" immediately.

## Verification Log

- `pnpm vitest run src/runtime/workspace-import/__tests__/hypothesis.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/intake.test.ts`
  passed: 3 files, 60 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing Svelte warnings.
- After the spec-agent hit its step budget, `/api/project` 500ed because
  `memory/TASKS.json` contained a complete JSON object followed by an
  interleaved duplicate tail. Patched TASKS-writing agent tools to use
  `atomicWriteText` instead of direct `fs.writeFile` so concurrent tool writes
  cannot leave partial/interleaved task state.
- Repaired the local `t-minus-t/memory/TASKS.json` by removing the duplicate
  tail after the first complete JSON object; `node -e "JSON.parse(...)"` now
  succeeds and `/api/project` returns again.
- `pnpm vitest run src/tools/__tests__/product-brief.test.ts src/tools/__tests__/task-queue.test.ts src/tools/__tests__/escalation.test.ts src/tools/__tests__/report-issue.test.ts src/tools/__tests__/proposal.test.ts`
  passed: 59 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing Svelte warnings.
- Browser walkthrough exposed another in-progress clarity gap: after Start,
  `agent_started` was emitted but Thread still showed only the active brief
  approval card, so a user could not tell the spec agent was in a model call.
  Added `liveAgent` to brief/question turns and render the same pulsing
  "Model call in progress" line on active interaction cards.
- `pnpm vitest run src/runtime/__tests__/serve-providers.test.ts src/runtime/__tests__/wire-events.test.ts`
  passed: 29 tests.
- `pnpm build` passed again with existing Svelte warnings.
- Provider deep-dive found `OpenAICompatibleClient` had no timeout around the
  OpenAI-compatible `/chat/completions` fetch. Added a 5-minute request timeout
  that reports `OpenAI-compatible API timed out after 300s` instead of leaving
  Guildhall in an indefinite model call.
- `pnpm vitest run src/providers/__tests__/openai-client.test.ts` passed: 14
  tests.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing Svelte warnings.
- `pnpm docs:extract-help` generated `guide.coordinators` in
  `src/web/generated/help-topics.json`.
- `pnpm vitest run src/runtime/__tests__/serve-meta-intake.test.ts` passed: 9
  tests.
- `pnpm vitest run src/runtime/workspace-import/__tests__/hypothesis.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/serve-meta-intake.test.ts`
  passed: 45 tests.
- Browser check at `/planner` showed friendly task card labels ("Workspace
  import", "Setup") with no raw task ids or underscored domains.
- Browser check at `/workspace-import` showed no visible goal/task ids and an
  imported state without the stale "Approve & import" action.
- Restarted linked `t-minus-t` server on `http://localhost:4177`; loaded build
  `2026-04-25T16:01:48.399Z`.
- Browser check at `http://localhost:4177/thread` showed the active intake card
  with the pulsing status light beside the `NOW` badge.
- Browser walk reached fresh setup, provider selection, meta-intake questions,
  multi-select answers, direct Thread guidance, and orchestrator resume.
- Current state after deterministic meta-intake fallback: `task-meta-intake`
  is done, five coordinator roles are merged, and Thread is on the active
  setup step "Give the project direction".
- `pnpm vitest run src/runtime/__tests__/wizards.test.ts src/runtime/__tests__/serve-wizards.test.ts`
  passed: 28 tests.
- Browser check after the first-task fix showed Thread on "Seed the first
  task"; submitting the TypeScript round-trip task created `task-003` in
  `exploring` with a live Spec Fill checklist.
- Direct `/api/project/start` returned running, then the run stopped after the
  bootstrap gate failed. Reproduced the underlying project failure with
  `pnpm run build` in `t-minus-t`:
  `src/customEditorProvider.ts(6,8): error TS2307: Cannot find module 'ts-jsdoc-sync'`.
- Repaired the local test project's converter package metadata so
  `ts-jsdoc-sync` resolves. Build and tests now pass, but bootstrap is still
  blocked by lint because `packages/extension` calls `oxlint` and the tool is
  not installed.
- Browser check at `/settings/ready` now shows New Task disabled as "Fix the
  bootstrap failure before adding tasks", LLM provider as `llama-cpp`, inline
  failed-output detail for `pnpm run lint`, and no lower-priority policy-lever
  banner above the active bootstrap failure.
- User approved adding the missing lint dependency. Added `oxlint` to
  `packages/extension`, reran Guildhall bootstrap through the app endpoint, and
  all bootstrap steps passed: install, build, test, lint.
- Browser check at `/thread` after Start now shows "Spec author is working on
  this now" and "Model call in progress" while `task-003` is inside the
  spec-agent LLM call.
- The model call later exhausted its step budget and restarted without making
  visible spec progress. Root cause found: `guildhall.yaml` still referenced
  default `qwen2.5-coder-*` role models while LM Studio only had
  `qwen/qwen3.6-35b-a3b` loaded. Patched Guildhall so saving LM Studio copies
  the loaded model into the workspace role assignments, and Start now fails
  fast if LM Studio does not have the configured project model loaded.
- `pnpm vitest run src/runtime/__tests__/serve-providers.test.ts` passed: 18
  tests, including the new model mismatch preflight.
- Browser walkthrough exposed a choice-question bug: the spec question asked
  "which of these should support?" but rendered as "Pick one"; clicking the
  first option immediately answered and removed the question. Added explicit
  `selectionMode` support to agent questions, taught the spec-agent prompt to
  say `selectionMode: 'multiple'` for pick-all choices, and added a UI fallback
  so older "which of these should..." prompts render as multi-select.
- Live Looma/Knit testing exposed a stale transcript problem: `Transcript`
  could show old `Added acceptance criterion: ...` notes that no longer matched
  the task's canonical `acceptanceCriteria`. Fixed the drawer endpoint to
  filter specifier acceptance-note echoes against the live criteria list.
- Thread updates lagged during active work because the surface only refreshed
  on coarse lifecycle events. It now also reloads on `tool_started`,
  `tool_completed`, `line_complete`, and `error`, which makes review bounces
  and verifier failures show up fast enough to trust.
- Review feedback could stay visually "in flight" even after a newer hard
  verifier failure had become the more important operator signal. Thread now
  demotes stale review-feedback cards once a later danger-level activity exists
  for the same task, letting the failed verifier output dominate the active
  card.
- Review/gate/adjudication bounce paths could return a task to `in_progress`
  without restoring `assignedTo='worker-agent'`, which encouraged no-op retry
  loops and prevented clean worker session resume. Fixed every bounce path to
  restore worker ownership before persisting the task.
- `pnpm typecheck` passed.
- `pnpm vitest run src/runtime/__tests__/serve-providers.test.ts src/core/__tests__/models.test.ts`
  passed: 40 tests.
- `pnpm build` passed with existing Svelte warnings.

## Resume Notes

- Continue from the browser at `http://localhost:4177/`.
- Current test workspace state:
  - `task-meta-intake` is done.
  - Five coordinator roles are present in `guildhall.yaml`.
  - Project direction was saved from Thread.
  - Workspace Import was approved: 0 tasks, 6 goals, 1 milestone.
  - `task-003` is the first real task and is still in spec intake.
  - Bootstrap is passing after adding `oxlint`.
  - Orchestrator run status is running, with `task-003` inside a spec-agent
    model call at the time of this checkpoint.
- Before resetting `t-minus-t`, ask for explicit confirmation and list the
  exact files/directories to remove.
- After source changes, run `pnpm build` in Guildhall before testing the linked
  package from `t-minus-t`.
- Next likely check: wait for the spec-agent call to finish. If it remains
  stuck, check whether LM Studio is actually generating tokens for the loaded
  model. The app now catches model-id mismatches before starting.
- The accidental "Primitive types" answer on `task-003` was corrected via
  `/api/project/task/task-003/answer-questions`: primitives, union types, array
  types, object literal types, and generic types; arrow functions left out for
  a later task. The run was restarted and Thread now shows "Model call in
  progress" on the active brief card while the spec agent is inside LM Studio.
- The latest run ended in `error` after the spec agent exhausted its 8-step
  budget again; with TASKS.json repaired, restart the server on the rebuilt
  Guildhall before continuing.
- Live Looma/Knit cleanup: deleted stale false-positive human-input tasks
  `task-003`, `task-004`, `task-006`, and `task-007` from `memory/TASKS.json`,
  removed their exploring transcripts, and filtered their stale history from
  `memory/PROGRESS.md` and `memory/recent-events.jsonl` so Notifications stops
  surfacing bogus `Needs you` work.
- Fixed another false-positive inbox path: `brief_approval` now only surfaces
  while a task is still in intake (`exploring` / `awaiting_human`), so `review`
  and `done` tasks with an old draft brief no longer pollute Notifications.
- Fixed review/gate assignment normalization at the task-queue write boundary:
  tasks moved into `review` now default to `assignedTo='reviewer-agent'`, and
  tasks moved into `gate_check` default to `assignedTo='gate-checker-agent'`,
  which prevents finished worker tasks from getting stranded in `review` under
  `worker-agent` ownership.
- Hardened the worker's revise-followup loop: the task context now surfaces a
  dedicated `Latest Required Revisions` block from the newest reviewer note,
  and the worker prompt explicitly treats concrete reviewer change requests as
  binding unless it raises a spec conflict. This targets the live `task-009`
  failure where the worker kept re-verifying finished code instead of adding
  the missing tests the reviewer requested.
- Deterministic review now treats “all ACs met, no hard gates yet” as a
  handoff to `gate_check` instead of a fake revise loop back to the worker,
  which let Looma/Knit `task-009` move past the old review dead-end.
- Startup session hydration now skips same-task snapshots when the task has
  been updated more recently than the saved session, which stopped worker and
  reviewer lanes from reviving stale conversations after human resets.
- Deterministic review handoffs now normalize ownership too: approved review
  passes assign `gate-checker-agent`, and revise outcomes assign
  `worker-agent`, so `gate_check` no longer strands under reviewer ownership.
- Live Looma/Knit proof is now blocked by truthful project gate state rather
  than orchestration confusion: `task-009` reached `gate_check`, ran the real
  test gate, and escalated because the workspace-wide `pnpm test` suite has
  unrelated pre-existing failures outside the task's scope.
- `guildhall-automation-004` is now actively on the narrow gate-truth fix:
  when a task carries explicit automated acceptance-criteria commands,
  Guildhall now treats those commands as the authoritative hard gates for that
  category and only falls back to broader project defaults for categories the
  task did not specify. That lets `task-009` keep its targeted callback test
  gate instead of regressing to the broader repo test suite by default.
- Follow-on hardening for `guildhall-automation-004` is now partly landed too:
  pnpm-based automated gate commands are normalized before use, including
  `pnpm <script> --filter ...` reordering and single-child-package fallback to
  `pnpm --dir <pkg> <script> ...` when the filter token does not resolve.
  Rerun hygiene is now better too: an unresolved escalation stops counting as
  active once the task has clearly moved forward after it was raised and is no
  longer blocked, so stale gate escalations stop freezing reruns or inflating
  `Needs you` / `stuck` UI surfaces. The remaining live blocker is command
  trust: some agent-authored automated commands still need runtime validation
  against the repo layout before they should be treated as authoritative hard
  gates.
- The next command-trust slice is now in place too. When a pnpm `test` script
  is really just `vitest`, and an automated gate carries a unique file token
  like `login-callback-index.flow.test.ts`, Guildhall now rewrites the hard
  gate to the exact single-file Vitest invocation that the repo actually
  honors. That keeps task-scoped callback gates from silently widening back
  into the whole test suite.
- Latest live blocker is narrower now: the gate checker can finish the real
  targeted test work, but `update-task` was still failing when the model
  omitted `taskId`. Guildhall now lets `update-task` infer
  `metadata.current_task_id`, matching the rest of the task tools, so review
  and gate turns can persist state without having to restate the active task
  id perfectly.
- Live Looma/Knit proof moved again in the good direction: after the
  `update-task` metadata fix and the gate-command freshness checks, `task-009`
  replayed from `gate_check` and reached `done` in a single fresh `one_task`
  run on DeepInfra Qwen 3.6. The saved gate results now reflect the real
  narrowed task contract: `pnpm --dir web typecheck`, `pnpm build`, a direct
  single-file Vitest run for `login-callback-index.flow.test.ts`, and
  `pnpm lint`.
- The next autonomy gap is now explicit instead of implicit: Looma/Knit is not
  currently allocating task branches/worktrees, so `task-009` reached `done`
  without any merge/publication record. Guildhall now records a
  `mergeRecord.result = skipped` entry whenever a task finishes while merge
  dispatch is unavailable because worktree isolation or branch metadata never
  existed, so the shell stops implying that PR/merge automation already ran.
- The real multi-repo publication bug is now fixed too. Looma/Knit’s workspace
  root is not itself a git repo — `knit/` and `looma/` are. Guildhall now
  routes worktree setup, base-branch lookup, merge dispatch, and worktree
  cleanup through the task’s effective project repo instead of always using
  the workspace root, so subproject tasks can actually reach the branch/merge
  lane they belong to.
- Publication truth is tighter now too: when worktree isolation is enabled but
  the target repo already has uncommitted changes, Guildhall now stops before
  minting a task worktree and surfaces a clear repo-dirty error instead of
  silently blending prior local edits into a supposedly autonomous task run.
- The current unattended-throughput slice is now targeting worker file authoring
  resilience. `write-file` no longer hard-fails immediately on common
  near-miss payloads like nested `{ item: { path, text } }` calls, and when a
  worker still emits `write-file {}` after inspecting a source file, the tool
  now returns a concrete likely target path plus the exact `{ filePath,
  content }` call shape required. This is meant to unstick Looma/Knit
  `task-011`, where the worker had enough repo context to write
  `use-presence.test.ts` but fell off the tool contract instead.
- That file-authoring resilience now covers malformed `edit-file` turns too.
  Guildhall will do one focused file-mutation repair after `edit-file {}` and
  can recover either into a valid `edit-file` call or a whole-file
  `write-file` call when that is the safer move. Live Looma/Knit replay also
  proved that likely-target normalization is better now: a `web/app/...`
  source hint plus a bare `tests/...` command now resolves to `web/tests/...`
  instead of the repo root. The remaining blocker is more behavioral than
  pathing: once the worker opens the right `web/` source and test surfaces, it
  still burns extra discovery/listing turns before mutating the file.
- Resume dispatch is sharper now too. For `in_progress` worker turns with
  likely target files, the orchestrator injects an explicit `Immediate Resume
  Instructions` block into the actual dispatch prompt: open or edit those
  exact files first, and if a likely target file does not exist yet, create it
  at that exact path instead of searching for alternate directories. Live
  Looma/Knit replay confirmed the worker now reads the exact missing
  `web/tests/unit/composables/use-presence.test.ts` path before any broader
  listing. The next blocker is narrower again: after confirming the target
  file is missing, the worker still falls back to `list-files`/`glob` instead
  of creating it immediately.
- The next repair slice hardened that authoring boundary further. Focused
  `write-file` repair now carries the prior tool error, the exact likely
  target path, and recent read-file hints, and it runs under a short dedicated
  timeout instead of quietly consuming the whole worker turn budget. The
  LLM-facing `write-file` schema now also advertises `filePath` and `content`
  as required, while the backend still accepts alias-shaped recovery payloads
  when a model gets close but not quite right.
- Live Looma/Knit replay on `task-011` crossed a real threshold after that
  change: the worker no longer only dies in the `write-file {}` trap. Once it
  had re-read the exact source and test target, it eventually emitted a real
  `write-file` call with concrete `filePath` + `content`, and the query loop
  stayed alive instead of timing out immediately. The remaining blocker is now
  a later-step worker loop: once the test file exists and has been inspected,
  Guildhall still needs a cleaner handoff from “I know what is wrong” to
  “finish the rewrite and hand off for review,” instead of cycling
  `in_progress` turns around the same file.
- The next replay removed another source of drift: `write-file` target
  inference now prefers `current_missing_likely_target_file` and
  `current_task_likely_target_files` before any project-root heuristics, so
  repair prompts no longer fall back to `/knit/web/...` when the task is
  actually working inside `/knit/.guildhall/worktrees/task-011/...`. Focused
  tests now lock that behavior in. Live Looma/Knit replay on `task-011`
  matched the healthier shape: the worker reopened the exact worktree source
  and exact worktree test target, and it did not regress to the old repo-root
  write suggestion. The remaining blocker is now cleaner still: worker
  continuation can end a step after rereading the right files without yet
  taking the concrete mutation step.
- The next repair slice hardened the no-tool path after those exact-file
  rereads. When a reclaimed worker has already inspected the exact likely
  target file and still replies without a tool call, Guildhall now replaces
  the generic nudge with a stricter mutation-or-escalation demand: the next
  response must be exactly one tool call and no prose, either a concrete
  `edit-file` / `write-file` mutation or an explicit `raise-escalation`.
- The worker loop now also refuses to silently absorb repeated no-op reclaimed
  turns. For in-progress worker tasks with likely target files, two
  consecutive passes with no transition, no note, and no worktree edits now
  produce a structured escalation instead of another invisible in-progress
  loop. Focused `run-query` and `orchestrator` coverage are green, so the
  next live Looma/Knit replay for `task-011` should either mutate the test
  file or surface a truthful stuck reason instead of quietly spinning.
- Live replay answered the next question: `task-011` now reaches a concrete
  failing test diagnosis instead of wandering, but DeepInfra Qwen can still
  burn the whole worker turn after that diagnosis and die as a timeout.
  Guildhall now converts that specific resumed-worker timeout shape into a
  structured escalation when the task still has likely target files and no
  visible worktree edits, so the next run should stop as “worker is stuck”
  rather than a vague `agent-error`.
- The next repair closed the worktree-isolation leak that showed up once
  `task-011` finally emitted a real `write-file`. `write-file` and
  `edit-file` now reconcile near-miss absolute paths back onto the
  authoritative likely target file from task metadata, so a model that tries
  to write `/knit/web/tests/...` after working inside
  `/knit/.guildhall/worktrees/task-011/...` is snapped back into the task
  worktree instead of mutating the main repo. Focused file-tool tests now
  lock that behavior in, and a fresh Looma/Knit replay on the rebuilt server
  proved the execution-time behavior: the worker still requested the main-repo
  `.../knit/web/tests/unit/composables/use-presence.test.ts` path, but
  Guildhall completed the `write-file` against
  `/knit/.guildhall/worktrees/task-011/web/tests/unit/composables/use-presence.test.ts`.
- The next worker-tempo slice now stops intra-turn read-only churn earlier.
  After Guildhall has already refused exact-target read-only exploration twice
  in the same worker pass, `runQuery` now ends that turn immediately instead
  of continuing to donate model budget until a timeout. Focused `run-query`
  and orchestrator coverage are green. A fresh live replay attempt on
  2026-05-05 was blocked before it could exercise the new loop because the
  DeepInfra-backed provider returned HTTP 402 (`positive balance` required),
  so the next live proof needs provider credit or a different provider.
- The next live proof switched Looma/Knit to prefer `llama-cpp`, but the
  local server did not have the assigned model loaded, so Guildhall
  truthfully fell back to `codex-oauth`. That replay proved two useful things:
  `task-011` still mutated the real worktree test file, and the next blocker
  is no longer path drift or provider balance. It is worker-side verification
  command truth: after the edit, the worker still asked `shell` to run stale
  `pnpm --filter @knit-app test` commands that do not match the task worktree
  package layout.
- Closed that verification-command truth gap under one shared abstraction.
  Authoritative task-scoped success gates now live in a reusable helper used by
  both `run-gates` and `shell`, and `in_progress` worker prompts now surface
  those same normalized commands explicitly. That means one stale worker shell
  turn can no longer slip back to `@knit-app` filter commands after gate-check
  has already learned the correct `web`-scoped shape. Focused shell,
  run-gates, and orchestrator regressions are green; the next live Looma/Knit
  replay should answer whether `task-011` now clears verification instead of
  ending on empty-assistant/provider weirdness.
- Live Looma/Knit replay answered that question well. On `task-011`, the worker
  no longer ran `pnpm --filter @knit-app test`; it executed the normalized
  `cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts`
  command and surfaced a real failure in the task worktree test file:
  `~/app/composables/use-presence` did not resolve under Vitest. The worker
  then fixed that import path inside the worktree test file and continued.
- The next blocker is now a policy/instruction bug, not command truth. After
  making the valid test-only fix, the worker later escalated because Guildhall's
  stricter resumed-worker lane demanded mutation of the exact likely target
  source file (`web/app/composables/use-presence.ts`) or escalation, even
  though the real progress path was still test-only. The next repair slice is
  to distinguish “must mutate one of the likely target files” from “must mutate
  that exact source file,” so valid test-only progress is not turned into a
  false decision_required escalation.
- That policy repair is now live-verified. After resolving the old false
  escalation and replaying `task-011`, the worker no longer escalated about
  needing to edit `use-presence.ts`. It stayed on the valid test-only path,
  reran the normalized focused Vitest command, and exposed the next honest
  blocker: the worktree test still bootstraps enough Nuxt/Vite app context to
  fail on a missing `@looma/vue` import from `SidebarContent.vue` before test
  collection. So the next repair slice is no longer worker orchestration. It
  is deciding whether Guildhall should install/provide that dependency in the
  task worktree or let the worker isolate the unit test runner/setup so the
  file can execute without full app bootstrap.
- That supposed `@looma/vue` bootstrap blocker turned out to be a bad Knit
  unit-test harness, not another Guildhall runtime gap. The worktree test was
  importing `~/app/composables/use-presence` (a path Vitest/Nuxt does not
  expose), and its mock/setup path never mounted the composable inside a real
  Vue setup context. Reworking the test onto the repo's `mockNuxtImport(...)`
  pattern and a mounted harness made the focused command pass cleanly:
  `cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts`.
  The next live replay for `task-011` should now tell us whether the worker can
  continue through review/gates instead of stalling on a phantom environment
  problem.
- The next replay exposed a second, more systemic multi-repo worktree bug.
  `task-011` still blocked inside its task worktree because Knit's
  `link:../../looma/packages/vue` dependency no longer resolves once `knit/`
  is nested under `.guildhall/worktrees/task-011/`. Manually adding the sibling
  anchor `knit/.guildhall/worktrees/looma -> ../../../looma` made the exact
  worktree command pass, proving the root cause. Guildhall now creates these
  sibling repo anchors automatically for nested multi-repo worktrees, so
  cross-repo `link:` dependencies keep the same shape they had in the original
  workspace. Focused `worktree-manager` coverage and a fresh Guildhall build are
  green. The next live replay should show `task-011` getting past worker
  verification instead of re-raising the same stale harness/environment block.
- The next replay got past that nested worktree dependency failure and exposed
  a smaller, meaner runtime gap: after real worker edits and successful focused
  verification, some providers can start returning empty assistant replies
  during checkpoint/review handoff. Guildhall now lets the orchestrator inspect
  worker carryover metadata and preserve that state as resumable in-progress
  work when the task already has dirty worktree edits plus handoff evidence,
  instead of collapsing into a fake hard failure just because the provider
  ghosted during the last mile.
- The next real review blocker is evidence shape, not worker execution. Reviewer
  fanout was bouncing `task-011` because it could only see narrated self-report,
  not a real packet with changed file content. Guildhall now writes live review
  packets at `review`/`gate_check`, including changed-file summaries, numbered
  file excerpts, the latest self-critique, and the latest checkpoint, and it
  injects that packet into reviewer context so reviewers can inspect the actual
  task artifact instead of asking the worker to re-describe its own diff.
- Empty-provider last-mile flakiness now leaves a durable worker checkpoint
  behind instead of only a vague resumable state. When a worker has already
  produced dirty-worktree edits plus verified-work handoff evidence and then
  starts returning empty assistant replies, Guildhall writes a recovery
  checkpoint with the changed files and next planned action before preserving
  the task in `in_progress`. If the worker already raised a real blocker and
  the provider ghosts immediately afterward, Guildhall now still writes that
  checkpoint before leaving the task's `blocked` state intact. Focused
  `orchestrator` regressions and a fresh build are green. The next live
  Looma/Knit replay should tell us whether that checkpoint discipline is enough
  to get `task-011` cleanly back into review, or whether the next real blocker
  remains broader verification truth around unrelated repo-red files.
- The next replay clarified that blocker: `task-011` is repeatedly surfacing a
  broader `pnpm --dir web typecheck` failure in unrelated file
  `web/app/composables/use-presence.test.ts`, then rediscovering that as a
  fresh human decision on the next worker turn. Guildhall now injects the most
  recent resolved escalations directly into task context as
  `Resolved Human Decisions To Honor`, with explicit guidance not to reopen
  those questions unless new evidence appears in the same touched files or
  verification scope. Focused `context-builder` coverage and a fresh build are
  green. The next live replay should tell us whether that scoped decision now
  actually sticks inside resumed worker turns instead of reappearing as false
  `Needs you` work.
- That scoped decision is now sticking better, and the next blocker moved
  again. On the fresh Looma/Knit replay, `task-011` no longer bounced straight
  back into the same unrelated typecheck escalation; it stayed in `review`.
  Guildhall also now recognizes review-ready worker prose with verified
  evidence as a handoff problem instead of a “you must mutate again” problem,
  and the worker followed that nudge by issuing a real `update-task` call on
  the live run. The remaining flake is later: the provider can still ghost
  immediately after that handoff tool call, so the next repair slice is making
  post-handoff empty replies stop reading like active run churn when the task
  is already durably in `review`.
- That post-handoff slice is now in too. Empty assistant replies are no longer
  allowed to trigger deterministic reviewer fallback first when the task is
  already durably in `review`; Guildhall now preserves the review state before
  that fallback can bounce the task back into a bogus revise loop. It also
  normalizes ownership to `reviewer-agent` when review was still carrying a
  stale worker assignee. Focused `orchestrator` coverage and a fresh build are
  green. The next live replay should tell us whether the stop summary now reads
  as a calm preserved review state instead of an `agent-error`.
- Fresh Looma/Knit replay moved the live blocker again. The old
  post-handoff-review ghost path no longer dominates: `task-011` now lands on a
  real reviewer revision about `any` usage in the new test file and returns to
  `in_progress` with concrete feedback. The remaining runtime noise is lower in
  the stack now: after that legitimate bounce, the worker can still drift into
  read-only retry churn while addressing the revision. So the next repair slice
  is resumed-worker revision discipline, not review-handoff truth.
- Review ownership truth now holds even while Guildhall is paused. The
  orchestrator normalizes stale `review` ownership before picking lanes, and
  the serve layer also repairs persisted `review + worker-agent` rows when
  `/api/project` or `/api/project/task/:id` reads `TASKS.json`. Live
  Looma/Knit verification on `task-011` now shows `status: review` together
  with `assignedTo: reviewer-agent` in both endpoints without needing another
  tick to clean it up. That clears one more misleading UI/runtime state leak;
  the next honest blocker is still resumed-worker revision discipline after a
  legitimate reviewer bounce.
- The next live replay pushed `task-011` one stage farther: it finally cleared
  review and reached `gate_check` on Codex fallback. That exposed the next
  missing handoff rule. Guildhall had already persisted the hard gate results,
  but a gate-checker prose verdict could still leave the task churning in
  `gate_check` instead of converting those saved results into a durable status
  transition. Guildhall now treats fresh hard gate results as authoritative in
  that lane too: all-pass auto-completes to `done`, any hard-gate failure
  bounces back to `in_progress`, and stale `gate_check` ownership is
  normalized onto `gate-checker-agent` in both orchestrator and serve reads.
- The next blocker after that was finally the real scoped-decision leak:
  `task-011` kept failing `pnpm --dir web typecheck` on unrelated stale file
  `web/app/composables/use-presence.test.ts` even after the human had already
  resolved that broader repo-red was out of scope for this task's changed
  target. Guildhall now classifies that exact gate shape as a scoped exception
  when three conditions all hold: the failure paths do not touch the task's
  likely target files, the failing hard gate is the authoritative typecheck
  lane, and the task already has a resolved human decision explicitly keeping
  unrelated repo-red out of scope. Focused orchestrator coverage now locks
  that behavior in before the next live Looma/Knit replay.
- Live Looma/Knit replay on the fresh build confirmed the new rule: after
  resolving the stale `max_revisions_exceeded` escalation back to `gate_check`,
  `task-011` replayed once and went `gate_check -> done` in a single tick.
  The gate-checker still narrated the broad typecheck failure in its prose, but
  the orchestrator now correctly treats that failure as a scoped exception
  because it only touched unrelated file
  `web/app/composables/use-presence.test.ts` while the task target remained
  `web/tests/unit/composables/use-presence.test.ts`.
- The next cleanup slice pushed that scoped-exception rule down into the
  tool/runtime boundary itself. `run-gates` now receives the same resolved
  scope-decision context as the orchestrator and reports a scoped unrelated
  typecheck failure as an effective pass instead of a generic hard failure.
  That keeps the gate-checker model from being handed contradictory evidence in
  the first place and aligns tool narration with the orchestrator's final lane
  decision.
- The next spec-intake slice closed a quieter but real leak: once a spec-agent
  had already used transcript/file tools, a later no-tool reply that only said
  "I'll draft the spec now" could still end the turn because the generic
  no-tool nudge only applied before the first tool call. The query loop now
  detects future-step planning prose and reissues the same durable-step demand
  even after earlier tools ran, so planning narration has to turn into
  `update-task`, `update-product-brief`, `post-user-question`, or
  `raise-escalation` instead of silently ending intake. Focused `run-query`
  coverage is green, and the live Looma/Knit server is restarted on the fresh
  build while `task-007` now sits in truthful `spec_review`.
- Spec-review ownership now tells the truth while paused. A task waiting for
  human spec approval should not still claim `worker-agent`, so both the
  orchestrator normalization pass and the serve-layer task reader now clear
  stale `assignedTo` values on `spec_review`. Focused orchestrator coverage is
  green, and live Looma/Knit verification shows `task-007` at
  `status: spec_review` with `assignedTo: null` on the fresh build.
- Terminal task ownership now tells the truth too. Older Looma/Knit rows were
  still surfacing `worker-agent` or `gate-checker-agent` on `done` tasks even
  though no active lane owned them anymore. Guildhall now normalizes
  `done`/`blocked`/`shelved` tasks to `assignedTo: null` in both the
  orchestrator queue-normalization pass and the serve-layer task reader, and
  the task schema now accepts that paused/terminal truth instead of insisting
  on a string owner. Focused orchestrator coverage is green, and live
  Looma/Knit readback now shows every `done` task with `assignedTo: null`.
- Spec approval now reads as a paused approval state in the UI, not fake live
  activity. Task cards no longer treat `spec_review` as an active lane just
  because the orchestrator is running, and the Coordinators view now counts
  those tasks separately as `awaiting approval` instead of rolling them into
  the active total. The fresh Looma/Knit browser build is up on port 7844.
- The top-bar task indicator now matches that same truth. `spec_review` no
  longer inflates the `N active` chip in ProjectView; approval-paused work is
  counted separately as `awaiting approval`, alongside any real `active` and
  `stuck` counts.
- The top-bar inbox badge now counts actionable notifications, not only
  high-severity alarms. Medium-severity items like spec approval remain visible
  in the header even when nothing is on fire; the badge stays danger-colored
  for high severity and drops to warn-only when the outstanding action is
  medium.
- Approval-paused wording is now aligned across the remaining browser surfaces.
  `spec_review` now renders as `Awaiting approval` in the shared status label,
  the Thread card headline, the escalation resume picker, and the Release tab
  empty state, so the paused lane no longer flips between `review` and
  `approval` language depending on which surface the operator is looking at.
- `/api/project` and `/api/project/inbox` now read from the same inbox snapshot
  builder, including the same workspace-import self-healing path and blocker
  flags, so the main project payload no longer drops inbox state while the
  dedicated inbox endpoint still shows it. Hardening this also surfaced a raw
  task-read edge: `activeEscalations()` now treats missing `escalations` arrays
  as empty instead of throwing, which keeps lighter or older TASKS rows from
  crashing the project shell.
- Ready-state Thread cards now behave like queue cards instead of pseudo-chat.
  When a task has been approved into `ready` with no live agent yet, Thread now
  says it is approved and queued, offers `Start work` as the primary action,
  demotes freeform follow-up to `Add note`, and labels the secondary nav button
  `Open task`. This directly fixes the post-approval confusion where the card
  still looked open but made `Tell agent` the default next action.
- The project header now uses a clearer action hierarchy instead of just
  wrapping everything. Status and provider chips stay visible, `New Task` is a
  compact `+` affordance, `Start` / `Stop` remain the obvious main run control,
  and lower-frequency actions like `Finish one` move into an overflow actions
  menu so the header reads more like a product and less like a crowded control
  panel.
- Worker file-mutation discipline is tighter now. When a live coding task
  already has authoritative file-tool context (active worktree and likely
  target files), shell commands that try to write file contents directly via
  redirection / heredocs / tee are blocked and redirected back toward
  `write-file` / `edit-file`. Shell stays available for builds, tests, lint,
  and other focused verification, but the worker can no longer slide from a
  correct worktree file write into “let me rewrite that file through shell
  instead.”
- Agent-turn timeouts are now inactivity-based for streaming turns instead of
  hard wall-clock kills. If DeepInfra (or another provider) is still emitting
  assistant deltas or tool activity, Guildhall resets the turn timer and lets
  the agent keep working. A timeout now means “no streamed activity arrived
  for the configured interval,” which is a much truer signal than “the whole
  turn lasted longer than N ms.”
- Worker turns with real dirty-worktree progress no longer disappear as
  “no change” just because the model failed to move status on the same pass.
  When a worker finishes a turn, leaves verified work metadata behind, and the
  task worktree is dirty, Guildhall now writes a recovery checkpoint and bumps
  the task timestamp even if the task remains `in_progress`. That gives the
  queue a durable trace of progress instead of pretending the turn was empty.
- Agent request sampling is now role-aware instead of silently inheriting
  provider defaults. Guildhall threads an explicit optional temperature through
  the engine/provider contract, uses conservative defaults by role
  (`spec/coordinator=0.2`, `worker=0.1`, `reviewer/gate=0.0`), and only emits
  it on provider paths that actually support it today (OpenAI-compatible and
  Claude). Codex keeps its existing tuned default behavior for now.
- Context debug snapshots now record the effective temperature alongside the
  model id, so when a lane gets weird later we can distinguish “provider/model
  issue” from “sampling issue” without reconstructing runtime defaults from
  source.
- The first live DeepInfra split-model replay exposed a file-tool truth bug,
  not a model-availability one. `task-007` really did reclaim under
  `worker=Qwen/Qwen3-235B-A22B-Instruct-2507`, reached shell verification, and
  wrote progress far enough to attempt a review handoff. The real failure was
  that write/edit path reconciliation treated a file path already inside the
  task worktree as if it still needed project-root remapping, which created a
  bogus nested `.guildhall/worktrees/task-007/...` target and confused the
  review guard about whether the worker had touched the real file.
- The same live replay also showed the task-scoped verification command needed
  one more normalization pass. `pnpm --filter @knit-app test --
  tests/unit/composables/use-collections*.test.ts` was being rewritten into a
  shell command that still left Vitest with a fuzzy glob, which in practice
  ran far more of Knit's suite than intended. Task-gate normalization now
  expands wildcard test targets into explicit file arguments, so the worker and
  gate lanes can run the concrete `use-collections` unit files instead of
  widening into unrelated component/server failures.
- Inbox truth is tighter again for live tasks. The low-severity `spec_fill`
  wizard no longer applies once a task has moved into `in_progress`, `review`,
  or `gate_check`, so Looma/Knit tasks like `task-007` stop showing bogus
  `Missing product brief` nags while real worker/reviewer work is already in
  flight. Intake/approval stages still keep the spec-fill nudges.
- Reviewer-lane evidence is now visible from the same live API payload the UI
  already reads. `/api/project` task rows and `/api/project/task/:id` now
  derive `latestReviewerSummary`, `latestSelfCritique`, and
  `latestCheckpoint` from the newest reviewer/self-critique notes plus the
  per-task checkpoint file, so a Looma/Knit replay that bounces `task-007`
  back out of review can be diagnosed from the served task payload instead of
  digging through raw `memory/TASKS.json` and `checkpoint.json` by hand.
- That same review packet is now visible in the browser instead of living only
  in the API. Task cards can show the latest reviewer bounce or next
  checkpoint action inline, and the drawer Spec tab now renders a `Latest
  handoff packet` card with the newest reviewer summary, self-critique, and
  checkpoint details. When `task-007` churns again, the operator can inspect
  the current handoff packet from the queue and drawer without leaving the app.
- Reviewer-fanout summaries now separate actual requested changes from reviewer
  availability failures. Persona timeouts / 429-style infra misses are still
  preserved for audit, but they land in a `Reviewer availability notes`
  section instead of inflating the `Aggregated revisions from N personas`
  headline. That keeps the next `task-007` review bounce from reading like
  five distinct code-change asks when some of the noise is really provider
  flakiness.
- Review-packet generation itself is less likely to undersell valid worker
  evidence now. The packet treats `implementation` notes that contain a real
  self-critique as review evidence, and changed-file rendering filters out
  obvious command-shaped junk paths left over from earlier resume/write bugs.
  That should stop `task-007`-style replays from getting bounced for “no
  self-critique” or bogus command-path diff entries when the worker actually
  did the right thing.
- Fresh-task proof is finally cleaner now. `task-007` has been shelved as a
  contaminated regression fixture, a new `task-012` Supabase type-generation
  task can start from a fresh worktree again after cleaning the dirty `knit`
  base repo, and the next honest blocker is narrower: the spec-agent was still
  able to churn on repeated read-only tool calls after the intake research
  budget was exhausted. `runQuery` now ends the turn after repeated
  intake-budget refusals instead of looping forever on the same refusal.
- The same fresh-task replay exposed one more intake escape hatch and we
  tightened that too. After Guildhall has already demanded durable intake
  progress, `append-exploring-transcript` alone no longer counts as a viable
  next step; `runQuery` now ends the turn if the agent tries to use a
  transcript-only carryover after a durable-progress nudge. In parallel,
  `update-product-brief` now accepts the common near-miss shape where
  `antiPatterns` arrives as one multiline string, normalizing it into the
  expected array instead of bouncing the brief update.
- Reclaimed worker context is now sharper for fresh-task replays. `task-012`
  already had a real checkpoint on disk after successfully falling back from
  local `pnpm db:types` to `pnpm db:types:remote`, but the injected resume
  packet was still abstract enough that the worker's first move on reclaim was
  `read-tasks`. Context assembly now surfaces the latest checkpoint as its own
  block, folds checkpoint `filesTouched` into Likely Target Files, and the
  worker prompt explicitly says not to reread `TASKS.json` on the first resume
  turn when the checkpoint already names the next step. The next live replay
  should tell us whether that turns the first reclaimed step into focused
  verification/mutation instead of queue rehydration.
- The next live `task-012` replay proved that checkpoint-first reclaim is
  working. The worker now resumes straight into `pnpm db:types`, sees the
  expected local Docker failure, and falls back to `pnpm db:types:remote`
  without rereading queue state. After that, Guildhall now refuses pure
  read-only follow-up turns using the checkpoint's own next action as the
  reason, which is better than letting the worker silently spiral. The next
  blocker is one layer later: the worker is still choosing the wrong post-
  generation move and burning against the checkpoint guard instead of turning
  that checkpoint into a concrete verification or code change.
- Provider header copy is a bit more honest now for split-model experiments.
  When the live run has different models assigned by role, the top bar no
  longer shows the worker model as if it were the whole runtime; it now says
  `Mixed models`, with the per-role breakdown still available in the provider
  tooltip/details text. That keeps the DeepInfra A/B setup from looking like a
  single-model run when spec/worker/reviewer lanes are intentionally split.
- Checkpoint-directed worker reclaim is less blunt now. If a checkpoint's next
  action is exploratory, Guildhall still refuses broad read-only drift, but it
  now permits `read-file` on the checkpoint-touched files themselves before
  demanding the next focused verification or mutation step. That gives task-012
  just enough room to inspect the exact generated-types surfaces without
  reopening repo-wide search.
- Relative checkpoint file paths now reconcile against the task's real repo
  root/worktree instead of the Guildhall process cwd. That closes the Looma/
  Knit mismatch where `task-012` could ask for `web/app/types/supabase.ts`
  after `db:types:remote`, but `read-file` would resolve it against the parent
  workspace and fail before the worker ever reached the actual generated file.
- Fresh bounded `task-012` replay shows the center of gravity has moved again.
  The path/root mismatch is no longer the loudest failure. The worker is still
  choosing broad `grep` probes after `db:types:remote` instead of taking the
  now-permitted exact-file `read-file` step, so the remaining blocker is
  checkpoint-follow-through behavior, not file-tool rooting.
- Tightened checkpoint-follow-through on reclaimed worker turns. When a worker
  drifts into broad read-only search after an exploratory checkpoint, the first
  refusal now appends a strict one-tool follow-up demand that names an exact
  checkpoint file to read next. Fresh bounded `task-012` replay proved the
  change is doing useful work: after `db:types:remote`, the worker finally
  opened the exact generated `web/app/types/supabase.ts` file instead of
  grepping the repo again.
- Chunk 2 has started in the worker-handoff lane. Recovery checkpoints are no
  longer limited to dirty worktrees; if a worker has real verified progress but
  no dirty diff (for example, successful generation/verification plus an exact
  inspected file) Guildhall now preserves that progress with a recovery
  checkpoint instead of acting like the turn had no durable value.
- Fresh bounded `task-012` replay on the latest build completed the chunk-2
  proof. After the tightened checkpoint-follow-through, the worker advanced
  from generated Supabase types to the exact `use-workspace.ts` surface, then
  wrote a new recovery checkpoint and bumped the task timestamp even though the
  task remained `in_progress`. The live blocker has moved again: worker
  follow-through is now specific to when read-only checkpoint steps trip the
  generic research-budget refusal logic, not to whether progress gets preserved
  at all.
- Fresh `task-012` replay after the reclaim fixes exposed the next precise
  worker-handoff leak. When a non-exploratory checkpoint already says "write
  the self-critique and hand off to review", the worker still tends to start
  with a reflexive `read-file`. Guildhall now distinguishes that handoff-shaped
  checkpoint from exploratory ones and appends a stricter one-tool nudge that
  demands an `update-task` self-critique note (or escalation) instead of
  letting the turn stall on a generic "don't read more" refusal.
- Fresh `task-012` replay then proved the worker was really writing the
  self-critique, but the live API/review packet still failed to surface it
  because those derivations only accepted `role: self-critique` or
  `implementation`. Guildhall now recognizes worker-authored notes whose
  content is explicitly labeled `Self-critique`, which made the live
  `/api/project` and `/api/project/task/:id` payloads line up with the actual
  task state again.
- The next live blocker moved one step later: after persisting self-critique
  and a review-handoff checkpoint, the worker could still satisfy the handoff
  loop by writing another checkpoint instead of flipping the task to `review`.
  Tightening that loop let the latest bounded replay move `task-012` back into
  real `review` on the fresh build. The remaining throughput gap is now in the
  reviewer reclaim lane: the task is visible as a reclaim candidate, but the
  reviewer turn is not yet being resumed cleanly from that paused `review`
  state.
- The top toolbar action cluster has been re-normalized around one button
  system. On wide screens `New task` is a labeled secondary action again,
  `Start` / `Stop` stays the primary control, and the overflow trigger is now
  a proper ellipsis icon button with a circular active state instead of the
  mismatched sliders/chevron hybrid. The left/right header content is also
  vertically centered again.
- Reviewer fanout is now explicitly task-bounded. Persona reviewers are told
  to anchor blocking findings to unmet ACs, changed files, or scope violations
  only; broader architecture/perf/API ideas must be emitted as non-blocking
  follow-ups instead of forcing a revise. The aggregate revision packet now
  preserves those follow-up ideas in a separate section so the worker can see
  them without treating them as required for task acceptance.
- Worker handoff now asks for an explicit minimum-scope self-review before
  `review`: list files changed, answer whether the diff is the smallest useful
  change, and name anything that should be reverted before review. That pushes
  scope-trimming back onto the worker instead of leaving reviewers to police
  avoidable extras after the fact.
- Thread review-feedback cards no longer inline the full reviewer packet as a
  giant wall of Markdown. The card now stays compact: short revision summary,
  pass count, and an `Open task` affordance that sends the user to the drawer
  where the full handoff packet already lives.
- Task worktrees now inherit runtime dependency directories when Guildhall
  creates them and when it reuses an older worktree. The worktree manager
  mirrors root `node_modules` plus nested package-level `node_modules` (like
  `knit/web/node_modules`) into the task worktree so bounded worker runs can
  execute `typecheck` / `vitest` without failing on missing local runtime
  dependencies.
- Fresh task-012 proof is healthier now. After the worktree runtime-link fix
  and a task-local `use-workspace.ts` typing cleanup, the live Looma/Knit
  replay ran `db:types:remote`, passed focused `typecheck`, persisted a new
  self-critique, and moved task-012 back to real `review` on the fresh build.
  The worker-side blocker is no longer dependency setup or handoff amnesia; the
  next throughput gap is reviewer-lane reclaim / verdict quality on that fresh
  task.
- Worker no-progress nudges are now a little smarter around review handoff
  checkpoints. When the latest checkpoint already says "set status to review",
  Guildhall no longer falls back only to the generic "make durable progress"
  message after extra non-progress turns; it can now nudge the worker toward
  the exact `update-task { status: "review" }` handoff step instead.
- Concurrency is now less knob-happy in the live product path. Reviewer fanout
  auto-derives from the active provider's recommended capacity by default,
  instead of requiring a project-local `reviewerFanoutConcurrency` tweak. The
  Looma/Knit override was removed, the live `/api/project` payload still
  reports reviewer fanout `4/4` on DeepInfra, and the top-bar/provider payload
  no longer emits config-clamp chatter for concurrency tuning.
- Blocked Thread cards no longer dump raw reviewer novels. Escalation details
  are now compacted in the thread projection into one short blocker sentence
  plus reviewer-timeout count, and the card copy explicitly points the user to
  `Open task` for the full packet. Live Looma/Knit thread payload for
  `task-012` now reads as a compact blocker summary instead of the full
  aggregated markdown blob.
- Coordinators now have a cleaner drill-in path. `Settings -> Coordinators`
  explains the model and source of truth, `/coordinators` shows live lane
  ownership, and `/coordinators/:id` no longer needs to repeat the selected
  lane as both a policy panel and a second board column. The detail route now
  focuses on lane policy plus a scoped `Tasks in this lane` stack so the flow
  reads like a real detail view instead of a duplicated board.
- `ProjectView` now tracks route props reactively instead of holding onto
  stale "initial" sub-route values. That closes a real live-shell bug where a
  coordinator detail route could render the policy drill-in at the top while
  still leaking the old all-lanes board branch lower on the page.
- Layering now follows shared z-index tokens instead of component-local magic
  numbers. Shell chrome, banners, popovers, drawer overlays, and modals all
  now map onto one explicit order in `src/web/tokens.css`, which fixes cases
  like the stale-server alert bleeding through an open task drawer.
- Release focus is now explicitly narrowed to start-to-finish automation.
  Product/UI follow-ups like coordinator-detail polish, broader overlay sanity
  sweep, and task-drawer information hierarchy are intentionally tabled in
  favor of proving fresh-task throughput end to end.
- Reviewer-lane ownership truth is now healthier on fresh tasks. Resolving an
  escalation back to active work no longer leaves `in_progress` tasks orphaned
  at `assignedTo: null`; escalation resolution plus serve/orchestrator
  normalization restore the correct active assignee before the next dispatch.
  Live Looma/Knit replay pushed `task-012` through review and into
  `gate_check`, which moved the next honest blocker downstream into hard-gate
  truth instead of reviewer reclaim mush.
- Hard-gate scope exceptions now generalize beyond `typecheck` to broader
  task-scoped repo red. Guildhall now classifies gate kind from the real gate
  payload instead of trusting friendly ids like `test`, so authoritative
  gate-check runs with generic ids like `gate-3` can still exempt unrelated
  repo-red `test`/`lint` failures when they are outside the task's likely
  target files. This closes the live Looma/Knit failure where `task-012`
  reached `gate_check` but broad unrelated `pnpm -F web test` failures still
  blocked the task despite being outside the actual Supabase-types change set.
- Live proof: after replaying `task-012` on the fresh build and resolving the
  final escalation back to `gate_check`, Looma/Knit now completes the task in
  one bounded tick: `gate_check -> done via gate-checker-agent`. The task ends
  terminal with `assignedTo: null`, no open escalation in inbox, and the broad
  unrelated `pnpm -F web test` failure preserved only as raw gate evidence
  instead of blocking the bounded Supabase-types task.
- Terminal/publish truth is now explicit in the served task contract. The
  API derives a concise terminal summary from each task's `mergeRecord`, so
  done/pending-PR cards can say whether the task merged locally, pushed,
  opened a PR, or skipped merge, and the drawer Provenance tab now exposes
  the full terminal outcome record for audit.

- Worker review handoff now ends the turn cleanly after a durable lane-exit status update instead of reapplying mutation nudges to the old lane. Added run-query metadata for lane handoff completion and a regression that covers `task-015` style worker -> review transitions with likely-target context.
- Live fresh-build proof: with the lane-exit handoff fix in place, a bounded Looma/Knit replay took `task-015` from `review` to `gate_check` to `done` in one run. The worker no longer kept orbiting after a durable `update-task { status: "review" }` handoff, reviewer fanout reclaimed the task, and gate-check completed under task-scoped rules.
- Batch-proof follow-through exposed one last worker-verification authority leak on fresh `task-016`: the worker prompt already had narrower task-scoped verification commands, but shell reconciliation was still deriving authority from broad hard gates. Guildhall now loads `current_task_verification_commands` into tool metadata and shell authority prefers that list over `current_task_success_gates`, so narrow cleanups stop drifting into whole-app verification during `in_progress` while hard gates remain authoritative later in `gate_check`.
- Fresh `task-016` replay proved the worker-side verification clamp: the worker stayed on task-scoped `lint`/`typecheck`/`build` verification instead of falling into broad `pnpm -F web test`. The next truthful blocker was reviewer spillover on a one-line cleanup, so reviewer fanout now demotes broad standards-only asks (versioning, idempotency, observability, boundary validation) into non-blocking follow-up ideas when the reviewer itself says the task already meets the functional acceptance criteria and the remaining feedback is rubric spillover rather than a task-local regression.
- Persona reviewer instructions now carry a much stronger pragmatism contract. Reviewers are explicitly told to ask whether the diff actually made the code worse, left the stated job undone, or introduced a new meaningful risk before blocking; to treat pre-existing imperfections in touched files as follow-up ideas unless the task explicitly asked to fix them; and to distinguish internal first-party routes from true public API contracts so small local changes do not trigger doctrinal versioning/idempotency/platform-ceremony demands.
- Persona reviewer language is now less absolutist: reviewers are told they are not the final project owner, to avoid decree phrasing like "what must change", and to frame revise feedback as recommended task-local revisions for coordinator/project-owner judgment rather than persona-level commandments.
- Persona reviewer ownership boundaries are now explicit in the prompt: each expert is a contributor to the decision, not the sole decision maker, so acceptance judgment belongs to the coordinator/project-owner layer even when a persona sees a legitimate concern in its lane.
- Reviewer output is now shifting toward a lighter ADR-style frame: recommended task-local revisions, concrete risk if accepted as-is, and non-blocking follow-up ideas. The goal is to preserve expert trade-off thinking without turning every persona comment into a pseudo-order or a full architecture record.
- Persona review output now also supports a small advisory scoring block: recommendation priority, expected value if taken, and risk if deferred. These scores are explicitly from the persona's perspective and are meant to help the coordinator weigh trade-offs, not to let any one expert dictate the final call.
- The drawer review packet now surfaces persona advisory scoring as colored pills instead of leaving those rankings buried in markdown prose. Each reviewer section can show priority, expected value, and deferred risk at a glance while preserving the full underlying narrative below.
- [x] Runtime: demote broad reviewer doctrine on narrow cleanup tasks when it does not overlap the task itself.
  - Added task-aware reviewer demotion hints so one-file cleanup tasks no longer let versioning/idempotency/observability/boundary-validation sermons block unless they actually overlap the requested change.
  - Kept direct task-overlap findings blocking, so a reviewer can still stop the task when the actual cleanup was not applied.
- Reviewer/gate adjudication now share the same scoped hard-gate worldview. Deterministic review accepts a task-scoped context (`projectPath`, likely target files, resolved scope decisions) and credits `no-regressions` when the only hard-gate failures are unrelated repo-red already exemptable by gate-check policy. This closes the logic gap where review could bounce a tiny cleanup for `gate-3` before the gate adjudicator ever got a chance to apply the scoped exception.
- Live Looma/Knit replay after that change showed the old deterministic blocker disappearing: `task-016` no longer re-escalated on `Deterministic review: ... failing signals: no-regressions`. The next failure family is sharper now: the latest LLM reviewer note explicitly approved the task and called the unrelated test failures non-blocking, but the persisted review transition still landed as `review -> in_progress`.
- Added a guard for that new contradiction: when an LLM reviewer note contains an explicit structured verdict (`**Verdict:** Approved` / `Revise`), Guildhall now trusts that verdict over an ambiguous status transition when recording the review result and normalizes the post-review state accordingly. Focused tests pass, but the live `task-016` specimen still needs a clean fresh replay on the new build to fully prove this family end to end because the current task state was already carrying the pre-fix contradictory review record.
- Live proof: on the fresh Looma/Knit build, `task-016` now replays cleanly from `in_progress -> review -> gate_check`, and the persisted reviewer records are truthful: the latest fan-out pass lands as `approve`, the task status stays `gate_check`, and `assignedTo` becomes `gate-checker-agent` instead of bouncing back to `worker-agent`. This completes the reviewer-approval normalization family.
- Live proof: the follow-on gate-check family is also now complete on the same fresh replay. `task-016` proceeded from `gate_check -> done`, preserved the unrelated broad `gate-3` web-test failure as raw gate evidence, applied the scoped gate-check exception instead of bouncing the task, and merged locally into `main` with terminal outcome `Merged locally into main.` This confirms that the whole narrow-cleanup path now survives review, gates, and terminal merge truth end to end.
- Release pivot: bumped Guildhall to `0.4.0`, added a repo-local `docs/releases/0.4.0.md` note, updated README publish commands/examples, and added a concise Release-tab shipping-claim card so the product now states the honest release story directly: proven end-to-end automation for the narrow cleanup lane, not all task shapes yet.
- Release hardening for `0.4.0` is now in progress at the repo/runtime layer, not just docs. The dry release surfaced real blockers, and this pass cleared them by (1) restoring sane "few knobs, smart defaults" lane concurrency behavior so worker fanout is not silently forced back to serial by project-config defaults, (2) preserving serial picker priority semantics under lane-capacity fanout so coordinator pre-rejection policy work is not starved behind ordinary worker tasks, (3) updating reviewer-dispatch reasoning tests to the current structured return contract, and (4) making git-driver integration tests hermetic against this machine's global git hook path by neutralizing global git config during throwaway repo commits.
- PR follow-up hardening for release prep: restored `src/**/__tests__/**` to TypeScript coverage, aligned the orchestrator's lane-capacity fallback with the same project-config defaulting story exposed by `/api/project`, and stabilized idle provider-status snapshots so `selectedAt` no longer churns on every poll when a project is not actively running. Probing a full `exactOptionalPropertyTypes` re-enable still explodes into a much broader runtime cleanup, so that remains explicit follow-up debt rather than getting smuggled into this release-prep fix set.
- 0.5.0 implementation is now pivoting the product from a single-project-feeling dashboard to a Projects-first local service UX. The active scope is no longer "polish the current shell" — it is "make Guildhall behave like a macOS-first service over many projects while preserving the proven narrow-lane task flow inside each project."
- The next implementation families are now explicit: (1) project-aware service lifecycle commands and `guildhall serve` semantics, (2) a true top-level Projects shell with per-project start/stop state, (3) attach-existing-folder as the only new-project path with uninitialized-project handling inside the project shell, and (4) a packaging/installer path built around a packaged executable plus LaunchAgent support.
- UI architecture cleanup is part of the 0.5.0 release work, not a separate cleanup fantasy. The Projects shell and nested project shell should be assembled from clearer reusable layout, summary-card, and data-shaping pieces rather than layering more bespoke project-only view logic onto the current single-project surfaces.
- First 0.5.0 service-lifecycle slice is now in place. The CLI understands `guildhall start`, `guildhall stop`, and `guildhall open`, while `guildhall serve` now acts like the friendly "ensure the service is running, then open Guildhall" path instead of blocking as the server process itself.
- The runtime now exposes a service-level `/api/service` contract separate from `/api/project`. It reports the optional preferred project bias, the current foreground project used by the still-legacy project-scoped API surfaces, and the list of registered projects, which gives the upcoming Projects home a truthful root payload instead of forcing it to infer service state from one project's data.
- The product story is now cleaner even before the Projects shell lands: background service state is tracked explicitly, `serve` logs talk about a local Guildhall service plus foreground project rather than pretending the whole server *is* one project, and docs now teach `serve`/`start`/`open`/`stop` as a family instead of only the old single-command dashboard story.
- The Projects-first shell now has real runtime footing instead of being a mockup. `/` routes to a dedicated Projects home, `/project/...` is the explicit namespace for the current nested project shell, and the router still accepts the older project-relative paths during transition so we do not have to rewrite every tab/link in one scary pass.
- The service API now supports real project selection. `/api/service` returns card-ready project summaries (selection state, task counts, and run posture), and `/api/service/select-project` can switch the foreground project for the existing `/api/project*` surfaces. That means project cards can actually `Open`, `Start`, and `Stop` a chosen project instead of faking fleet control off one project's payload.
- Live smoke on the fresh build: a local service run at `http://localhost:7890` served the new Projects root, `/api/service` returned both Looma/Knit and `t-minus-t` with task counts, and selecting `t-minus-t` through `/api/service/select-project` immediately moved both `selectedProject` and `foregroundProject` to that repo. This completes the Projects-first shell slice well enough to move on to attach/uninitialized flow next.
- Attach-existing-folder is now a real top-level flow instead of a setup-side escape hatch. `/api/service/attach-project` registers the chosen folder against the live local registry, switches the service foreground project immediately, and opens uninitialized folders inside the project shell rather than auto-bouncing them away to `/setup`. When setup identity later finishes, the temporary uninitialized registry entry is reconciled into the final project id/name/tags so the Projects screen stays truthful across machine-local re-attachment and first-run initialization.
- Live smoke on a temp HOME proved the full attach flow end to end: a blank local service attached an existing uninitialized folder, `/api/project` surfaced `initializationNeeded` against that attached path, setup identity promoted the temporary registry entry into a final `attach-smoke` project, and `/api/service` plus `~/.guildhall/registry.yaml` both reflected the final initialized project without manual cleanup.
- The next 0.5.0 UI slice is now pulling structure out of the surfaces instead of letting the new Projects shell and project shell accrete more bespoke markup. Shared `AppShell` / `ProjectShell` / `ProjectsShell` wrappers now own the outer chrome, while a pure `project-data` module owns coordinator columns, work-surface state, event sorting, and thread phase grouping that used to live inline inside `ProjectView`, `WorkTab`, `CoordinatorsTab`, and `ThreadTab`.
- Visual check on the fresh local service (`http://localhost:7892`) passed: the Projects home now renders as a calmer service-level dashboard with reusable project cards, and the nested project Work view still holds together under the new shell/layout wrappers without the refactor scrambling the rail, top bar, or task grid.
- Project cards now carry a much better at-a-glance story. The service payload includes tags, a short project blurb, and lightweight task highlights (current active task, current blocked task, or latest completed task), and the card UI now frames those into `Stage`, `Activity`, and `Recent` lines instead of forcing the user to reverse-engineer everything from raw counts alone.
- Visual check on the refreshed Projects home (`http://localhost:7893`) passed: cards now show whether agents are actively working, whether the project is paused/blocked/stable/needs setup, what the project broadly is, and the most relevant recent task title, while still staying compact enough to scan as a real top-level fleet dashboard.
- The next `0.5.0` runtime cleanup slice is now explicitly about isolated task workspace placement and lifecycle. The current repo-local `.guildhall/worktrees/...` shape is deterministic but wrong for the product: it clutters editor trees, pollutes normal `git status`, and makes ephemeral runtime sandboxes look like project-owned state. The approved direction is now:
  - move new isolated task workspaces to `~/.guildhall/worktrees/<project-id>/<task-id>`
  - keep the main settings story calm: `Shared project workspace` vs `Isolated task workspaces`
  - show exact sandbox paths only in task details/provenance
  - keep workspaces until work has actually landed, especially for PR-backed flows
