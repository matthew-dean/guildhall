---
title: Practices, deep intake, and worker modes
---

# Practices, deep intake, and worker modes

**Status:** `0.8.0` exploration candidate

This note captures a 0.8.0 direction for making Guildhall better at pressure
testing project ideas, pulling locked-away knowledge out of the user's head,
choosing the right work style, and keeping agents from treating every task like
generic implementation.

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

- the coordinator can run a pressure-test intake that interviews across every
  relevant domain until the project, feature, or spec is airtight enough to
  build from;
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
- Do not turn routine mechanical edits into intake rituals.
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

The draft should be reviewed by a built-in **Practice Designer** persona before
activation. This persona's job is not to make every practice sound impressive;
it is to keep practices small, useful, scoped, and evidence-producing.

Practice Designer should check:

- is this really a reusable loop, or is it a one-time task?
- does it have a clear trigger and clear "do not use when" boundary?
- does the operating loop produce evidence a reviewer can inspect?
- is the scope project/task/global justified by source evidence?
- does it duplicate an existing practice or built-in worker mode?
- does it risk prompt bloat or ceremony creep?
- can a future agent follow it without needing hidden context?

If a proposed practice fails that bar, Guildhall should revise it, keep it as a
task-local note, or decline to activate it.

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

### Practice Participation Rules

Practices need explicit participation rules so they do not become vibes in the
prompt. A practice should define when it is:

- **suggested:** Guildhall may propose it, but should not change the task shape
  without approval;
- **automatic:** Guildhall can apply it quietly because the trigger is reliable
  and low-cost;
- **manual:** the user or coordinator must explicitly request it;
- **suppressed:** Guildhall should not apply it even if weak signals match.

Rules should be structured underneath, but explainable in plain language. The
matching inputs can include:

- task kind: bug, feature spec, release intake, investigation, implementation;
- task state: exploring, ready, in progress, review, gate check;
- changed files, file types, route names, package names, or detected languages;
- Corpus Map areas and project domains;
- failure signals: failing command, browser repro, flaky run, provider throttle;
- user intent phrases: "debug carefully," "ask me everything," "write tests
  first," "prototype this";
- project levers and settings;
- recent reviewer findings or repeated task history;
- cost and model budget.

A practice rule should produce a decision record:

```yaml
practiceMatch:
  practice: pressure-test-intake
  decision: suggested | automatic | manual | suppressed
  confidence: high | medium | low
  reason: User is proposing a 0.9.0 release direction, not a ready implementation task.
  matchedSignals:
    - intakeTarget.type=release
    - user text mentions 0.9.0
  blockedBy: []
```

This gives Guildhall an auditable "why this practice?" answer without asking
the user to understand predicates.

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
- Pressure-Test Intake records a recurring quality bar that maps to an expert
  lens;
- a failed release or review points to a missing specialist.

The proposal should be reviewed like a small spec:

1. Guildhall explains the gap.
2. Guildhall drafts the persona and rubric.
3. Persona Designer reviews the draft for role clarity, trigger quality,
   overreach, rubric usefulness, and cost.
4. Copywriter reviews labels and tone.
5. The user chooses project or global scope.
6. Guildhall activates it and records provenance.

Personas should not automatically fan out on every task. They need triggers and
cost awareness, just like other reviewers.

Guildhall should ship a built-in **Persona Designer** persona for this review.
Its job is to make sure a new persona is a real expert lens, not a vague vibe or
an expensive duplicate of an existing reviewer.

Persona Designer should check:

- what distinctive judgment does this persona add?
- what evidence should it inspect before speaking?
- when should it participate, and when should it stay out?
- does the rubric produce actionable findings rather than generic advice?
- does the persona have severity guidance and examples of good/bad findings?
- does it duplicate, conflict with, or overrule an existing persona?
- should the persona be task-local, project-scoped, or global?
- what cost/model lane is justified by its expected value?

If the draft fails, Guildhall should refine the persona or keep the need as a
watch item until repeated evidence justifies a real persona.

### Persona Participation Rules

Personas should use the same participation model as practices, but the decision
answers a slightly different question: should this expert lens inspect the
work?

A persona can participate in different phases:

- **spec contribution:** ask domain-specific questions while the task is still
  being shaped;
- **worker persona:** guide implementation when the work strongly belongs to
  that specialty;
- **reviewer fanout:** inspect completed work independently;
- **gate checks:** run deterministic checks when the persona owns them.

The first implementation can build on the existing guild pattern: each persona
has an applicability predicate over task/project signals, and Guildhall records
which signals matched. User-defined personas should start with friendly rule
builders instead of raw code:

- "Use this persona when changed files include..."
- "Use this persona when the task mentions..."
- "Use this persona for these project domains..."
- "Use this persona when reviewers flag..."
- "Do not use this persona when..."

Advanced users can inspect or edit the structured rule later, but the ordinary
surface should say:

> Story continuity reviewer joins when a task changes plot, character arcs, or
> continuity notes. It does not join for build tooling or release packaging.

Every persona run should record why it joined or why it was skipped. For costly
personas, low-confidence matches should become suggestions instead of automatic
fanout.

### User-Requested Personas

Guildhall should let the user add one or more personas to a specific unit of
work, even when automatic applicability did not pick them.

This is useful when the user knows the work has a concern the signals cannot
see yet: "have Security look at this," "also ask the Copywriter," "I want the
Story Continuity reviewer on this release," or "run Accessibility on this modal
even if it looks backend-heavy."

Manual persona assignment should be:

- **additive:** it adds a lens; it does not remove automatically required
  reviewers or deterministic gates;
- **task-scoped by default:** the override applies to this task/release/spec
  unless the user explicitly promotes it to a project rule;
- **phase-aware:** the user can request the persona for spec shaping, worker
  guidance, final review, gate checks, or "all relevant phases";
- **cost-aware:** Guildhall should show when the request adds model calls or a
  stronger model lane;
- **audited:** the task should record who requested the persona, why, and which
  phase it joined;
- **correctable:** if a user repeatedly adds the same persona for the same
  pattern, Guildhall can propose turning that into a participation rule.

The UI can expose this in the task drawer or spec review surface as **Add
review lens** / **Add persona**. The default list should show likely personas
first, followed by search. The user should not need to understand guild routing
to say "bring in an accessibility reviewer."

The spec should also auto-fill the planned persona roster before work starts.
During spec review, Guildhall should show:

- automatically matched personas, with "why this lens applies";
- manually requested personas already attached to the unit of work;
- likely-but-not-selected personas as suggestions;
- phase labels: spec, worker, review, gate, or all relevant phases;
- estimated cost/model impact when a selection adds extra calls.

This turns persona assignment into part of approving the spec. The user can see
the default roster, add another lens smoothly, and then let Guildhall carry that
review plan through implementation and review.

The spec record should persist the planned roster:

```yaml
personaPlan:
  auto:
    - persona: accessibility-specialist
      phases: [spec, review, gate]
      reason: Changed UI surfaces include keyboard/focus-sensitive modal work.
  requested:
    - persona: security-engineer
      phases: [review]
      requestedBy: user
      reason: User wants an extra auth/permission pass.
  suggested:
    - persona: copywriter
      reason: Task includes visible labels and status copy.
```

Manual requests should still respect hard safety limits. If the persona is
disabled, unavailable, too costly for the current settings, or missing the
required evidence, Guildhall should explain that and offer a narrower option
instead of silently ignoring the request.

## Practice And Persona Library UI

Users who want control should be able to inspect and adjust the library.

Likely surfaces:

- **Settings -> Practices:** enabled practices, suggestions, scope, triggers,
  last used, and evidence.
- **Settings -> Personas:** built-in and user-defined personas, participation
  rules, model lane, and rubric preview.
- **Built-in builders:** Practice Designer and Persona Designer appear as
  guardrail personas for creating high-quality practices/personas, not as
  ordinary reviewers on every task.
- **Proposal cards:** "Guildhall noticed this keeps coming up. Save it as a
  project practice?"
- **Promotion cards:** "This practice worked in three projects. Use it
  everywhere?"
- **Task drawer:** which practice and personas were used on this task, and why.
- **Add persona:** task/spec/release surfaces let the user add an extra review
  lens for this unit of work without changing global participation rules.
- **Spec roster preview:** spec review shows auto-selected, requested, and
  suggested personas before the user approves the work.

This should stay optional. Most users should never have to manage the library
unless they want that level of control.

The UI should expose participation rules in layers:

- **Default view:** plain-language "Used when..." and "Not used when..."
  summaries, last-used timestamp, and an enable/disable toggle.
- **Decision view:** on a task, show "Why did this run?" with matched signals
  and a short reason.
- **Adjustment view:** simple chips and selectors for file patterns, task kinds,
  project domains, keywords, and reviewer-finding triggers.
- **Advanced view:** raw YAML/JSON for users who want exact control.

This keeps the common case light while still making Guildhall accountable. The
user should not have to author predicates, but they should be able to understand
and correct them.

## Pressure-Test Intake

Pressure-Test Intake is the Guildhall version of "interview me until the spec
cannot hide fuzzy thinking anymore." It is not just for under-explained
projects. Most projects will not already have this level of detail, because
most agents ask surface-level questions and stop before the useful follow-up.

The goal is to make a project, feature, release, or task spec airtight,
comprehensive, and detailed enough that workers and reviewers are not guessing
from polite summary prose. Guildhall should reason about the domains it needs
to understand, inspect the repo and docs for answers first, then interview the
user one question at a time until each domain is clear or explicitly deferred.

### When to Use It

The coordinator should suggest Pressure-Test Intake when:

- a project, feature, release, or task needs a serious spec before build work;
- the work depends on product taste, domain judgment, user workflows, risk
  tolerance, or operational details that may live in the user's head;
- a previous spec looks plausible but could still be missing edge cases,
  non-goals, constraints, success signals, or failure modes;
- the user keeps correcting assumptions;
- multiple tasks depend on the same unstated project knowledge;
- the Corpus Map finds code but not purpose;
- docs exist but do not explain product intent;
- the coordinator cannot choose the next tranche without guessing.

It should not run for:

- tiny mechanical edits;
- urgent fixes where the first move should be diagnosis;
- tasks where the user explicitly asks to skip intake and accept the risk;
- repeat work where a prior Pressure-Test Intake already covered the same
  domain and no new facts have appeared.

### Starting A New Intake Later

Pressure-Test Intake is not a one-shot setup ceremony. A project can need a new
intake months later for a release, feature, strategy change, redesign, risky
migration, or product idea. For example, "I have ideas for Guildhall 0.9.0"
should start a release-level intake, not become a narrow implementation task.

The UI does not need a separate **New Spec** button. **New Task** can stay the
plain entry point if the modal branches first by intent. The first step should
establish what kind of work the user is creating:

- **Implementation task:** a concrete change that is ready to become a task
  brief and acceptance criteria.
- **Bug or failure:** a broken behavior that should enter diagnose mode.
- **Release or milestone idea:** a larger body of work, such as `0.9.0`, that
  needs release-level Pressure-Test Intake before task splitting.
- **Feature or product spec:** a proposed capability that needs domain
  interview, edge cases, non-goals, and acceptance criteria before build work.
- **Question or investigation:** something Guildhall should answer or research
  before deciding whether work exists.
- **Memory or preference:** durable project knowledge that should update memory,
  Language Map, practices, or personas rather than create immediate work.
- **Note or parking lot item:** useful context that should be saved without
  pretending it is ready to build.

The modal can infer this from the user's free text, but it should show the
classification before committing the item. If Guildhall is unsure, it should ask
one routing question such as "What kind of work is this?" and then reflow the
draft into the right lane.

The output of routing should be a typed intake target:

```yaml
intakeTarget:
  type: release | feature | task | bug | investigation | memory | note
  title: Guildhall 0.9.0
  source: new-task-modal
  pressureTestRequired: true
  nextStep: pressure-test-intake
```

That keeps the product surface simple while giving the runtime the right shape:
users still click **New Task**, but Guildhall may create a release intake,
feature spec, investigation, memory candidate, or ordinary task depending on
what the user is actually trying to do.

### Domain Map

Before asking the user anything, Guildhall should draft a domain map for the
thing being specified. The domains vary by project, but common ones include:

- product goals and non-goals;
- intended audience and user workflows;
- domain terms and forbidden/ambiguous terms;
- data model, data ownership, migrations, and lifecycle;
- permissions, roles, privacy, security, and compliance constraints;
- existing architecture and why it is shaped that way;
- integration boundaries, APIs, local services, and external dependencies;
- design-system expectations;
- testing and release expectations;
- operational constraints, such as local services or expensive commands;
- product taste, tone, and "please never do that again" preferences;
- known risks, traps, and weird history;
- success signals for the current project stage.

For each domain, Guildhall should first inspect the codebase, docs, Corpus Map,
project memory, prior decisions, and accepted plans. If that evidence answers
the question, Guildhall should use it and ask only for confirmation when the
answer affects important behavior.

### Question Behavior

Pressure-Test Intake should follow the useful part of the grill-me pattern:

- ask questions one at a time;
- if a question can be answered by exploring the codebase, explore the codebase
  instead;
- ask a follow-up when the answer suggests there is more detail to uncover;
- after each domain seems covered, ask "Is there anything else I should know
  about X?";
- keep asking until the domain is either clear, explicitly deferred, or no
  longer relevant to the spec.

Every user-facing question should include:

- why Guildhall is asking;
- the evidence Guildhall already found, when relevant;
- the recommended answer or hypothesis when Guildhall has enough evidence;
- a short set of choices when choices are clearer than free text;
- an escape hatch to skip, defer, or answer in the user's own words.

The loop should not batch a giant questionnaire into Thread. It should keep the
conversation answerable while still being exhaustive over time.

### LLM Operating Contract

Pressure-Test Intake needs stronger instructions than "ask good questions."
The agent should receive an explicit operating contract:

1. Build a domain map for the spec before asking the user anything.
2. For the active domain, inspect available evidence before drafting a question.
3. Ask exactly one question.
4. After the user answers, decide whether the answer:
   - resolves the domain;
   - opens a useful follow-up;
   - contradicts repo/docs evidence;
   - reveals a new domain;
   - should become an assumption, decision, task split, Language Map entry, or
     memory candidate.
5. Stay in the same domain while useful follow-ups remain.
6. Ask "Is there anything else I should know about X?" before closing that
   domain.
7. Move to the next domain only after closing, deferring, or dropping the
   current domain.
8. Produce an intake-state update after every answer, even when the next move is
   another question.

The context packet should frame the agent's job as discovery and pressure
testing, not as drafting a spec as quickly as possible. A useful instruction is:

> Your goal is to find the missing facts, edge cases, constraints, domain
> language, and user-held judgment that would make this spec fail later. Do not
> optimize for fewer questions. Optimize for asking the next highest-leverage
> question, one at a time, after checking whether the answer is already in the
> repo or project memory.

That keeps the LLM from treating "ask one question at a time" as permission to
ask one shallow question and then proceed.

### Persistent Intake State

The intake loop should persist its own state so the next agent turn can resume
without reconstructing the interview from transcript prose. A minimal state
shape:

```yaml
pressureTestIntake:
  id: intake-id
  target:
    type: project | release | feature | task
    id: target-id
  status: active | paused | complete
  activeDomainId: product-workflows
  domains:
    - id: product-workflows
      title: Product workflows
      whyItMatters: The worker needs to know which user journey defines success.
      status: active | open | closed | deferred | dropped
      knownFacts:
        - fact: Users create a project from a rough idea.
          source: docs/guide/new-project.md
      openUnknowns:
        - What counts as enough detail before task generation?
      askedQuestions:
        - questionId: q-123
          prompt: What should Guildhall do when the user gives only a rough idea?
          answered: true
      followUpCandidates:
        - The answer mentions approval gates but not who can approve them.
      closeoutAsked: false
  newDomains:
    - billing-and-entitlements
  outputs:
    assumptions: []
    decisions: []
    languageMapCandidates: []
    taskSplitCandidates: []
```

This state should be the source of truth for the next question. Transcript is
evidence, not the planner.

### Domain Loop

Each domain should move through a small state machine:

1. **Seeded:** Guildhall thinks this domain may matter.
2. **Inspected:** repo/docs/memory evidence has been checked.
3. **Active:** the agent is asking one question at a time in this domain.
4. **Follow-up:** an answer created a more specific question worth asking before
   leaving the domain.
5. **Closeout:** Guildhall asks whether there is anything else it should know
   about the domain.
6. **Closed:** the domain has enough detail for the current spec.
7. **Deferred:** the user or coordinator explicitly postpones it.
8. **Reopened:** later answers or code evidence show the domain was not actually
   settled.

The important instruction is that "next domain" is a deliberate transition, not
the LLM drifting because it has a list of topics. The agent should name the
domain it is currently pressure testing in the question metadata and in the
intake-state update.

### Interviewer And Producer Roles

Pressure-Test Intake should feel less like one agent filling out a form and
more like an interviewer working with a producer.

The **interviewer** owns the live conversation:

- asks the current domain's next question;
- listens for concrete facts, examples, tensions, and hidden assumptions;
- asks follow-ups when the answer opens a door;
- keeps the user-facing flow calm and one-question-at-a-time;
- records the answer, source, and immediate interpretation.

The **producer** owns the pressure:

- reviews the interviewer's notes before the domain closes;
- asks what was interesting, vague, contradictory, or underexplored;
- checks whether the interviewer accepted surface-level language too quickly;
- points out missed follow-up paths;
- compares the answer against repo/docs/memory evidence;
- decides whether the domain is ready for closeout, needs another question, or
  exposed a new domain.

Prefer implementing this first as a single agent with an explicit producer
self-critique step after each answer. That keeps the loop simple, cheap, and
easy to reason about while the product behavior is still being proven. If live
use shows the self-critique is too soft, repetitive, or prone to accepting its
own shallow interview, the role can split into a second agent or reviewer pass.
The product contract matters more than the implementation shape: the interview
should gather material substance, and the producer should challenge whether the
interview went deep enough.

The producer should be especially alert for:

- a phrase that sounds meaningful but has no concrete example;
- a workflow mentioned only from the happy path;
- a constraint with no owner, threshold, or enforcement point;
- an answer that names a risk but not the mitigation;
- a domain that was closed without asking the closeout question;
- an interesting aside the interviewer failed to follow up on.

After every answered question, the producer should choose one of four outcomes:

- **continue domain:** the answer deserves a follow-up in the same domain;
- **closeout domain:** the next question should ask whether there is anything
  else to know about this domain;
- **open new domain:** the answer exposed a separate area that needs its own
  interview loop;
- **advance:** the domain is closed or deferred and the intake can move on.

This keeps "ask one question at a time" from becoming shallow. The interviewer
controls the pace; the producer protects the depth.

### Follow-Up Heuristics

The agent should ask a follow-up when an answer contains:

- a new actor, role, workflow, data object, integration, risk, or exception;
- a vague adjective such as "fast," "safe," "simple," "good," "strict," or
  "polished" without a concrete threshold;
- a decision with an unstated owner or approval rule;
- a non-goal that implies an edge case;
- an operational phrase such as "local," "staging," "release," "migration," or
  "credential" without the exact environment boundary;
- a product-quality phrase such as "feels right," "clear," or "friendly"
  without examples;
- a contradiction with discovered code/docs evidence;
- a phrase that sounds like user-held history: "usually," "never again,"
  "last time," "the weird part," or "this always breaks."

The agent should not ask a follow-up when:

- the answer is fully supported by repo/docs evidence;
- the question would only ask the user to restate implementation details the
  code can reveal;
- the domain is not needed for the current spec;
- the user explicitly defers the domain.

### Prompt And Context Framing

The prompt should give the LLM a compact, persistent frame instead of the full
interview history:

- current target and draft spec;
- active domain id, title, status, and why it matters;
- known facts with source references;
- unresolved unknowns in the active domain;
- previous questions and answers for the active domain only;
- closed domains with one-line summaries;
- new domains discovered but not yet opened;
- allowed next actions: inspect evidence, ask one question, update intake
  state, close/defer/reopen a domain, or produce the pressure-tested spec.

The model should be discouraged from producing long interview plans as user
messages. Planning belongs in intake state. The user should see the next
question, the reason it matters, and enough evidence context to answer well.

### Completion Bar

Pressure-Test Intake is complete when:

- each relevant domain is closed, deferred, or explicitly dropped;
- every closed domain has a short summary, source-backed facts, and captured
  user decisions;
- unresolved assumptions and deferrals are named in the spec;
- the Language Map has captured important project terms, aliases, and forbidden
  wording discovered during intake;
- the resulting spec includes workflows, non-goals, edge cases, risks,
  acceptance criteria, and verification expectations with enough detail for a
  worker and reviewer to act without guessing.

### Outputs

Pressure-Test Intake can produce:

- project brief updates;
- accepted decisions;
- open questions;
- task splits;
- project memory candidates;
- language-map entries;
- design-system notes;
- suggested levers;
- architecture notes or ADR candidates;
- a clearer active tranche;
- a pressure-tested spec with domain coverage, assumptions, deferrals, and
  known unknowns.

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
- is this an implementation task, release intake, feature spec, investigation,
  memory update, or parking-lot note?
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
| Serious spec or feature framing | Pressure-Test Intake before worker dispatch |

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
- Show participation summaries as "Used when..." and "Not used when..." first,
  with matched-signal details behind a task-level "Why did this run?" view.
- Let users add an extra persona from the task drawer/spec review surface, with
  the override shown as task-scoped unless promoted later.
- In spec review, show the auto-filled persona plan and let the user add or
  remove optional lenses before approving the spec.
- In setup/onboarding and spec review, offer Pressure-Test Intake as an
  optional way to teach Guildhall the project or harden a proposed spec.
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

Pressure-Test Intake should also record the domain-level interview state. The
state does not need to be beautiful, but it must be durable enough for another
agent turn to answer: which domain are we in, what do we know, what did we ask,
what follow-ups remain, and why are we allowed to move on?

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
- **Over-questioning:** Pressure-Test Intake could become exhausting.
  Mitigation: ask one question at a time, inspect first, explain why each
  question matters, and let users skip or pause.
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
- **Invisible routing:** users may not understand why a practice or persona
  intervened. Mitigation: every match records a plain-language reason and
  matched signals, and Settings shows editable "Used when..." summaries.

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

### Slice 4: Pressure-Test Intake

- Add optional pressure-test flow for serious project, feature, release, and
  task specs.
- Let **New Task** branch by intent before creating work, so release ideas such
  as `0.9.0`, feature specs, bugs, investigations, memory candidates, and
  concrete implementation tasks enter different intake lanes.
- Have the coordinator draft a domain map, inspect repo/docs/memory first, then
  interview the user one question at a time across each relevant domain.
- Support follow-up questions and per-domain closeout prompts such as "Is
  there anything else I should know about X?"
- Persist intake state with active domain, inspected evidence, known facts,
  open unknowns, asked questions, follow-up candidates, closeout state,
  discovered domains, assumptions, and decisions.
- Frame the LLM context around the active domain and allowed next actions so it
  persists in the domain until it has a reason to close, defer, or reopen it.
- Add an interviewer/producer review loop so the live interviewer gathers
  substance and a producer pass challenges missed follow-ups, vague answers,
  contradictions, and premature domain closure.
- Store answers as project brief updates, decisions, questions, memories,
  assumptions, deferrals, and Language Map candidates.
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
- Add participation rules with suggested, automatic, manual, and suppressed
  decisions, plus task-level reason records.
- Inject only active, relevant practice instructions into context packets.

### Slice 8: Persona Library

- Add project/global persona definitions with rubric validation.
- Add proposal flow for missing expert lenses.
- Add Settings -> Personas for participation rules, model lane, and rubric
  preview.
- Expose friendly rule builders for task kind, project domain, file pattern,
  keyword, and reviewer-finding triggers, with advanced raw editing later.
- Allow task-scoped user-requested persona assignments for spec, worker,
  review, gate, or all relevant phases.
- Persist a persona plan on the spec with auto-selected, user-requested, and
  suggested personas plus phase labels and reasons.
- Route reviewers through user-defined personas only when trigger rules match.

## Acceptance Criteria

- Guildhall can select `build`, `diagnose`, or `tdd` before worker dispatch.
- Worker context includes only the chosen mode's loop.
- Reviewer output checks mode-specific evidence.
- Pressure-Test Intake can build a domain map, answer discoverable questions by
  inspecting repo/docs/memory, ask the remaining questions one at a time, and
  store each answer with provenance.
- Pressure-Test Intake can ask follow-up questions and close each domain by
  asking whether there is anything else Guildhall should know about it.
- A project can maintain a small Language Map and inject relevant terms into
  worker context.
- Practice runs appear in the task trail or drawer without overwhelming the
  main flow.
- Guildhall can draft a new project-scoped practice from repeated evidence and
  keep it inactive until approved.
- Practice Designer can review a proposed practice for scope, triggers,
  evidence, duplication, prompt cost, and clear exit criteria before activation.
- Guildhall can draft a new project-scoped persona with a rubric and trigger
  rules, then expose it in Settings -> Personas.
- Persona Designer can review a proposed persona for distinctive judgment,
  evidence needs, participation rules, rubric quality, overreach, duplication,
  and cost before activation.
- Practices and personas record why they applied or did not apply, and the UI
  can show the reason without exposing raw predicates by default.
- A user can add an extra persona to a task/spec/release as a task-scoped review
  lens, and Guildhall records the request without removing automatically
  applicable reviewers.
- Spec review shows the planned persona roster before approval and lets the user
  add optional personas smoothly.
- Users can skip intake or continue with ordinary work.
- Broad learned behavior still requires approval before becoming global.

## Open Questions

- Should `architecture_improve` be a worker mode, a reviewer escalation, or a
  coordinator-only practice?
- Should TDD be a default for some domains, or always opt-in until a project
  proves it wants that style?
- How much of the Language Map should be model-generated versus deterministic
  from accepted answers and docs?
- Should Pressure-Test Intake produce ADR candidates automatically, or only
  suggest them when a decision has real architectural weight?
- Should practice names be visible to users, or should the UI translate them
  into plain status phrases such as "Debugging carefully" and "Writing the test
  first"?
- How editable should practice/persona YAML be in the UI, versus using a
  friendlier form with advanced raw editing behind it?
- Should user-defined personas be allowed to choose stronger models by default,
  or should model escalation always require a separate settings approval?
