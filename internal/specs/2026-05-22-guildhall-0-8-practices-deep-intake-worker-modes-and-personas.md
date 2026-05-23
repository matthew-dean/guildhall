---
title: Practices, deep intake, and worker modes
---

# Practices, deep intake, and worker modes

**Status:** `0.8.0` exploration candidate

This note captures a 0.8.0 direction for making Guildhall better at pulling
project knowledge out of the user's head, choosing the right work style, and
keeping agents from treating every task like generic implementation.

The inspiration comes from small, composable agent workflows such as
Matt Pocock's skills repo:

- `grill-me` and `grill-with-docs` for deep questioning and shared language;
- `diagnose` for disciplined bug investigation;
- `tdd` for red-green-refactor work;
- `triage` for turning messy input into actionable states;
- `zoom-out` for understanding a local change in the wider system.

Guildhall should not adopt slash commands. That is not the product model. The
right Guildhall-native shape is **Practices**: reusable operating behaviors
that the coordinator, worker, reviewer, or user can invoke when the situation
calls for them.

## Product Goal

Guildhall should feel like a capable local team that knows when to ask, when to
inspect, when to build, when to debug, and when to step back.

For 0.8.0, that means:

- the coordinator can run a deep intake when a project or feature is still
  under-explained;
- workers can enter task-appropriate modes such as diagnosis or TDD instead of
  always using the same build prompt;
- Guildhall can propose new practices and personas when repeated work shows a
  gap in the current library;
- the system can grow a project language map from user answers, docs, code, and
  decisions;
- zoom-out and triage become ordinary coordinator moves, not ad hoc chat
  habits;
- every practice leaves evidence: what was asked, what was learned, what mode
  was chosen, and why.

## Non-Goals

- Do not add a slash-command layer.
- Do not make users pick practices before every task.
- Do not turn intake into a long mandatory questionnaire for small projects.
- Do not blindly copy external wording or structure.
- Do not let practices bypass the existing blueprint, review, gate, memory, or
  Corpus Map contracts.
- Do not treat a practice as proof of quality. Practices improve the work loop;
  tests, reviews, and product judgment still matter.
- Do not let agents silently install new practices or personas. Drafting is
  allowed; activation needs review, scope, and approval.

## Practice Model

A Practice is a named behavior module with:

- **Purpose:** what kind of work shape it serves.
- **Trigger:** when the coordinator or worker should consider it.
- **Inputs:** task state, project state, Corpus Map, memory, language map,
  command output, or user answers.
- **Operating loop:** the ordered behavior the agent follows.
- **Outputs:** questions, decisions, memory candidates, task updates, test
  evidence, diagnostics, or implementation changes.
- **Exit criteria:** when the practice is done, blocked, or no longer useful.
- **Audit trail:** a small record explaining why it ran and what it changed.

Practices should be selectable by policy and discretion:

- The **coordinator** chooses practices for framing, triage, zoom-out, intake,
  and sequencing.
- The **worker** chooses or receives practices for implementation style, such
  as diagnose or TDD.
- The **reviewer** checks whether the chosen practice produced the promised
  evidence.
- The **user** can request a practice in plain language, such as "ask me
  everything you need to know" or "debug this carefully."

Practices should also be extensible. If Guildhall repeatedly sees a work shape
that does not fit the built-in library, it should be able to propose a new
practice instead of stretching an existing one until it becomes vague.

## User-Defined Practices

Guildhall should eventually help users create new practices. A practice is
small enough to review, version, enable, disable, and scope.

Examples:

- a release-note writing loop for a specific product;
- an accessibility audit loop for a frontend-heavy repo;
- a localization review loop for a multilingual app;
- a documentation refresh loop after public API changes;
- a story-coherence pass for a prose project;
- a data-migration rehearsal loop for backend work.

### How New Practices Are Born

Guildhall can propose a practice when:

- the same checklist is repeated across several tasks;
- a user gives the same instruction often enough that it looks durable;
- reviewers repeatedly flag the same missing lens;
- a project has domain work that does not fit the default worker modes;
- a successful task leaves behind a reusable playbook.

The proposal should include:

- name and plain-language description;
- intended scope: task, project, or global;
- trigger conditions;
- required inputs;
- operating loop;
- expected outputs and evidence;
- reviewer expectations;
- examples of when not to use it;
- source evidence that motivated the proposal.

Guildhall should draft the practice, then ask for approval before activation.
If the practice is project-specific, it can live with the project. If the same
practice proves useful across projects, Guildhall can suggest copying or
promoting it to global defaults.

### Practice Scope

Practices need scope because a brilliant local habit can become noise
elsewhere.

| Scope | Use For | Approval |
|---|---|---|
| Task-local | One-off loop for a specific task. | Coordinator can suggest; user approves if it changes the task shape. |
| Project | Repo/product/domain-specific habit. | User approves in project settings or from a practice proposal card. |
| Global | User-wide preference across projects. | User explicitly promotes from repeated project evidence. |

The default should be project scope. Global scope should feel earned.

### Practice Files

The file shape should stay simple and inspectable:

```yaml
id: frontend-accessibility-audit
name: Accessibility audit
scope: project
version: 1
description: Check changed UI against keyboard, contrast, labels, and screen-reader basics.
triggers:
  - changed files include Svelte UI surfaces
  - reviewer flags accessibility risk
inputs:
  - task blueprint
  - changed files
  - design tokens
  - browser screenshot when available
loop:
  - inspect changed UI surfaces
  - check labels, focus, contrast, and keyboard path
  - record findings with file or route evidence
  - recommend fixes or pass with evidence
outputs:
  - review findings
  - verification notes
review:
  requiredEvidence:
    - affected route or component
    - concrete issue or pass reason
doNotUseWhen:
  - task changes no user-facing UI
```

The schema should be strict enough for validation but friendly enough to edit
by hand.

## User-Defined Personas

Guildhall should also support new personas. Personas are not practices.

- A **practice** is a loop or method.
- A **persona** is a reviewing or working lens.

The built-in guild can never cover every domain. Users should be able to add a
persona when their project needs a recurring expert voice that is not already
covered by Copywriter, Security Engineer, Test Engineer, UI reviewer, and the
rest of the roster.

Examples:

- Print Production Reviewer for book-layout software;
- Story Continuity Reviewer for narrative projects;
- Accessibility Specialist for frontend-heavy products;
- Compliance Reviewer for regulated data;
- Localization Reviewer for multilingual apps;
- Domain Expert for an industry-specific product.

### Persona Definition

A persona should include:

- name;
- plain-language role;
- when it should participate;
- what evidence it should inspect;
- what it must not overreach into;
- rubric questions;
- severity guidance;
- suggested model lane if different from default reviewer;
- examples of good findings and bad findings.

Personas should be available at project and global scope. A project persona can
stay private to one repo. A global persona can become part of the user's
default guild for matching projects.

### Persona Proposal Flow

Guildhall can propose a persona when:

- reviewers repeatedly miss a domain-specific concern;
- the user keeps asking for the same review lens;
- a project has a clear domain that built-in personas do not cover;
- Deep Intake records a recurring quality bar that maps to an expert lens;
- a failed release or review points to a missing specialist.

The proposal should be reviewed like a small spec:

1. Guildhall explains the gap.
2. Guildhall drafts the persona and rubric.
3. Copywriter reviews labels and tone.
4. The user chooses project or global scope.
5. Guildhall activates it and records provenance.

Personas should not automatically fan out on every task. They need triggers and
cost awareness, just like other reviewers.

## Practice And Persona Library UI

Users who want control should be able to inspect and adjust the library.

Likely surfaces:

- **Settings -> Practices:** enabled practices, suggestions, scope, triggers,
  last used, and evidence.
- **Settings -> Personas:** built-in and user-defined personas, participation
  rules, model lane, and rubric preview.
- **Proposal cards:** "Guildhall noticed this keeps coming up. Save it as a
  project practice?"
- **Promotion cards:** "This practice worked in three projects. Use it
  everywhere?"
- **Task drawer:** which practice and personas were used on this task, and why.

This should stay optional. Most users should never have to manage the library
unless they want that level of control.

## Deep Intake

Deep Intake is the Guildhall version of "interview me until we really
understand the project." It should be calm, guided, and optional. The user
should feel like Guildhall is helping them clarify the work, not interrogating
them.

### When to Trigger

The coordinator should suggest Deep Intake when:

- a new project has little or no project memory;
- the task is broad, product-heavy, or strategically important;
- the user keeps correcting assumptions;
- multiple tasks depend on the same missing context;
- the Corpus Map finds code but not purpose;
- docs exist but do not explain product intent;
- the coordinator cannot choose the next tranche without guessing.

It should not trigger for:

- tiny mechanical edits;
- tasks with a clear accepted blueprint;
- repeat work where the project already has enough memory;
- urgent fixes where the first move should be diagnosis.

### Intake Topics

Deep Intake should gather:

- product goals and non-goals;
- intended audience and user workflows;
- domain terms and forbidden/ambiguous terms;
- existing architecture and why it is shaped that way;
- design-system expectations;
- testing and release expectations;
- privacy, security, and data-safety constraints;
- operational constraints, such as local services or expensive commands;
- product taste, tone, and "please never do that again" preferences;
- known risks, traps, and weird history;
- success signals for the current project stage.

### Question Behavior

Deep Intake should ask one meaningful question at a time. Every question should
include:

- why Guildhall is asking;
- the recommended answer when Guildhall has enough evidence;
- a short set of choices when choices are clearer than free text;
- an escape hatch to skip, defer, or answer in the user's own words.

If the answer can be found by inspecting the repo, docs, prior memory, or
Corpus Map, Guildhall should inspect first and ask only for confirmation.

### Outputs

Deep Intake can produce:

- project brief updates;
- accepted decisions;
- open questions;
- task splits;
- project memory candidates;
- language-map entries;
- design-system notes;
- suggested levers;
- architecture notes or ADR candidates;
- a clearer active tranche.

Nothing broad should silently become policy. Cross-project preferences and
global defaults still need explicit approval.

## Project Language Map

The Project Language Map is a companion to the Corpus Map. The Corpus Map says
"what exists in the repo." The Language Map says "what the project means when
it talks about itself."

It should capture:

- domain terms and short definitions;
- aliases and discouraged names;
- product concepts and their relationships;
- naming conventions visible in code;
- important decisions and where they came from;
- recurring user preferences for labels, copy, and terminology;
- examples of good and bad wording;
- links to source evidence: files, docs, questions, decisions, and memories.

### Why It Matters

Agents waste tokens when they do not share the project's language. Worse, they
invent parallel terms, labels, helpers, and UI concepts. A compact Language Map
helps agents:

- name files, functions, components, and concepts consistently;
- write clearer docs and UI copy;
- ask sharper questions;
- avoid re-litigating settled terms;
- spot when the project is missing a term for a real concept.

### Relationship To Existing Systems

- **Corpus Map:** code and design-system orientation.
- **Memory:** accepted habits, preferences, playbooks, and product ideas.
- **Language Map:** vocabulary, concept relationships, and naming guidance.
- **ADRs / decisions:** durable reasons behind architecture or product choices.

The Language Map should feed worker and reviewer context, but it should stay
small. It is a navigation layer, not a prose archive.

## Worker Modes

Workers should receive an explicit operating mode in the context packet. The
mode tells the worker which loop to follow and what evidence to leave behind.

### `build`

Default implementation mode.

Use when:

- the blueprint is accepted;
- the task is straightforward implementation;
- the main risk is fitting the change into existing code.

Required behavior:

- inspect the Corpus Map and likely files;
- reuse existing abstractions when they exist;
- consider a small abstraction when two or more duplicate ideas appear;
- make the smallest coherent change;
- run the agreed checks;
- summarize changed files, reuse decisions, and verification.

### `diagnose`

Bug and failure-investigation mode.

Use when:

- a command, test, browser flow, or runtime behavior is failing;
- the user asks "why is this broken?";
- the task is a regression, flaky behavior, performance issue, or production
  mystery.

Operating loop:

1. Reproduce the failure or capture why it cannot be reproduced.
2. Minimize the failing path.
3. State the leading hypotheses.
4. Add the smallest useful instrumentation if evidence is missing.
5. Fix the proven cause.
6. Add or update a regression check.
7. Record the mechanism, not just the symptom.

Exit criteria:

- root cause identified with evidence;
- fix verified against the failing path;
- regression protection exists or the absence is explained.

### `tdd`

Test-first feature or fix mode.

Use when:

- behavior can be specified through a stable public interface;
- the task is risky enough that a red test would sharpen it;
- the user asks for TDD or stronger regression coverage;
- the coordinator wants a vertical slice with clear feedback.

Operating loop:

1. Identify the public behavior.
2. Write or update the failing test.
3. Run the test and confirm it fails for the expected reason.
4. Implement the smallest change.
5. Run the focused test and relevant broader checks.
6. Refactor only after the behavior is green.

Test guidance:

- prefer behavior through public APIs or user-visible flows;
- avoid tests that mirror implementation details;
- keep fixtures readable;
- do not write broad brittle tests just to satisfy ceremony.

### `prototype`

Disposable exploration mode.

Use when:

- the team needs to compare interaction models, algorithms, or information
  architecture before committing;
- the question is easier to answer by trying something than debating it.

Required behavior:

- mark output as disposable;
- isolate prototype files or route;
- avoid contaminating production architecture;
- produce a short recommendation after the prototype is inspected.

### `architecture_improve`

Focused systemization mode.

Use when:

- repeated concepts are appearing;
- the Corpus Map shows nearby one-off implementations;
- a worker needs a cleaner seam before the task can be completed well;
- reviewers repeatedly flag abstraction or design-system drift.

Required behavior:

- describe the existing repetition or coupling;
- propose the smallest useful abstraction;
- keep the public behavior stable;
- include tests that survive the refactor;
- avoid broad rewrites unless explicitly approved.

## Coordinator Practices

### Triage

Triage turns messy input into a clear next state. It should classify:

- is this a task, a question, a note, a bug, a product idea, or a memory
  candidate?
- is it ready, blocked, too broad, duplicate, or waiting on a decision?
- what is the smallest useful next move?

Triage should be visible in the task trail. The user should be able to see why
Guildhall created a task, asked a question, deferred work, or merged the input
into an existing plan.

### Zoom-Out

Zoom-Out is a perspective shift, not a literal map UI. The coordinator should
run it when local work may affect the surrounding system.

Triggers:

- a task touches shared components, shared services, schemas, or conventions;
- a worker proposes a new abstraction;
- a bug spans multiple modules;
- the Corpus Map shows related siblings that might be affected;
- the user asks whether the current approach is the right shape.

Outputs:

- relevant surrounding modules;
- existing abstractions to reuse;
- risks outside the touched files;
- whether the task should split, continue, or become a design question.

### Mode Selection

Before dispatching a worker, the coordinator should choose a worker mode:

| Task Shape | Preferred Mode |
|---|---|
| Clear feature slice | `build` or `tdd` |
| Bug, failing test, runtime issue | `diagnose` |
| Risky behavior change | `tdd` |
| Ambiguous UX or algorithm | `prototype` |
| Repeated one-off patterns | `architecture_improve` |
| Broad unclear project ask | Deep Intake before worker dispatch |

The coordinator should explain unusual mode choices in one sentence. Ordinary
choices should stay quiet.

## Context Packet Changes

Worker context should include:

- selected mode;
- selected practice, when a project or user-defined practice is active;
- mode-specific checklist;
- task blueprint;
- relevant Corpus Map excerpts;
- relevant Language Map excerpts;
- accepted project memories;
- likely files and read-next pointers;
- required evidence for handoff.

The context packet should not dump every practice. It should include only the
selected mode and small references to alternatives when a mode switch may be
needed.

## UI Shape

The UI should expose practices lightly:

- In Thread, show "Guildhall is diagnosing this" or "Guildhall is using TDD"
  only when that helps the user understand the work.
- In the task drawer, show the selected mode, why it was chosen, and what
  evidence it produced.
- In Settings -> Memory, show Language Map and practice-derived suggestions
  separately from ordinary project memories.
- In Settings -> Practices and Settings -> Personas, let users review,
  enable, disable, edit, promote, or remove project/global modules.
- In setup/onboarding, offer Deep Intake as an optional way to teach Guildhall
  the project.
- In Needs you, surface intake questions as normal answer cards, not a giant
  form.

The product should avoid making users manage practice mechanics. Most of the
time, Guildhall should choose the right loop and leave a readable trail.

## Data And Audit Trail

A practice run should record:

```yaml
practiceRun:
  id: practice-run-id
  practice: diagnose
  practiceVersion: 1
  selectedBy: coordinator
  taskId: task-id
  reason: "Focused test and browser flow disagree after recent UI change."
  inputs:
    - task-blueprint
    - corpus-map
    - failing-command
  outputs:
    - root-cause-note
    - regression-test
    - verification-result
completedAt: 2026-05-22T00:00:00Z
```

This can begin as task-local evidence. It does not need a new database surface
on day one.

Practice and persona definitions need their own provenance:

```yaml
persona:
  id: story-continuity-reviewer
  name: Story continuity reviewer
  scope: project
  version: 1
  proposedBy: coordinator
  approvedBy: user
  sourceEvidence:
    - deep-intake-answer-id
    - repeated-review-finding-id
  enabled: true
```

## Review Expectations

Reviewers should check the chosen mode:

- `diagnose`: did the worker prove the cause and add regression coverage?
- `tdd`: did the worker show red-green-refactor evidence?
- `prototype`: did the worker keep the prototype isolated and summarize the
  recommendation?
- `architecture_improve`: did the worker improve the seam without a broad
  rewrite?
- `build`: did the worker reuse existing abstractions and verify the task?

Copywriter should review user-facing practice labels, mode names, intake
questions, and settings copy. These labels will appear in tiny UI surfaces, so
they need to be calm, short, and consistent.

## Risks

- **Ceremony creep:** practices could become another thing users must manage.
  Mitigation: coordinator chooses by default; UI stays quiet unless the mode
  matters.
- **Prompt bloat:** dumping every practice into every task would waste context.
  Mitigation: inject only the selected mode.
- **Over-questioning:** Deep Intake could become exhausting. Mitigation: ask
  one question at a time, inspect first, and let users skip or pause.
- **False confidence:** using TDD or diagnosis language does not guarantee good
  work. Mitigation: reviewers check evidence, not labels.
- **Memory pollution:** every answer could become a bad global rule. Mitigation:
  scoped suggestions, provenance, and explicit approval for broad lessons.
- **Persona sprawl:** every annoyance could become a new reviewer. Mitigation:
  require trigger rules, examples, and user approval before activation.
- **Self-modifying prompt drift:** agents could make their own instructions
  worse over time. Mitigation: proposed practice/persona changes are reviewed
  artifacts, not silent prompt edits.
- **Cost creep:** more personas can mean more model calls. Mitigation: default
  to project scope, trigger only when relevant, and show last-used/cost signals
  in settings.

## 0.8.0 Candidate Slices

### Slice 1: Practice Contract

- Define practice ids, mode metadata, and task-local practice evidence.
- Add selected mode to worker context packets.
- Add reviewer checks for mode evidence.

### Slice 2: Diagnose Mode

- Add coordinator detection for bug/failure tasks.
- Inject the diagnose loop into worker context.
- Require root-cause and regression evidence in handoff.
- Add tests around failing-command recovery and bug-task routing.

### Slice 3: TDD Mode

- Add lever and coordinator discretion for TDD.
- Inject red-green-refactor instructions only when selected.
- Capture red/green evidence in task notes or gate results.

### Slice 4: Deep Intake

- Add optional intake flow for new or under-explained projects.
- Store answers as project brief updates, decisions, questions, memories, and
  Language Map candidates.
- Keep intake resumable and non-blocking.

### Slice 5: Project Language Map

- Create a compact language-map file under project memory.
- Build deterministic extraction from docs and accepted intake answers.
- Add semantic enrichment later if cheap enough.
- Inject only relevant language entries into worker/reviewer context.

### Slice 6: Coordinator Triage And Zoom-Out

- Add triage classification for messy user input.
- Add zoom-out trigger when tasks touch shared architecture or repeated
  concepts.
- Record mode-selection reasons and task-split recommendations.

### Slice 7: Practice Library

- Add project/global practice definitions with schema validation.
- Add proposal cards for new practices.
- Add Settings -> Practices for reviewing, enabling, disabling, editing, and
  promoting practices.
- Inject only active, relevant practice instructions into context packets.

### Slice 8: Persona Library

- Add project/global persona definitions with rubric validation.
- Add proposal flow for missing expert lenses.
- Add Settings -> Personas for participation rules, model lane, and rubric
  preview.
- Route reviewers through user-defined personas only when trigger rules match.

## Acceptance Criteria

- Guildhall can select `build`, `diagnose`, or `tdd` before worker dispatch.
- Worker context includes only the chosen mode's loop.
- Reviewer output checks mode-specific evidence.
- Deep Intake can ask a user one focused question and store the answer with
  provenance.
- A project can maintain a small Language Map and inject relevant terms into
  worker context.
- Practice runs appear in the task trail or drawer without overwhelming the
  main flow.
- Guildhall can draft a new project-scoped practice from repeated evidence and
  keep it inactive until approved.
- Guildhall can draft a new project-scoped persona with a rubric and trigger
  rules, then expose it in Settings -> Personas.
- Users can skip intake or continue with ordinary work.
- Broad learned behavior still requires approval before becoming global.

## Open Questions

- Should `architecture_improve` be a worker mode, a reviewer escalation, or a
  coordinator-only practice?
- Should TDD be a default for some domains, or always opt-in until a project
  proves it wants that style?
- How much of the Language Map should be model-generated versus deterministic
  from accepted answers and docs?
- Should Deep Intake produce ADR candidates automatically, or only suggest
  them when a decision has real architectural weight?
- Should practice names be visible to users, or should the UI translate them
  into plain status phrases such as "Debugging carefully" and "Writing the test
  first"?
- How editable should practice/persona YAML be in the UI, versus using a
  friendlier form with advanced raw editing behind it?
- Should user-defined personas be allowed to choose stronger models by default,
  or should model escalation always require a separate settings approval?
