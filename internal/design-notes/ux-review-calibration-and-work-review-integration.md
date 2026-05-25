---
title: UX review calibration and work-review integration
---

# UX review calibration and work-review integration

Date: 2026-05-25

## Purpose

Guildhall should not rely on hope that a reviewer agent will notice a subtle UX
problem. It should be able to test reviewers against known UX failures, learn
which reviewer setup catches which class of problem, and then route real work
through the review recipe that is most likely to catch the relevant risk.

This note replaces the narrower question, "Would Guildhall have caught this
Guildhall-specific UX issue?" with a general workflow:

1. Maintain a product-agnostic corpus of UX failure cases.
2. Run reviewer agents against those cases as calibration tests.
3. Change one variable at a time when reviewers miss known problems.
4. Let the Coordinator select calibrated review recipes for real work.
5. Treat review calibration as a reusable Guildhall capability, not a
   Guildhall-UI special case.

The same pattern should later extend beyond UX to security, performance, API
design, documentation, migration safety, reliability, legal/compliance, and any
other review lane where a reviewer can be tested against known misses.

## Core idea

Every review lane needs two things:

- **Production review:** inspect a real task before it ships.
- **Calibration review:** prove the reviewer can catch known problems before we
  trust it on comparable real tasks.

For UX, the calibration set is a failure corpus. Each case contains a surface,
scenario, user goal, hidden expected findings, and scoring rubric. The agent
does not get the answer. It gets the same kind of evidence it would get during
a real work review: screenshot, DOM snapshot, route, prototype, copy, task
context, or product brief.

If the agent misses the issue, Guildhall records the miss and experiments with
exactly one variable:

- change the context packet;
- change the model;
- change model settings;
- change the reviewer prompt/rubric;
- add a second reviewer lane;
- add deterministic checks that remove judgment from the loop.

The Coordinator does not guess which reviewer is "good at UX." It routes work
through recipes backed by prior detection evidence.

## Failure corpus

### Case shape

```ts
type ReviewCalibrationCase = {
  id: string
  domain: string
  productType: string
  surfaceType: string
  userGoal: string
  scenario: string
  artifacts: ReviewArtifact[]
  knownFindings: KnownFinding[]
  acceptableFindings?: string[]
  falsePositiveTraps?: string[]
  severity: 'low' | 'medium' | 'high' | 'critical'
  reviewLanes: ReviewLane[]
  source?: {
    kind: 'internal' | 'public-example' | 'synthetic' | 'field-report'
    reference?: string
  }
}

type ReviewArtifact =
  | { kind: 'screenshot'; path: string; viewport?: string }
  | { kind: 'dom'; path: string }
  | { kind: 'prototype-url'; url: string }
  | { kind: 'copy'; text: string }
  | { kind: 'flow'; steps: string[] }
  | { kind: 'requirements'; text: string }

type KnownFinding = {
  id: string
  category: UXFailureCategory
  expectedObservation: string
  userImpact: string
  minimumUsefulFix: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}
```

The corpus should include real product examples, synthetic variants, anonymized
field failures, and historical Guildhall misses. Guildhall cases are useful
seed cases, but they must not dominate the set.

### UX failure categories

The categories should be broad enough to cover many product types:

- **Comprehension:** user cannot tell what the screen means.
- **Task path:** user cannot tell what to do next or where a control leads.
- **Action ownership:** user cannot tell whether they, the system, or nobody
  owns the next move.
- **Information hierarchy:** primary, secondary, and diagnostic information
  compete in the default view.
- **Feedback and system status:** user cannot tell whether work is running,
  saved, blocked, failed, queued, or complete.
- **Error and recovery:** the UI says what failed but not how to recover, or
  gives recovery too late.
- **Recognition vs recall:** the user must remember hidden context, prior
  conversation, keyboard shortcuts, terminology, or earlier decisions.
- **Choice architecture:** defaults, preselection, button hierarchy, or wording
  steer the user toward unintended action.
- **Friction and obstruction:** the desired task is unnecessarily long,
  repetitive, buried, or harder than the undesired task.
- **Trust and state honesty:** the UI contradicts user input, saved state,
  backend state, or other surfaces.
- **Cross-surface consistency:** related screens tell different stories about
  the same object.
- **Accessibility comprehension:** meaning disappears under keyboard-only use,
  screen reader use, zoom, mobile, reduced motion, no hover, or low contrast.
- **Localization and language:** terms, idioms, untranslated text, or alphabet
  soup make the interface unusable for the target audience.
- **Ethics and deceptive design:** hidden costs, hard-to-cancel flows,
  confirmshaming, fake urgency, visual interference, trick wording, or forced
  action.

### Seed sources

Useful corpus sources include:

- public usability heuristics and examples, especially general rules like
  system status, user control, error prevention, recognition over recall, and
  plain-language errors;
- checkout and form research, because it contains many concrete task-flow
  failures that are not tied to one product category;
- deceptive-design taxonomies, because they provide named failure modes like
  hidden costs, obstruction, preselection, trick wording, and visual
  interference;
- accessibility failure examples from real audits and WCAG-oriented testing;
- support tickets and field reports where users describe confusion in their own
  words;
- internal failures from any project, rewritten as anonymized product-agnostic
  cases.

When turning public examples into corpus cases, avoid copying proprietary
screens wholesale unless licensing permits it. A good synthetic case captures
the failure pattern, not the original brand.

## Calibration test runner

### Inputs

Each calibration run should record:

- case id and artifact set;
- reviewer lane;
- model;
- model settings;
- prompt/rubric version;
- context packet version;
- available tools;
- time budget;
- whether the reviewer saw screenshot, DOM, route, copy, requirements, or flow
  steps;
- whether the expected findings were hidden from the reviewer.

### Output

```ts
type ReviewCalibrationResult = {
  caseId: string
  reviewerRecipeId: string
  model: string
  settings: Record<string, unknown>
  contextVersion: string
  promptVersion: string
  verdict: 'pass' | 'partial' | 'miss' | 'false-positive-heavy'
  matchedFindingIds: string[]
  missedFindingIds: string[]
  falsePositiveNotes: string[]
  usefulFixQuality: 0 | 1 | 2 | 3
  reasoningQuality: 0 | 1 | 2 | 3
  rawReviewRef: string
  gradedAt: string
}
```

The grader can be deterministic where possible:

- exact expected category mentioned;
- user impact identified;
- severity at least close;
- fix addresses the cause, not only the wording;
- no known trap misclassified as the main problem.

For nuanced cases, use an adjudicator model or human review, but keep the
hidden expected findings as the source of truth.

## Variable isolation

When a reviewer misses a known problem, do not change everything at once.

The Coordinator should create a mini bakeoff:

1. Baseline recipe: current context, model, settings, and prompt.
2. Context-only variant: same model/settings/prompt, richer or different
   evidence packet.
3. Model-only variant: same context/settings/prompt, different model.
4. Settings-only variant: same context/model/prompt, different reasoning,
   temperature, max output, or tool budget.
5. Prompt/rubric-only variant: same context/model/settings, revised rubric.
6. Multi-reviewer variant only after the single-variable tests show where the
   miss lives.

This matters because "add more context" can mask a weak prompt, "use a bigger
model" can mask missing artifacts, and "tighten the rubric" can overfit a
single case. Guildhall should know why a recipe improved.

## Reviewer recipes

A recipe is a tested reviewer configuration:

```ts
type ReviewerRecipe = {
  id: string
  lane: ReviewLane
  purpose: string
  model: string
  settings: Record<string, unknown>
  promptVersion: string
  contextPacket: ContextPacketSpec
  requiredArtifacts: ReviewArtifactKind[]
  calibratedAgainst: string[]
  detectionRates: Record<UXFailureCategory, number>
  knownWeaknesses: string[]
  lastCalibratedAt: string
}
```

Examples:

- `ux-zero-context-comprehension`: screenshot plus minimal app intro; detects
  whether the main user job and next action are legible.
- `ux-click-through-task-path`: first screen plus one interaction; detects
  whether the next surface preserves context and resolves the promised action.
- `ux-error-recovery`: failed state plus task goal; detects whether the user can
  recover without internal knowledge.
- `ux-deceptive-design`: checkout, subscription, privacy, permission, or
  settings flow; detects manipulation, obstruction, hidden terms, or asymmetric
  choices.
- `ux-accessibility-comprehension`: DOM and screenshot; detects whether meaning
  survives keyboard, screen reader, mobile, zoom, no-hover, and contrast
  constraints.
- `ux-cross-surface-consistency`: multiple surfaces showing the same object;
  detects contradictions in status, owner, count, or completion path.

## Integration into real work reviews

### Stage 1: Coordinator classifies UX review risk

During task shaping, the Coordinator assigns a review-risk profile. This is not
limited to tasks whose title says "UX."

Triggers:

- user-facing UI, docs, emails, CLI copy, notifications, onboarding, setup, or
  settings;
- forms, checkout, auth, permissions, subscriptions, import/export, destructive
  actions, recovery, errors, empty states, or first-run flows;
- stateful cards, dashboards, queues, review flows, status chips, or
  cross-surface summaries;
- anything where a user must make a decision, recover from failure, trust saved
  state, or understand what happens next.

Output:

```yaml
reviewRisk:
  ux:
    categories:
      - comprehension
      - task_path
      - error_recovery
    requiredRecipes:
      - ux-zero-context-comprehension
      - ux-click-through-task-path
    requiredArtifacts:
      - screenshot
      - route
      - user_goal
      - expected_primary_action
    releaseBlockingBelow: 0.75
```

### Stage 2: Spec includes reviewable UX contracts

If UX risk is present, the Spec Agent must include:

- target user and user goal;
- first visible state;
- primary action and expected result;
- secondary actions and why they are secondary;
- what success looks like to the user;
- empty/loading/error/recovery states if touched;
- screen or route to review;
- artifact requirements for review;
- expected accessibility constraints;
- explicit UX review recipes required before approval.

This keeps the reviewer from judging a screenshot in a vacuum, while still
preventing the reviewer from seeing the hidden expected findings from the
calibration corpus.

### Stage 3: Worker produces review artifacts

Before moving to `review`, the worker must attach or reference the artifacts
requested by the review-risk profile:

- screenshot or DOM snapshot;
- local route or prototype URL;
- interaction path for click-through review;
- changed copy strings;
- state fixture for empty/error/recovery/loading;
- before/after comparison when applicable;
- self-critique against the UX contracts.

If the worker cannot produce the artifacts, it should not mark the task ready
for review. It should either continue, ask for a capability, or record why the
Coordinator must choose a different review recipe.

### Stage 4: Reviewer fanout uses calibrated recipes

At `review`, Guildhall already runs reviewer fanout. UX calibration should plug
into that fanout as recipe-backed reviewers:

- select applicable reviewer recipes from `reviewRisk`;
- inject only the recipe's context packet;
- run each reviewer independently;
- persist each result as a normal `ReviewVerdict`, with recipe id and artifact
  refs;
- aggregate strictly for release-blocking categories;
- send non-blocking quality observations to follow-up ideas.

A UX reviewer verdict should include:

```yaml
reviewerRecipeId: ux-zero-context-comprehension
artifactRefs:
  - screenshot: artifacts/review/task-123/thread-card-desktop.png
  - route: http://localhost:7777/projects/example/thread
findings:
  - category: task_path
    severity: high
    observation: The primary button says "Review" but the surface asks for a decision.
    userImpact: A first-time user cannot tell whether clicking is required or optional.
    recommendedFix: Rename the action around the intended outcome and put the decision input in the first screen after click.
score:
  comprehension: 0.4
  taskPath: 0.5
  actionOwnership: 0.6
verdict: revise
```

### Stage 5: Gate check enforces deterministic UX contracts

At `gate_check`, deterministic checks should cover what does not require model
judgment:

- missing required review artifacts;
- raw internal tokens in user-facing strings;
- inaccessible buttons or missing labels;
- low contrast;
- broken project/route links;
- primary actions without declared outcomes;
- semantic truncation of user-facing content;
- missing empty/error/recovery states when specified;
- known deceptive-design patterns that are statically detectable, such as
  preselected paid options in a cancellation or checkout flow.

The model reviewer handles interpretation. The gate check handles contract
violations.

### Stage 6: Coordinator handles review misses and disagreements

When a UX reviewer misses something later found by a human, another reviewer,
or production evidence, the Coordinator should not merely add a local rule. It
should file a calibration case:

```yaml
miss:
  sourceTaskId: task-123
  missedCategory: action_ownership
  missedByRecipe: ux-zero-context-comprehension
  humanFinding: The card looked like it needed user action, but the system owned the next move.
  nextCalibrationAction: create_case_and_run_single_variable_bakeoff
```

Then:

1. Add or update a corpus case.
2. Run the baseline reviewer recipe.
3. If it misses, run single-variable variants.
4. Update the recipe only when a variant improves detection without unacceptable
   false positives.
5. Record the recipe version and detection evidence.

This turns every escaped review bug into calibration data.

## How the Coordinator shapes handoff to an agent

The Coordinator should hand off calibration work as a normal task, not as a
vague research ask.

### Handoff contract

```yaml
task:
  title: Add UX review calibration case for unclear recovery action
  userGoal: Improve reviewer detection of action-ownership failures.
  scope:
    - Create one product-agnostic calibration case from the observed failure.
    - Define hidden expected findings.
    - Run the current baseline reviewer recipe.
    - Run one context-only variant if baseline misses.
    - Report whether context improved detection.
  outOfScope:
    - Changing the production UI.
    - Changing model defaults.
    - Updating all reviewer prompts.
  artifacts:
    - calibration case file
    - baseline result
    - variant result
    - recommendation note
  acceptanceCriteria:
    - Case is not overfitted to one product or brand.
    - Expected finding states user impact and minimum useful fix.
    - Baseline and variant differ by one variable only.
    - Recommendation explains whether to change context, model, settings, prompt, or no recipe yet.
```

### Agent instructions

The agent should receive:

- the observed failure;
- the relevant artifact or a synthetic reconstruction;
- the UX category to test;
- the current reviewer recipe;
- the one variable it is allowed to change;
- the grading rubric;
- where to save case/result artifacts.

The agent should not receive:

- permission to tune multiple variables at once;
- permission to make product changes as part of calibration;
- the hidden expected finding when acting as the reviewer under test.

## Review tests beyond UX

The same structure should exist for all review lanes:

- **Security review tests:** known injection, credential leakage, authz bypass,
  insecure defaults, and missing audit events.
- **Accessibility review tests:** keyboard traps, missing names, contrast,
  focus loss, hidden status, and modal semantics.
- **Performance review tests:** unnecessary waterfalls, unbounded loops, large
  bundle changes, missing pagination, and expensive render loops.
- **API design review tests:** ambiguous errors, idempotency holes, unstable
  contracts, bad versioning, and non-actionable validation responses.
- **Data migration review tests:** destructive default, missing rollback,
  partial failure, stale compatibility path, and local/dev/prod confusion.
- **Docs review tests:** outdated commands, hidden prerequisites, wrong
  audience, internal jargon, and examples that cannot run.
- **Reliability review tests:** retry storms, missing timeout, bad circuit
  breaker, insufficient observability, and noisy alert failure.

Each lane gets a failure corpus, recipes, calibration results, and real-work
integration. UX should be the first serious slice because it is where recent
manual review misses are most visible.

## Non-overfitting rules

To keep this product-agnostic:

- Use at least three product domains before calling a recipe calibrated.
- Include both consumer and professional/productivity surfaces.
- Include both visual UI and non-visual interfaces such as CLI, email, docs,
  notifications, and API error messages.
- Include both honest usability failures and deceptive/ethics failures.
- Score user impact, not resemblance to a known Guildhall issue.
- Require reviewers to identify the general failure category and causal
  mechanism, not just a local label.
- Prefer synthetic reproductions that isolate the failure pattern from brand
  details.
- Track false positives. A reviewer that finds every screen "confusing" is not
  calibrated.

## Data model additions

Likely new concepts:

```ts
type ReviewLane =
  | 'ux'
  | 'accessibility'
  | 'security'
  | 'performance'
  | 'api-design'
  | 'docs'
  | 'reliability'
  | 'migration'

type ReviewRecipeRef = {
  recipeId: string
  version: string
  required: boolean
  releaseBlocking: boolean
  reason: string
}

type TaskReviewRisk = {
  lanes: ReviewLane[]
  recipes: ReviewRecipeRef[]
  requiredArtifacts: ReviewArtifactKind[]
}

type ReviewVerdictExtension = {
  recipeId?: string
  recipeVersion?: string
  calibrationEvidence?: {
    detectionRate?: number
    calibratedAgainst?: string[]
    knownWeaknesses?: string[]
  }
  artifactRefs?: string[]
  scores?: Record<string, number>
}
```

## Minimal implementation path

1. **Design the corpus format.**
   Start with local YAML/JSON plus Markdown artifacts under `internal/` or
   ignored system-local storage. Keep public examples as references, not copied
   assets unless licensing is clear.

2. **Create 10-15 UX seed cases.**
   Mix internal failures, synthetic checkout/form/recovery examples,
   accessibility comprehension examples, and deceptive-design examples.

3. **Implement one runner.**
   It should run a reviewer recipe against a case, hide expected findings, and
   save raw output.

4. **Implement one grader.**
   Start with rubric-assisted model grading plus deterministic checks for
   finding ids/categories. Human adjudication is acceptable for the first
   slice.

5. **Introduce `reviewRisk` on tasks.**
   Let the Coordinator or Spec Agent attach required review recipes.

6. **Wire recipe-backed UX review into reviewer fanout.**
   Persist results as normal review verdicts so existing review aggregation can
   understand them.

7. **Add artifact checks at gate_check.**
   Missing required screenshots/routes/context packets should fail before
   "done."

8. **Close the loop on misses.**
   Add a workflow to promote escaped UX bugs into new calibration cases and run
   single-variable bakeoffs.

## First recommended slice

Build the smallest end-to-end loop:

- corpus schema;
- three product-agnostic UX cases:
  - ambiguous primary action;
  - error without recovery;
  - cross-surface state contradiction;
- one `ux-zero-context-comprehension` recipe;
- one runner command;
- persisted calibration result;
- task `reviewRisk` field;
- reviewer-fanout integration that can require that recipe for a marked task.

That slice proves the shape without pretending the corpus is complete.

## Open questions

- Where should calibration cases live long-term: repo-local `internal/`,
  system-local Guildhall storage, or both?
- Should public-example references be fetched live, copied as transformed
  synthetic fixtures, or recorded as source metadata only?
- Should calibration results affect model/provider defaults globally or only
  per review lane?
- How much false-positive tolerance is acceptable for release-blocking UX
  review?
- Who adjudicates calibration cases when models disagree with each other?
- Should high-performing recipes become default reviewer lanes, or should they
  remain opt-in based on `reviewRisk`?

## Desired outcome

When a user-facing task reaches review, Guildhall should know which UX review
recipes apply, what artifacts the worker owes, which reviewer configuration is
calibrated for that class of problem, and how to respond if the reviewer misses.

The result is not a smarter prompt taped onto the side of the current workflow.
It is a review system that can test itself.
