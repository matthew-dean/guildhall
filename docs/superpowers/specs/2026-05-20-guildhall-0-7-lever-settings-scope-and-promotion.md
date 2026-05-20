# Guildhall 0.7.0 — Lever Settings, Scope, And Promotion

## Status

Target specification for `0.7.0`.

## Purpose

Give the Coordinator a clear, inspectable way to ask the right behavioral
question at the right time, suggest a lever change, scope that change to the
right layer, and later promote repeated project-level preferences into user
global defaults when the evidence supports it.

This spec complements the 0.7 project construction planning target. The
construction plan decides what Guildhall is building now. Lever settings decide
how Guildhall should behave while building it.

## Product Thesis

Levers should feel like Settings, not a hidden control panel and not a quiz the
owner must pass before work begins.

Most projects should start from sensible global defaults. A project can override
those defaults when the project has a local reason. If the same override keeps
moving in the same direction across projects, Guildhall should propose promoting
that preference into the user's global defaults.

The Coordinator should have discretion to ask about a lever only when the answer
changes real behavior now:

- autonomy
- review strictness
- spec completeness
- concurrency
- worktree isolation
- remediation behavior
- completion approval
- escalation policy
- construction-plan visibility

The question should be contextual, specific, and accompanied by a recommended
option.

## Diagnosis

Guildhall already has:

- project levers
- domain levers
- `memory/agent-settings.yaml`
- provenance through `setBy`, `setAt`, and `rationale`
- scoped learning and product suggestions
- Settings surfaces that expose project memories and learning

The remaining gaps:

1. **No first-class global lever defaults.** There is user/global learning, but
   not a clean user-global lever-default layer that projects can inherit.
2. **Project settings look explicit even when they are really defaults.** The
   current storage seeds every lever, which makes "same as global" harder to
   represent in the UI.
3. **Coordinator lever questions are not structured enough.** A Coordinator can
   ask, but the product does not yet define when to ask, what options to show,
   or how to scope the answer.
4. **Promotion is under-modeled.** Repeated project-level tweaks should become
   candidates for global defaults, but only after evidence and user approval.
5. **The UI risks becoming a matrix of knobs.** Levers need a clear Settings
   model with safe defaults, inheritance, explanations, and contextual help.

## Scope Layers

Guildhall should treat lever settings as layered.

| Scope | Meaning | Example |
| --- | --- | --- |
| System default | Built-in fallback shipped with Guildhall | `spec_completeness: stage_appropriate` |
| User global | How this user generally prefers Guildhall to behave | "Ask me before autonomous task generation" |
| Project | How this project wants Guildhall to behave | "Use stricter review in this repo" |
| Domain | How one project domain behaves | "UI work requires full upfront specs" |
| Slice/task suggestion | One-time or temporary behavioral adjustment | "For this risky slice, require human completion approval" |

The normal resolution order should be:

1. task/slice temporary override, if explicitly set
2. domain override, if set
3. project override, if set
4. user global default, if set
5. system default

Task/slice overrides should be rare and time-bounded. They are useful for a
single high-risk tranche, not as the normal settings model.

## UI Model

Settings should make inheritance obvious.

For every lever, the project-level selector should start with:

- `Same as global setting`

Then show valid project override positions:

- `Serial`
- `Fan out to N workers`
- etc.

If no global setting exists, `Same as global setting` resolves to the system
default. The UI can say:

```text
Same as global setting
Currently: stage appropriate (system default)
```

When the user chooses a concrete project value, the row becomes:

```text
Project override
UI specs require full upfront acceptance criteria.
```

The row should show:

- effective value
- inherited/from where
- local override value, if any
- setter
- rationale
- last changed
- reset-to-global action
- optional "make global default" action when eligible

This should feel closer to VS Code settings than a form wizard: global defaults,
project overrides, and clear inheritance.

## Project / Global Toggle

When the Coordinator asks a lever question, the default scope should usually be
Project.

Question card shape:

```text
Adjust review strictness?

This project is producing repeated review revisions in UI tasks.

Recommendation: use full upfront specs for UI work.

Apply to:
(*) This project
( ) Global default

[Apply recommendation] [Choose another option] [Not now] [?]
```

The global option should be available but not the default unless the evidence
already spans multiple projects.

If the Coordinator believes the tweak is inherently global, it can recommend
global scope, but it must explain why:

- the owner repeatedly chooses the same behavior across projects
- the preference is about user taste, not project requirements
- the setting affects how this person wants Guildhall to collaborate generally

## Coordinator Discretion

The Coordinator should ask about a lever when:

- current behavior is creating visible friction
- a construction plan is becoming more complex than the current lever posture
  supports
- repeated reviewer or worker outcomes point in the same direction
- the owner corrects Guildhall in a way that maps cleanly to a lever
- a high-risk tranche needs stronger temporary governance
- the project would benefit from more or less autonomy

The Coordinator should not ask when:

- the issue is a one-off bug
- a worker can proceed safely with existing defaults
- the lever change would be speculative
- the project is small and the extra setting creates more overhead than value
- the question is really a product requirement, not a behavior preference

Every Coordinator lever suggestion should include:

- affected lever
- current effective value
- recommended value
- recommended scope
- evidence
- impact
- reset path
- whether it is temporary or durable

## Lever Suggestion Packet

Add a structured suggestion shape:

```yaml
id: "lever-suggestion-001"
createdAt: "2026-05-20T12:00:00Z"
source:
  kind: "coordinator"
  taskId: "task-ui-review-loop"
lever:
  id: "spec_completeness"
  kind: "domain"
  domain: "ui"
current:
  effectiveValue: "stage_appropriate"
  inheritedFrom: "user-global"
recommendation:
  value: "full_upfront"
  scope: "project-domain"
  duration: "durable"
  rationale: "UI tasks have repeatedly returned from review for missing visual acceptance criteria."
evidence:
  - kind: "review_revision"
    taskId: "task-123"
    summary: "Reviewer requested concrete responsive acceptance criteria."
  - kind: "user_correction"
    taskId: "task-124"
    summary: "Owner asked Guildhall to stop approving vague UI specs."
impact:
  positive:
    - "Fewer under-specified UI tasks"
  tradeoffs:
    - "More detail before UI implementation starts"
actions:
  primary: "apply_project"
  secondary:
    - "apply_global"
    - "dismiss"
    - "snooze"
```

This packet should drive both the UI card and the write into
`agent-settings.yaml` or global defaults.

## Promotion To Global Defaults

Promotion should be evidence-based and human-approved.

A project override becomes promotable when:

- the same lever moves in the same direction on multiple projects
- the user repeatedly accepts the same recommendation
- the preference appears tied to the user's collaboration style rather than a
  project-specific constraint
- the change has enough successful outcomes and no recent dismissals

Promotion should not happen when:

- the evidence comes from only one project
- the change is tied to repo architecture, release policy, or risk profile
- the owner explicitly marked it project-only
- the result created repeated friction
- the lever is sensitive enough that globalizing it could surprise the user

Suggested threshold for first implementation:

- at least 3 accepted project-level suggestions
- across at least 2 projects
- same lever
- same direction or same target position
- no dismissal of the same promotion in the last 30 days

Promotion card:

```text
Make this your default?

You've chosen stricter UI specs in 3 projects.

Recommendation: set UI spec completeness to Full upfront by default.

New projects can still override this.

[Make global default] [Keep project-only] [Remind me later]
```

## Copying To Global Defaults

Users should not have to wait for automatic promotion if they already know a
preference is general.

Any project override row can expose:

- `Use as global default`

That action should:

- write the global default
- leave the project override in place or offer to reset the project to inherit
  from global
- record provenance with `setBy: user-direct`
- preserve rationale

Recommended follow-up:

```text
Global default updated.
This project still has the same value as an override.
Reset this project to "Same as global"?
```

## Help And Explanation

Lever settings need lightweight help, not long inline lectures.

Every lever row should have a help affordance that explains:

- what the lever controls
- what the positions mean
- when to choose each position
- whether it is usually global, project, domain, or temporary
- what can go wrong if the setting is too strict or too loose

For construction planning prompts:

```text
Do you want to split this work into a construction plan?
[?]
```

The help popup should explain:

- what a construction plan is
- what areas, phases, slices, and active tranche mean
- why Guildhall is recommending it now
- what happens if the owner says no
- how to keep small work lightweight

The help should be available on demand, not inline cognitive overhead.

## Settings Surface

Add or revise `Settings -> Levers` / `Settings -> How Guildhall works`.

Sections:

1. **Global defaults**
   - user-level behavior defaults
   - applies to new and inheriting projects
2. **Project overrides**
   - current project's deviations from global
   - reset-to-global actions
3. **Domain overrides**
   - per-domain exceptions
   - default domain fallback
4. **Suggested changes**
   - Coordinator recommendations waiting for approval
   - promotion candidates
5. **History**
   - changes, rationale, setter, evidence

Default view should show only:

- effective value
- inherited/overridden label
- changed recently indicator
- pending suggestions

Advanced detail should be collapsible.

## Storage Direction

Current project settings:

- `memory/agent-settings.yaml`

Add user global lever defaults:

- `~/.guildhall/agent-settings.yaml`

Possible shape:

```yaml
version: 1
global:
  project:
    worktree_isolation:
      position: per_task
      rationale: "Prefer isolated task branches across projects"
      setAt: "2026-05-20T12:00:00Z"
      setBy: user-direct
  domains:
    default:
      spec_completeness:
        position: stage_appropriate
        rationale: "Good default balance for most work"
        setAt: "2026-05-20T12:00:00Z"
        setBy: system-default
```

Project storage should support inheritance without losing compatibility.

First implementation option:

- keep existing seeded project entries
- add `inheritsFromGlobal: true` when the project value matches inherited global
- UI treats matching system-default entries as inherited until changed

Cleaner later option:

- project file stores only overrides
- resolver fills missing values from global/system defaults
- migration preserves old explicit settings as project overrides when provenance
  shows non-default setter

The first implementation should prioritize compatibility and UI truth over a
large storage migration.

## Resolution Rules

Effective lever resolution:

```text
task/slice temporary override
domain project override
project override
domain global default
global project default
system default
```

For domain levers:

1. task/slice override for that domain
2. project domain override
3. project `domains.default`
4. global domain override
5. global `domains.default`
6. system default

For project levers:

1. task/slice temporary override, if allowed for that lever
2. project override
3. global project default
4. system default

The UI should always show the effective value and its source.

## Runtime Changes

Add modules or extend existing settings modules for:

- global lever defaults
- effective lever resolution with source tracing
- lever suggestion packets
- promotion candidate detection
- Coordinator suggestion creation
- UI actions to accept/dismiss/snooze/reset

Suggested functions:

```ts
resolveEffectiveLever(project, domain, leverId): EffectiveLever
listLeverSettings(project): LeverSettingsViewModel
createLeverSuggestion(input): LeverSuggestion
applyLeverSuggestion(project, suggestionId, scope): ApplyResult
dismissLeverSuggestion(project, suggestionId): void
detectGlobalPromotionCandidates(user): PromotionCandidate[]
applyGlobalDefault(candidateId): ApplyResult
resetProjectLeverToGlobal(project, leverId, domain?): ApplyResult
```

## UI Changes

### Settings

- add global/project toggle or tabs
- show `Same as global setting` first in project selectors
- show effective value and inheritance source
- show provenance in detail drawer/popover
- show pending suggestions
- show promotion candidates

### Thread

Thread should show lever suggestions only when they affect current work.

Example:

```text
Coordinator recommendation
UI tasks are returning from review for missing acceptance criteria.
Use fuller UI specs for this project?
[Apply] [Not now] [What does this mean?]
```

Thread should not become a stream of every setting change.

### Needs You

Needs You should include lever suggestions only when they block or materially
improve active work.

### Build Map / Construction Plan

When a project starts feeling complex, the Coordinator can ask:

```text
Do you want Guildhall to organize this into a construction plan?
```

The help affordance explains the concept. The card should recommend a default:

- `Create plan` when complexity is high
- `Keep as tasks` when the work is manageable

If accepted, the construction plan becomes visible. If declined, Guildhall keeps
the lightweight task flow and can ask again only if complexity materially
increases.

## Agent Prompt Changes

### Coordinator

The Coordinator may propose lever changes when evidence supports them.

Rules:

- ask at the moment the setting matters
- recommend one option
- choose project scope by default
- recommend global only when evidence spans projects or is clearly user-style
- explain impact and tradeoff
- do not ask about levers for routine work
- do not hide applied changes

### Spec Agent

The Spec Agent may infer initial lever positions during intake, but should
prefer inheritance from global defaults when evidence is weak.

### Worker / Reviewer

Workers and reviewers should not change levers directly. They can emit evidence:

- repeated ambiguity
- repeated over-review
- review strictness mismatch
- autonomy mismatch
- unsafe concurrency

The Coordinator turns evidence into suggestions.

## Implementation Phases

### Phase 1 — Effective Settings And UI Labels

Goal: show inherited versus overridden settings honestly.

Changes:

- add effective lever source tracing
- update Settings rows to show `Same as global setting`
- show reset-to-global action
- avoid changing storage shape deeply

Acceptance:

- project settings display inherited/global/system source
- selecting a project override records provenance
- resetting restores inherited behavior

### Phase 2 — Global Lever Defaults

Goal: user can set defaults that projects inherit.

Changes:

- add `~/.guildhall/agent-settings.yaml`
- add global settings UI
- update resolver
- add tests for project/domain/global/system resolution

Acceptance:

- new project can inherit user global defaults
- existing project can reset a lever to global
- UI shows effective source correctly

### Phase 3 — Coordinator Lever Suggestions

Goal: Coordinator can ask the right lever question at the right time.

Changes:

- add suggestion packet model
- add Thread/Needs You cards
- add accept/dismiss/snooze actions
- record evidence and rationale

Acceptance:

- repeated UI spec ambiguity can trigger a project-domain suggestion
- accepting updates project settings
- dismissing suppresses repeated prompts for the same evidence

### Phase 4 — Promotion Candidates

Goal: repeated project choices become global-default recommendations.

Changes:

- add promotion detector
- add promotion card in Settings
- add `make global default` flow
- add reset-project-to-global follow-up

Acceptance:

- same-direction accepted changes across projects create promotion candidate
- promotion requires explicit approval
- project-only decisions do not become global suggestions

### Phase 5 — Construction Complexity Prompt

Goal: Coordinator can suggest construction planning only when useful.

Changes:

- add complexity signals
- add contextual plan-split prompt
- add help popup content
- connect acceptance to construction-plan draft flow

Acceptance:

- simple tasks do not show plan prompt
- large/ambiguous product ask shows plan prompt with recommendation
- declining preserves lightweight task flow

## Acceptance Criteria

1. Settings can show global defaults, project overrides, domain overrides, and
   effective value source.
2. Project selectors include `Same as global setting` as the first option.
3. Users can reset a project/domain override to inherit from global.
4. Users can copy a project override to global defaults.
5. Coordinator can propose a project-scoped lever change with evidence,
   recommendation, impact, and rationale.
6. Coordinator can recommend global scope only with cross-project or
   user-preference evidence.
7. Repeated same-direction project changes can produce a global promotion
   candidate.
8. Promotion requires explicit user approval.
9. Simple tasks do not surface lever or construction-plan prompts by default.
10. Complex projects can trigger a contextual construction-plan prompt with a
    help affordance.
11. All lever changes retain provenance.
12. Existing `memory/agent-settings.yaml` projects remain compatible.

## Non-Goals

- Do not add arbitrary free-form settings.
- Do not let workers or reviewers mutate levers directly.
- Do not auto-promote project settings to global without approval.
- Do not force small tasks through lever questions.
- Do not make Settings a required step before normal work.
- Do not replace project-specific learning with global defaults.

## Scenario Tests

### Scenario 1: Simple Direct Fix

Input:

- owner asks for a small bug fix

Expected:

- no construction-plan prompt
- no lever suggestion
- normal task flow continues

### Scenario 2: Project-Scoped Review Tweak

Input:

- repeated UI tasks return from review because specs are under-detailed

Expected:

- Coordinator suggests `spec_completeness: full_upfront` for UI domain in this
  project
- card explains evidence and tradeoff
- accepting writes project/domain override

### Scenario 3: Promotion To Global

Input:

- user accepts stricter UI spec defaults in several projects

Expected:

- Settings shows promotion candidate
- user can make it global
- projects can inherit or keep explicit overrides

### Scenario 4: Complex Project Split Prompt

Input:

- owner gives an ambitious product ask with many areas and dependencies

Expected:

- Coordinator recommends organizing into a construction plan
- help popup explains areas, phases, slices, and active tranche
- accepting opens construction-plan draft
- declining keeps lightweight task flow

## Verification Plan

Minimum:

- `pnpm typecheck`
- `pnpm test`
- `pnpm docs:build`
- `pnpm docs:check-help-sync`

Focused tests:

- effective lever resolution
- inherited/global/project/domain source labels
- reset-to-global
- copy-to-global
- suggestion packet acceptance/dismissal
- promotion candidate detection
- construction complexity prompt suppression for simple tasks
- construction complexity prompt for large asks

