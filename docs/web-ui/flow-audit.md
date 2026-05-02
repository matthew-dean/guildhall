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

- [x] Keep task-drawer transcript notes aligned with canonical acceptance
  criteria so stale specifier notes do not contradict the real task.
- [x] Refresh Thread immediately on runtime activity that matters for user
  confidence, especially review back-to-work transitions and failed tools.
- [x] Let hard verifier failures dominate the active operator view instead of
  leaving softer reviewer guidance as the loudest signal.
- [x] Restore worker ownership whenever review/gate/adjudication bounces a task
  back to `in_progress`, so retries resume a coherent worker session.

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
