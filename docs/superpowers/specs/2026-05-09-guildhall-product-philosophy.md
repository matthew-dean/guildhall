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

### 4. Explain user meaning, not system internals

Labels should describe what something means to a person, not what it is called
inside the runtime.

Avoid leading with:

- coordinator
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
