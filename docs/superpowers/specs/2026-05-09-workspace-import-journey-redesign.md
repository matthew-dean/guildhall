# Workspace Import Journey Redesign

## Goal

Turn workspace import from a confusing document-dump into a guided review
journey that helps the user understand:

- what Guildhall found
- where it found it
- what kind of work it thinks that material represents
- which concrete tasks should be created

The import flow should feel like a calm guided intake, not a manifesto review.

## Problem

The current workspace-import experience collapses too many distinct decisions
into one muddy flow.

Today Guildhall does all of this at once:

- scans planning material
- synthesizes a large draft
- invents summary questions
- asks the user to respond to mixed abstractions
- surfaces old tasks and new draft candidates in the same question lane

That produces three failures:

1. the user cannot tell what level they are looking at
   - source doc
   - summary
   - task candidate
   - already-existing task

2. the user cannot tell what decision is being requested
   - "should this source be imported?"
   - "should this summary be trusted?"
   - "should this individual task be created?"
   - "should this existing task be kept?"

3. the user cannot inspect the raw evidence behind the synthesis
   - the app jumps straight from "Guildhall found things" to "approve this"

This is not mainly a wording bug. It is a journey-design bug.

## Product Rule

Workspace import must follow the repo-wide wizard philosophy in a strict form:

- one step should ask one question
- one question should operate at one level of abstraction
- one step should have one obvious primary action
- supporting evidence should be optional and inspectable
- the user should always know what will happen next

The flow must never ask the user to approve a mixed bundle containing:

- source selection
- import scope
- candidate synthesis
- final task creation

in a single card.

## Desired User Mental Model

The user should experience workspace import as:

1. Guildhall found planning material.
2. Guildhall grouped it into understandable sources.
3. Guildhall extracted candidate tasks from each source.
4. I can review those candidates in manageable chunks.
5. I can confirm exactly what gets created.

Not:

1. Guildhall wrote a long interpretation.
2. I am now supposed to bless or decode it.

## Non-Goals

This redesign does not try to:

- solve final task prioritization for the whole project
- merge import directly with spec drafting
- auto-approve large imports without visibility
- force the user to review every single imported task one-by-one when bulk
  acceptance is appropriate

## Journey Overview

Workspace import should become a five-step guided flow.

### Step 1: Sources Found

Purpose:
- orient the user

Question:
- "Guildhall found planning material in 7 sources. Do you want to review what it found?"

Show:
- source names only
- source type
- rough candidate counts
- whether each source looks like tasks, milestones, reference notes, or mixed

Do not show:
- giant prose summaries
- final candidate tasks
- approvals about task creation

Primary action:
- `Review sources`

Secondary actions:
- `Skip import for now`
- `Open source list`

### Step 2: Source Scope

Purpose:
- let the user choose which sources should be considered for import

Question:
- "Which sources should Guildhall use to create candidate tasks?"

Show:
- one row per source
- short source description
- estimated number of candidate tasks
- confidence indicator

Example:
- `Component roadmap` — 15 likely Looma tasks
- `Feature roadmap` — 12 likely Knit tasks
- `Editor roadmap` — 9 likely Looma editor tasks
- `Release plan` — mostly milestone/reference material

Primary action:
- `Continue with selected sources`

Secondary actions:
- `Select all likely task sources`
- `Skip all`

Important rule:
- this is about source inclusion only
- it is not yet approval to create tasks

### Step 3: Source Preview

Purpose:
- let the user understand each source before reviewing individual tasks

Question:
- "Does this source look worth importing as tasks?"

Show one source at a time:
- source title
- a 2-4 sentence summary
- candidate count
- grouped preview of candidate task titles
- link to open the original source doc

Primary actions:
- `Import all from this source`
- `Review tasks from this source`
- `Skip this source`

Important rule:
- one source per step
- no cross-source mixing

### Step 4: Candidate Task Review

Purpose:
- let the user inspect and confirm the actual task-sized output

Question:
- "Which of these candidate tasks should be added?"

Show:
- actual candidate tasks
- grouped by source and possibly by section
- chunked into small review pages, ideally 5-10 candidates at a time

Each candidate card should show:
- task title
- one-sentence description
- source doc reference
- optional evidence snippet
- projected project area or steward

Primary actions:
- `Keep selected tasks`
- `Keep all in this section`

Secondary actions:
- `Skip selected`
- `Edit task`
- `Open source`

Important rule:
- the unit of decision is now the candidate task
- not the source, not the whole import

### Step 5: Final Confirmation

Purpose:
- confirm the concrete result before mutation

Question:
- "Create 26 tasks from 4 sources?"

Show:
- total task count
- source breakdown
- skipped items count
- milestone/reference items kept separate from tasks

Primary action:
- `Create tasks`

Secondary actions:
- `Review tasks again`
- `Cancel import`

Important rule:
- this is the first step that should mutate `TASKS.json`

## Evidence and Inspection Rules

Every step after Step 1 should allow inspection of the underlying evidence.

The user should always be able to open:

- the original source doc
- the extracted source summary
- the candidate task preview

The default view should stay concise. Evidence is expandable, not forced.

## Levels of Abstraction

The UI must never silently mix these levels:

1. source
2. source summary
3. candidate task
4. existing task already in `TASKS.json`
5. milestone/reference note

If a screen contains more than one of these levels, it must visually separate
them and make the current decision target obvious.

The current bug where an import question mixes:

- real source categories
- already-existing tasks
- reserved setup tasks

must be treated as structurally invalid, not just ugly wording.

## Gating Rules

Workspace import should behave like a real wizard, not a co-active question
stack.

Required rules:

- a blocking import step must be completed before the next blocking step is
  shown
- the active import step should have one primary action
- follow-up detail cards may exist, but they cannot visually outrank the active
  decision
- the user should never see a later approval card while an earlier required
  source-selection step is still unanswered

For import specifically:

- source selection blocks source preview
- source preview blocks candidate task review for that source
- candidate task review blocks final confirmation

## Existing Tasks vs New Candidates

Existing tasks should not be shown as if they are candidate imports.

Instead, if Guildhall needs to reference existing task state, it should do so
in a separate informational pattern:

- `Already in this project`
- `Previously imported`
- `Already done`
- `Already shelved`

This information can help the user avoid duplicates, but it is not itself a
question.

## Milestones and Reference Material

Not everything found in docs should become a task.

Guildhall should separate findings into at least three buckets:

- tasks
- milestones / already-done work
- reference material / decisions

Those should be reviewed separately.

Milestones and ADRs should never crowd the same "which tasks should I create?"
question unless the explicit step is "also import reference work as review
tasks."

## Default Behavior Recommendations

For the Looma + Knit class of project, default behavior should be:

- preselect likely task-bearing sources
- leave milestone/reference-heavy sources visible but not preselected
- start review with source-level previews before any individual task cards

If Guildhall detects a very large import corpus, it should:

- show counts early
- encourage review by source
- offer `Import all from this source`
- avoid dumping dozens of individual task cards immediately

## Anti-Patterns To Ban

The redesigned import flow must not:

- ask "pick one" or "pick any" without saying what the choice controls
- ask the user to approve prose that contains many hidden decisions
- mix new import candidates with already-existing tasks
- jump from source discovery straight to final approval
- generate giant synthesis text as the primary UI
- require reading a large wall of copy before understanding the step

## Runtime Shape Needed

The runtime should expose structured import state instead of forcing the UI to
infer it from transcript prose.

At minimum, workspace import needs:

- discovered sources
- per-source metadata
  - kind
  - confidence
  - estimated candidate counts
- candidate tasks grouped by source
- milestones grouped separately
- reference items grouped separately
- existing-task overlap markers
- current wizard step
- blocking status for the active step

The UI should not have to parse a giant markdown transcript to reconstruct the
import journey.

## Success Criteria

The redesign is successful when a cold user can:

- understand what Guildhall found without reading a manifesto
- tell what stage of import they are in
- inspect one source at a time
- review candidate tasks in manageable chunks
- understand exactly what action the primary button will take
- avoid confusing old tasks with new candidate imports

## Recommendation

Treat workspace import as a dedicated guided wizard with explicit source,
preview, and candidate-review phases.

Do not continue patching the current transcript-question flow into clarity.
The current model starts from the wrong primitive. The product needs a real
journey structure, not better lipstick on mixed-abstraction cards.
