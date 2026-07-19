---
title: Would Guildhall have caught its own UX regressions?
help_topic: audit.guildhall_self_ux
help_summary: |
  Audit of whether Guildhall's own guilds, gates, flow-audit practice, and
  agent instructions would have prevented the recent manual UX fixes.
---

# Would Guildhall have caught its own UX regressions?

Date: 2026-05-25

## Short answer

Not reliably.

Guildhall has accumulated a long, useful audit trail of UX repairs: Thread setup
loops, recovery cards that leaked `AC-#` and verification jargon, fake
question cards built from research narration, raw runtime/git errors, inconsistent
owner-input counts, incomplete task briefs that looked runnable, and settings
surfaces that looked blank despite stored project context.

Those fixes prove Guildhall can learn from the issue after a human or external
agent sees it. They do not prove Guildhall would have caught the issue while it
was building itself.

The current system would catch some narrow forms:

- copy review can object to jargon, placeholder copy, missing recovery paths,
  and inconsistent labels;
- reviewer instructions now treat information hierarchy as a first-class UI
  gate;
- deterministic validators reject some malformed user-question shapes;
- the flow audit now contains a strong zero-context testing script;
- recent product code centralizes several previously leaky translations, such
  as escalation guidance and owner-action projection.

The missing piece is a first-class, mandatory UX comprehension gate. Guildhall
does not yet require every user-facing change to prove that a fresh user can
answer:

- What is this card or screen saying?
- Is anything mine to do?
- Who owns the next step?
- What will the primary button do?
- Does the next surface reduce interpretation, or add another layer?

Without that gate, Guildhall can pass code review, component tests, typecheck,
and even ordinary copy review while still shipping a screen that makes the
project owner reverse-engineer Guildhall.

## Evidence reviewed

Sources used for this audit:

- The live `artifact:flow-audit` checklist via the Guildhall MCP bridge.
- Recent git history since April 2026, especially the cluster of UI flow commits:
  `ui: consolidate project thread flow`, `Record second Guildhall UI audit pass`,
  `Fix audited Guildhall project flows`, `Require progressive disclosure in UI work`,
  `Pin Settings and contain settings sections`, and `Prepare Guildhall 0.8.0 release flow`.
- `internal/audits/flow-audit.md`, especially the current principle and
  follow-up checklist.
- `internal/plans/archive/2026-05-24-zero-context-flow-user-testing.md`.
- Current guild principles and rubrics for the Project Manager, Copywriter,
  Frontend Engineer, Visual Designer, Accessibility Specialist, and Test Engineer.
- Current deterministic/runtime code around `post-user-question`,
  `escalation-labels`, `runGuildGates`, reviewer fanout, and content-integrity
  detection.

## UX fixes in the recent audit trail

This is not exhaustive, but it is enough to show the recurring pattern.

| Issue family | Example from the trail | Manual fix shape | Would Guildhall have caught it before the fix? |
| --- | --- | --- | --- |
| Circular setup or wrong route | Thread setup sent the user through a no-op or external onboarding detour. | Model setup affordances in `src/runtime/thread.ts`; render inline actions in Thread. | Maybe, only if the reviewer tested the live journey. Static review would see valid links and labels. |
| Non-actionable recovery | Recovery cards exposed `AC-#`, verification-gate, proof-packet, or generic recovery language. | Add `escalationUserGuidance`, primary recovery actions, and focused tests for Thread/drawer surfaces. | Partially. Copywriter and PM rubrics could object to jargon/actionability, but only if selected and strict. No deterministic gate covered owner/action clarity. |
| Fake questions | Agent research narration became choice prompts such as "I have enough from the glob results..." | Reject evidence-summary prose in `post-user-question`; add read-time repair/filtering. | No, before the new validators. The system treated structured question records as valid data once persisted. |
| Incomplete brief looked runnable | Ready tasks with missing success target/ACs showed as `Guildhall next` or runnable. | Share worker-handoff truth across Thread/Work/Current; open one-field brief cleanup when only one field is missing. | Not reliably. Task-state tests can catch projection mismatch, but the UX failure is whether a fresh user can tell why the task is not runnable. |
| Raw internal state leaked | Release/Overview/Thread showed `spawn git ENOENT`, `assistant_complete {...}`, `human_judgment_required`, `spec_ambiguous`, or storage paths. | Add friendly mappers, suppress stale events, collapse churn, move raw details behind diagnostics. | Partially. Copywriter can catch jargon; deterministic raw-token scans could catch much more, but they are not broad enough today. |
| Count and owner contradictions | Home, Needs You, Inbox, Thread, Work, and Release disagreed on "Needs you" and ready counts. | Unify projections and start-readiness logic; split owner input from runnable progress. | Maybe in integration/browser audit. Unit tests catch known projections but not cross-surface comprehension unless the same state fixture is asserted everywhere. |
| Project context looked absent | Settings `Memory` looked blank because it only listed reusable habit/playbook proposals. | Rename to Guidance and show project brief, workspace goals, import choices, decisions, then reusable habits. | Unlikely. The UI was technically showing the data subset it was built to show; only product-context review catches the user's expectation mismatch. |
| Semantic truncation | A task title persisted `...` while the full request survived only elsewhere. | Add content-integrity detector and guidance that clipping belongs in display, not data. | Not yet. The detector exists, but the Frontend Engineer guild currently exports it while its deterministic checks list is empty. |

## What Guildhall already has

### Strong ingredients

1. **The flow-audit artifact names the right product rule.**
   It says Thread is the command surface and that the UI should not ask the
   user to understand hidden state, cross pages for simple answers, or wait on
   vague "agent is working" cards.

2. **The zero-context script is the right test shape.**
   It explicitly fails screens when the tester cannot explain meaning, owner,
   next action, badge semantics, required-vs-optional controls, or click
   outcome without Guildhall implementation knowledge.

3. **The Copywriter guild is useful.**
   It reviews small labels, status chips, tooltips, headings, error recovery,
   empty states, jargon, casing, and product voice.

4. **The reviewer prompt now has an information-hierarchy clause.**
   It tells reviewers to require revision when a UI dumps runtime state,
   diagnostics, provenance, explanatory copy, and secondary controls into the
   default view.

5. **Some high-risk data shapes now have deterministic checks.**
   `post-user-question` rejects several fake-question patterns. Escalation
   labels route internal reason codes through user guidance. Content-integrity
   detection can identify some ellipsis-as-data paths.

6. **The live audit culture is good.**
   The project has repeated browser passes, multi-agent passes, screenshot
   refreshes, and follow-up checklists instead of one-off fixes lost in chat.

### Gaps

1. **UX comprehension is not a required artifact.**
   A task can be "done" without saving the first visible screen, the primary
   user job, the owner of the next move, the required action, optional actions,
   and expected click-through.

2. **Guild reviews are still mostly diff/spec reviews.**
   They can inspect changed code and text, but the worst regressions were
   journey failures: one surface said one thing, the next surface implied
   another, or a card looked actionable when Guildhall owned the next step.

3. **The deterministic gates are under-wired for product UX.**
   Some detectors exist, but several are either skipped, limited to code
   snippets, or not run across all changed source files.

4. **The generic reviewer is stronger than the persona rubrics.**
   The reviewer prompt knows about information hierarchy, but the selected
   rubrics do not yet contain a dedicated "zero-context owner/action clarity"
   item. That makes the behavior depend on one prompt paragraph rather than a
   named, attributable guild verdict.

5. **Screens are not treated as contracts.**
   Tests assert pieces of UI text and state, but there is no reusable contract
   like "this owner-input card must expose owner, reason, primary action, and
   completion path, and must not expose raw reason codes."

6. **Agent output can still become UI data too easily.**
   Guildhall has added filters for specific malformed question patterns, but
   the broader rule should be: no model text becomes a user-facing card until
   it satisfies a structured UI contract.

## Deterministic prevention opportunities

These are checks Guildhall can run without asking an LLM to be wise.

### 1. User-facing string leak scanner

Add a source-file scanner for known internal tokens in UI-visible strings:

- `AC-\d+`
- `gate_hard_failure`, `spec_ambiguous`, `human_judgment_required`
- `checkpoint-touched`, `authoritative verification`, `handoff packet`
- `TASKS.json`, `.guildhall/TASKS.json`, legacy `memory/agent-settings.yaml`
- raw `spawn ... ENOENT`, `fatal: not a git repository`, JSON event dumps
- agent ids such as `worker-agent` when not passed through `roleLabel`

This should not ban every occurrence in code. It should flag likely rendered
strings in Svelte templates, label maps, event summary mappers, task/card
projection code, and tests that snapshot bad copy.

Autofix path:

- route reason codes through `escalationReasonLabel`, `roleLabel`,
  `labelForIdentifier`, or a new `runtimeMessageForDisplay`;
- keep raw stderr in diagnostics/evidence only;
- require the UI projection to expose `displaySummary` plus `diagnosticDetail`,
  not one ambiguous `detail` field.

### 2. Owner-action card contract

For every Thread, Inbox, Needs You, Work, Release, and drawer current card,
require a normalized projection:

```ts
type OwnerActionCard = {
  id: string
  surface: 'thread' | 'inbox' | 'needs-you' | 'work' | 'release' | 'drawer'
  owner: 'user' | 'guildhall' | 'none'
  headline: string
  summary: string
  primaryAction?: {
    label: string
    outcome: string
    required: boolean
  }
  secondaryActions: Array<{
    label: string
    outcome: string
  }>
  diagnosticDetail?: string
}
```

Then add fixture tests that assert:

- user-owned cards have a direct action or answer affordance;
- Guildhall-owned cards do not show a giant primary user action unless it
  resumes or retries Guildhall;
- `owner: none` cards do not look clickable as the main path;
- `headline`, `summary`, and `primaryAction.label` do not contain internal
  token leaks;
- every primary action has an `outcome` that matches the next route/modal.

Autofix path:

- collapse ad hoc card text into projection helpers;
- make Thread/Work/Inbox/Release render the same owner-action contract instead
  of recomputing state locally.

### 3. Cross-surface state consistency fixtures

Create canonical fixtures for risky states:

- active pressure-test question;
- project check-in with zero concrete questions;
- ready task with incomplete brief;
- blocked task with missing verification evidence;
- blocked task with upstream workspace failure;
- stale external work that the user completed outside Guildhall;
- provider unavailable or empty assistant message churn;
- workspace container with child git repos.

For each fixture, assert the projected owner, headline, primary action, and
work bucket across Home, Needs You, Thread, Work, Current drawer, and Release.

This would have caught many contradictions in the 2026-05-24 flow audit before
manual browser testing.

### 4. Question-shape gate for all model-authored user prompts

The current `post-user-question` validators are a good start. Make the rule
broader:

- `subject` is a topic, never the question;
- `description` is context, never the question;
- `body` is exactly one answerable question;
- choice options are answer options, not separate questions or evidence notes;
- no "the key question I need to ask is..." wrappers;
- no research summary can become a choice prompt;
- no "what must <title> get right first" template interpolation.

Run the same validation on:

- pressure-test intake;
- project check-in;
- task reframe;
- spec-agent questions;
- coordinator questions;
- imported legacy questions on read.

Autofix path:

- extract embedded question text when possible;
- downgrade malformed choice prompts to free-text with `Question missing`;
- move evidence narration to `description`.

### 5. Wire the content-integrity detector

`findTruncatedContentStorage(source)` exists, and the Frontend Engineer rubric
already says semantic content must stay whole. The missing deterministic piece
is to walk changed source files and fail on semantic `slice(...) + '...'`,
truncate helpers used on semantic fields, or literal ellipsis values in task,
question, summary, detail, note, and message fields.

Autofix path:

- replace stored truncation with complete summaries;
- move visual clipping into reusable display components;
- ensure details/drawer views use complete fields.

### 6. Route/action validation

Several manual fixes were caused by routes that looked right but landed in the
wrong scope or repeated the same vague prompt. Add a route contract test:

- project-scoped UI actions must stay under `/projects/:id/...`;
- drawer actions must pass explicit `projectId`;
- buttons named `Review`, `Open`, or `Continue` must include an object/outcome
  in the projection, or the copy review fails;
- click-through tests assert the destination contains the input/action promised
  by the card.

## Agent-review improvements

Deterministic checks should catch leaks and contradictions, but the most useful
future gate is agent review over screenshots or rendered DOM.

### 1. Add a Cognitive Load Reviewer guild

This persona should be separate from Copywriter and Visual Designer.

Its rubric should ask:

- Can a first-time user state the card's meaning within five seconds?
- Can they tell whether they, Guildhall, or nobody owns the next move?
- Is the primary action required, optional, or just navigation?
- Does the first click reduce interpretation?
- Does the default view ask one job, or does it make the user inspect a packet?
- Are supporting details behind disclosure unless they affect the decision?
- Is the screen calm enough to scan while holding a real product decision?

The important difference: this reviewer is not judging whether words are
friendly. It judges whether the user can act.

### 2. Make zero-context review a required fanout for risky UI tasks

For tasks touching Thread, Work, Release, Inbox, Needs You, setup, Settings,
task drawers, project cards, or question/recovery projections:

1. Capture the first visible screen.
2. Give the reviewer only the minimal app intro from the zero-context script.
3. Ask the reviewer to score the first-card questions.
4. Block release below `7/10`; block immediately below `5/10`.
5. Save the verdict as task evidence with screenshot/browser reference.

This should be a release gate for Guildhall's own UX surfaces, not an optional
manual exercise.

### 3. Require click-through review

Most regressions were not just "the first card text is bad." They were
"clicking the obvious control lands somewhere that still does not explain the
decision." The reviewer must inspect at least one click outcome for each
owner-input or recovery card.

The review prompt should ask:

- Did the clicked surface preserve context?
- Is the requested input in view?
- Did the action label predict the result?
- Did the next screen ask for one thing?
- Did it remove, hide, or explain diagnostics?

### 4. Add "screens are contracts" to spec-agent instructions

When a task changes user-facing flow, the spec must include:

- first visible headline;
- owner of the next move;
- primary action label and outcome;
- secondary/optional actions;
- what details are hidden by default;
- what raw/internal fields must never render;
- the click-through path;
- browser verification route and viewport.

The reviewer can then evaluate against a concrete blueprint instead of
inventing UX criteria after the worker is done.

## Improved agent instructions

These instruction snippets are candidates for Guildhall's own agents.

### Spec Agent

For any UI, Thread, drawer, settings, work-board, release, setup, question, or
recovery task:

- Define the first visible user job in one sentence.
- Name who owns the next move: user, Guildhall, or nobody.
- Specify the exact primary action label and expected result.
- Specify which details are visible by default and which are hidden behind
  disclosure, diagnostics, drawer tabs, or history.
- Include at least one zero-context acceptance criterion:
  "A first-time user can explain the card's meaning, next owner, and primary
  action without reading internal state or prior chat."
- Do not let a task proceed to worker handoff if these fields are missing.

### Worker

When implementing a user-facing Guildhall surface:

- Build from a normalized projection, not scattered local string decisions.
- Keep raw runtime details out of default UI. Put them in diagnostics/evidence.
- Do not introduce a primary action unless it performs the user's main next
  step or resumes Guildhall's next step.
- After the change, write a self-critique that answers the zero-context
  acceptance criterion in plain language.

### Reviewer

For user-facing Guildhall changes, review the rendered state, not only the diff:

- If no screenshot, DOM snapshot, browser path, or rendered fixture is attached,
  require revision unless the change is provably non-visual.
- Fail any default surface that requires the user to understand task-state
  identifiers, acceptance-criteria ids, provider internals, raw stderr, storage
  paths, agent handoff language, or prior chat.
- Fail when the primary action label does not predict the result.
- Fail when owner, state, badge, button, and next route disagree.

### Coordinator

When Guildhall is building Guildhall:

- Treat repeated manual UX repairs as product evidence, not incidental bugs.
- Promote recurring patterns into deterministic projections or gates.
- If a fix only changes copy at the final render site, ask whether the same
  internal state is rendered elsewhere.
- Schedule follow-up work when a detector exists but is not wired into
  `runGuildGates`.

## Recommended implementation plan

### Slice 1: Make the existing detector real

- Wire `findTruncatedContentStorage` into the Frontend Engineer deterministic
  checks.
- Walk changed UI/runtime source files in the guild gate input.
- Add focused tests for semantic ellipsis storage.

This is small and directly addresses a current open flow-audit item.

### Slice 2: Owner-action projection contract

- Introduce a shared owner-action card projection type.
- Convert the highest-risk surfaces first: Thread, Current drawer, Needs You,
  Work cards, Release blockers.
- Add fixture tests for the risky states listed above.

This would prevent most of the "same state, different story" bugs.

### Slice 3: Internal-token scanner

- Build a deterministic scanner for UI-visible strings.
- Start in warning/soft-gate mode for existing debt.
- Make new leaks fail for changed files.

This catches the raw-code smell before a browser pass.

### Slice 4: Zero-context reviewer fanout

- Add a Cognitive Load Reviewer guild.
- Select it automatically for Guildhall UI/task-flow work.
- Feed it rendered DOM or screenshots plus the zero-context prompt.
- Save score, reasoning, screenshot/browser target, and click-through result as
  review evidence.

This is the missing agent-review loop.

### Slice 5: Flow-audit harness

- Turn `internal/plans/archive/2026-05-24-zero-context-flow-user-testing.md` into a
  runnable Guildhall audit command or project task template.
- Run it over the canonical flows before 0.8/0.9 release readiness.
- Persist results back to `artifact:flow-audit`.

This makes the practice repeatable instead of heroic.

## Final verdict

If Guildhall had been building Guildhall before the recent manual fixes, it
probably would not have caught the UX issue consistently. It had reviewer
personas, soft gates, and a culture of flow audits, but the actual failure mode
sat between them: a user-facing comprehension failure across state projection,
copy, action hierarchy, and click-through.

The right prevention is not "ask the Copywriter to care harder." The right
prevention is to make user comprehension a contract:

- deterministic projection checks for owner/action/state consistency;
- scanners for internal-language leaks and semantic truncation;
- structured question and recovery-card schemas;
- screenshot or DOM-backed zero-context review for risky flows;
- acceptance criteria that say what a first-time user must understand before
  Guildhall can call the task done.

Once those are in place, Guildhall would be much more likely to catch the next
manual UX issue while building itself, and in several cases it could autofix
the issue by routing through the right projection, label mapper, or recovery
guidance helper.
