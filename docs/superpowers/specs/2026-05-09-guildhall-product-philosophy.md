# Guildhall Product Philosophy

## Purpose

This document is the working product bible for Guildhall's user journey.

Its job is not to describe every feature. Its job is to keep the product
understandable.

When a screen, card, wizard, or flow feels confusing, overwhelming, or too
internal, use this document to reason about what went wrong and what should
change.

## The Core Promise

Guildhall should feel like a guided control room for software work.

It should not feel like:

- a log viewer
- a manifesto generator
- an agent console that expects users to decode internal state
- a pile of dense cards asking for vague approval

The user should be able to move through the product and answer simple
questions:

- Where am I?
- What is Guildhall showing me?
- Why am I seeing this now?
- What does Guildhall want from me?
- What will happen if I click the main button?

If the UI cannot answer those questions clearly, the product is not yet doing
its job.

## Product Values

### 1. Guide, do not dump

Guildhall should guide the user through work one step at a time.

Do not generate a large artifact and ask the user to bless it whole. Break it
into decisions.

### 2. Ask one thing at a time

Each meaningful surface should ask for one decision about one thing.

Bundling many implicit decisions into one screen is one of Guildhall's primary
failure modes.

### 3. Show just enough, then let the user inspect

The default surface should be concise. Extra detail should be available when
the user wants it, not forced on them before they can act.

Sometimes the right form of "inspection" is a short back-and-forth, not a
larger card tree.

Guildhall should stay structured-first, but it should not force every
clarification path into a rigid wizard if a scoped conversation would be more
natural and less confusing.

A good conversational checkpoint has these traits:

- it is anchored to one object or decision
- it has a clear end goal
- it knows what shape it is trying to produce
- it can ask follow-up questions only until that shape is complete
- it closes cleanly back into structured state

Examples:

- "Shape task 27 into a complete task brief"
- "Clarify the project split for this workspace"
- "Resolve the missing success criteria for this imported draft"

This is not a license to turn Guildhall into a prompt box. It is a reminder
that a tightly scoped conversation can sometimes be the most humane way to
reach a structured outcome.

### 4. Explain user meaning, not system internals

Labels should describe what something means to a person, not what it is called
inside the runtime.

Avoid leading with:

- coordinator
- steward
- lever
- spec-agent
- stop reason
- internal provider state
- importer transcript details

unless the user is specifically drilling into advanced/debug detail.

### 5. Separate levels of abstraction

Never silently mix:

- source documents
- summaries
- candidate tasks
- existing tasks
- final approved state

If multiple levels must appear together, the boundaries must be explicit.

### 6. Make actions feel safe

The user should know what an action will do before clicking it.

Primary actions should feel intentional, not magical or risky.

### 7. Guide toward strong outcomes

Guildhall should not stop at being merely understandable. It should help the
user make good decisions.

That means the product should be opinionated in a useful way:

- leading with recommended paths
- nudging toward higher-quality outcomes
- helping the user avoid accidental low-quality or incomplete choices
- shaping work toward a result that fits the user's goals, constraints, and
  working style

The product should feel like a capable guide, not a neutral form generator.

When there is a clear best-practice path, Guildhall should surface it clearly.
When there are meaningful tradeoffs, Guildhall should explain them briefly and
help the user choose well.

### 8. Do most of the work before asking the human

When Guildhall asks the user for a decision, it should have already done most
of the heavy lifting.

Human checkpoints should feel like:

- confirmation
- correction
- prioritization
- a light final judgment

They should not feel like:

- deciphering a giant draft
- reconstructing what Guildhall found
- doing first-pass synthesis by hand
- making twelve hidden decisions at once

The ideal feeling is:

- Guildhall has already prepared this well
- the recommendation is sensible
- I can inspect the evidence if I want
- approving or correcting this is easy

If a step feels tedious, mentally expensive, or like the user is doing the
agent's unfinished homework, Guildhall has asked too early or prepared too
poorly.

In some cases, the best preparation is:

- a recommended structured path, plus
- a contextual conversation lane for clarifying the few things Guildhall still
  cannot confidently infer

That conversation should live inside the work item it is clarifying, not as a
global escape hatch detached from context.

### 9. Build systems, not one-off screens

Guildhall should assume that LLMs naturally drift toward bespoke output unless
the product constrains them.

That means every UI or journey fix should also ask:

- would Guildhall have prevented this mistake if it were building itself?
- was a shared primitive missing?
- was a review rubric missing?
- was the product philosophy too vague at the moment of implementation?
- did the system leave too much room for ad hoc interpretation?

If the answer is "yes," the right fix is not just the local screen polish.
The right fix also includes a stronger system:

- clearer shared primitives
- clearer content hierarchy rules
- stronger review questions
- better defaults for future agents

Guildhall should be designed so that future builders are guided into the right
answer instead of merely corrected after they guessed wrong.

### 10. Expose work structure, hide judgment structure

Guildhall should expose the structure the user actually manages:

- projects
- project goals, tasks, and real product boundaries
- tasks
- approvals
- goals

Guildhall should not require the user to model Guildhall's internal staffing
theory in order to use the product well.

That means the product should prefer:

- one coordinating layer per project
- visible work structure only when it helps the user understand the project
- internal perspective selection underneath

over:

- user-managed steward rosters
- pseudo-org-chart setup
- task assignment to named stewards as a primary mental model

The coordinating layer should assemble the right context and pull in the right
perspectives for the decision at hand:

- UI clarity
- accessibility
- integration risk
- release readiness
- product quality
- market research

Those perspectives may change from one task, approval, or review to the next.
They should not have to exist as fixed user-facing actors just to preserve
judgment quality.

If a perspective helps the product reason better, Guildhall may use it.
If the perspective does not help the user think better, Guildhall should avoid
forcing the user to configure or manage it directly.

### 11. Use color as a semantic system

Guildhall should have one coherent color palette that is applied on purpose.

Color is not there to make individual screens look nicer in isolation. It is
there to help the user understand:

- what is primary
- what is healthy
- what needs caution
- what is broken
- what is quiet metadata

That means color decisions should never belong to just one discipline. They
should be treated as a collaboration between:

- color theory
- UI hierarchy
- accessibility

If a screen introduces a one-off blue, green, yellow, or red that does not map
back to a shared semantic role, the product has drifted.

Guildhall should be able to answer:

- why is this color here?
- what semantic role does it carry?
- where else is that same role used?
- is it visually distinct enough to support the decision without relying on
  color alone?

The product should feel like it has one palette and one visual language, not a
series of attractive local guesses.

## The Journey Model

Most guided Guildhall flows should move through some version of this sequence:

1. **Orient**
   - what did Guildhall find?
   - what part of the project is this about?

2. **Choose scope**
   - what should be included?
   - what should be skipped?

3. **Inspect evidence**
   - what is Guildhall basing this on?
   - can I open the source?

4. **Confirm candidates**
   - what concrete items will be created, approved, rerun, or changed?

5. **Commit**
   - perform the actual mutation

Not every flow needs all five stages, but the shape should remain legible.

Guildhall should not skip from orientation to final approval if the user has
not yet seen the candidate items they are being asked to approve.

When a flow gets stuck because the remaining ambiguity is narrow but awkward to
model, Guildhall should be allowed to switch from a rigid wizard step into a
scoped conversational step. That conversation should still respect the same
journey rules:

- one object
- one decision family
- one known outcome shape
- clear return to the main flow

Within that journey, Guildhall should actively steer toward the best likely
result. A guided flow is not just a sequence of steps; it is a sequence of
well-designed recommendations that help the user reach a strong outcome with
less guesswork.

At each human checkpoint, the work should feel mostly done already. The user
should be stepping in to confirm or refine a well-prepared proposal, not to
create the proposal from scratch under a different name.

## The Card Rule

Every card should have:

- one purpose
- one dominant question
- one dominant action
- one obvious next step

If a card needs a paragraph to explain what question it is asking, it is
probably doing too much.

## The Screen Rule

Every screen should have one clear job.

Examples:

- **Projects**
  - see what projects exist
  - open one
  - start or stop work

- **Thread**
  - answer questions
  - approve drafts
  - handle interruptions or decisions

- **Work**
  - inspect tasks
  - manage task state
  - review progress

- **Settings**
  - configure behavior
  - not perform core workflow actions

If a screen’s purpose cannot be explained in one or two sentences, its
boundaries are probably muddy.

## Levels of Abstraction

Guildhall should treat these as separate layers:

### Source

The original material:

- docs
- notes
- roadmaps
- transcripts
- code references

### Summary

Guildhall's interpretation of that source material.

### Candidate

A proposed task, split, action, or policy that has not yet been committed.

### Existing state

Something already true in the project:

- an existing task
- a finished task
- a shelved task
- active config

### Final state

The result after the user confirms and Guildhall commits a change.

### Rule

A surface should make it obvious which layer the user is looking at.

The worst confusion happens when Guildhall shows multiple layers at once
without telling the user which is which.

## A Good Wizard Step

A good wizard step should make the following clear:

- what Guildhall found
- what decision is being requested
- what is currently selected
- what happens next

Example:

- `Guildhall found 2 work areas. Is that split right?`

Why this works:

- one clear subject
- one clear question
- no hidden second question
- the action can be obvious:
  - `Yes, use this split`
  - `Change the split`

## A Bad Wizard Step

Bad steps usually look like one of these:

### 1. The manifesto

Guildhall shows a large generated block of prose and then asks the user if
they agree.

Why it fails:

- many hidden decisions
- too much reading before action
- unclear what exactly is being approved

### 2. The mixed abstraction card

The same card shows:

- source docs
- inferred summary
- candidate tasks
- existing tasks

Why it fails:

- user cannot tell what level they are looking at
- the action target is ambiguous

### 3. The optional-looking blocker

A step is actually required, but it looks like a side-question or background
detail while later steps continue to appear.

Why it fails:

- the user cannot trust the flow
- the product feels inconsistent and premature

### 4. The internal-status badge

A label describes implementation shape instead of user meaning.

Why it fails:

- the user learns system vocabulary before product meaning
- the label answers the wrong question

## Action Design Rules

### Primary actions

Primary actions should say what happens next.

Prefer:

- `Review sources`
- `Create tasks`
- `Use this split`
- `Run one task`

Avoid:

- `Continue`
- `Submit`
- `Approve`

unless the context already makes the outcome unmistakable.

Primary actions should also reflect Guildhall's recommendation when there is a
clear default path. The best next move should be obvious from both placement
and wording.

### Secondary actions

Secondary actions should support:

- inspection
- correction
- safe deferral

They should not visually compete with the main path unless the choice is truly
balanced.

### Dangerous or consequential actions

If an action changes project state in a meaningful way, the user should be able
to infer that before clicking it.

## Copy Rules

Copy should:

- explain the current question
- use user-facing language
- stay short by default
- get more detailed only where necessary

Copy should not:

- repeat internal runtime concepts
- explain implementation details the user did not ask for
- bundle many caveats into one wall of text
- rely on the user inferring what "pick one" or "pick any" controls

## Inspection Rules

Details should be inspectable at every important stage.

The user should be able to open:

- original source docs
- summarized evidence
- candidate task lists
- related existing state

But inspection should not be required for the user to understand the main
decision on the screen.

## The “Cold User” Test

Every important screen or card should be able to pass this test:

Could a first-time user explain, in one sentence:

- what this surface is showing
- what decision it wants from them
- what the primary button will do

If not, the surface is not ready.

## The “Why Now?” Test

The user should also be able to answer:

- why am I seeing this right now?

If Guildhall cannot answer that, the sequence is probably wrong or the surface
is missing context.

## The “Can I Trust This?” Test

Trust comes from:

- clear step boundaries
- visible evidence when needed
- obvious next actions
- consistent language
- no surprise mutations

Users should not feel like Guildhall is doing hidden reasoning they are only
allowed to bless after the fact.

Trust also comes from feeling guided competently. The user should sense that
Guildhall is helping them arrive at the right result, not merely asking them
to navigate a maze of choices alone.

## Review Questions For Any Screen Or Card

Use this checklist during design or review.

### Purpose

- What job is this surface helping the user do?
- Is that job clear from the heading and structure?

### Question

- What exact question is Guildhall asking here?
- Is there only one dominant question?

### Level

- Is this source, summary, candidate, existing state, or final state?
- Is the level obvious to the user?

### Action

- Is there one obvious primary action?
- Does the action label say what happens next?
- Is the action safe-feeling and understandable?
- Is Guildhall making its recommendation clear when there is a best next step?

### Sequence

- Why is this step happening now?
- Should another step have happened first?
- Is the user being shown something prematurely?

### Detail

- Is any essential information missing?
- Is there too much information by default?
- Can the user inspect more without being forced to?

### Consistency

- Does this use the same language as nearby surfaces?
- Is it re-describing the same state in a new confusing way?

### Trust

- Could the user tell what will be changed if they proceed?
- Are existing state and proposed new state clearly separated?
- Does the flow help the user make a strong decision, or does it merely expose
  options without guidance?
- Has Guildhall already done enough preparation that this checkpoint feels
  easy rather than tedious?

## Failure Patterns To Watch For

- giant blocks of generated prose as the main UI
- multi-step flows rendered as co-active optional cards
- source material and proposed tasks shown as if they are the same thing
- already-existing tasks shown as if they are new import candidates
- labels that only make sense if you know Guildhall internals
- “approve this” flows where “this” contains many hidden decisions
- buttons that do not look like buttons
- buttons whose labels do not imply their effect

## What This Means For Implementation

When runtime and UI data structures do not support these rules, we should
change the structures.

Do not keep forcing clear product journeys out of ambiguous transcript blobs if
the model shape itself is wrong.

The product should be allowed to demand:

- step-aware runtime state
- source-aware candidate grouping
- strict gating for blocking steps
- explicit separation of existing vs proposed state

## How To Use This Document

Use this philosophy doc when:

- designing a new flow
- reviewing a confusing screen
- explaining why a surface feels overwhelming
- deciding whether a problem is copy, structure, or runtime shape

If a screen feels bad, do not start by rewriting the labels.

First ask:

- is the journey wrong?
- is the step mixed?
- is the abstraction level unclear?
- is Guildhall asking too much at once?

That is usually where the real fix begins.
