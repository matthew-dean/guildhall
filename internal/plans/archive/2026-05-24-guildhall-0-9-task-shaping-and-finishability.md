# Guildhall 0.9.0 Task Shaping And Finishability

**Status:** proposed 0.9.0 direction
**Owner:** future Guildhall release planning
**Depends on:** shipped 0.8.0 Pressure-Test Intake, Git Story Closure, and Task State Boundary baseline (`v0.8.0`, `docs/releases/0.8.0.md`)
**Related sources:**

- `internal/plans/archive/2026-05-27-project-orientation-and-proof-paths.md`
- `internal/design-notes/archive/project-construction-manifesto.md`
- `internal/specs/2026-05-22-guildhall-0-8-podman-project-runtime.md`
- `internal/design-notes/ux-review-calibration-and-work-review-integration.md`
- `internal/research/2026-05-25-ux-review-calibration-source-notes.md`
- `internal/plans/2026-05-25-review-calibration-and-failure-corpus.md`
- `internal/design-notes/archive/persistence-system-boundary.md`

## Thesis

0.8.0 asks whether Guildhall can turn messy requests into buildable work and
close the Git story honestly.

0.9.0 should ask whether Guildhall can shape work well enough that agents and
people can finish it without heroics, while taking the maximum reasonable load
off the user's plate without making the judgment calls the user still needs to
make.

The product posture is not agile ceremony. Guildhall should borrow the useful
parts of task decomposition, cognitive-load research, goal-setting theory,
implementation intentions, Kanban flow, and LLM planning research, then turn
them into small product behaviors:

- ask one question at a time;
- make the current decision obvious;
- split broad work before it becomes an overloaded worker prompt;
- separate learning tasks from implementation tasks;
- keep active work-in-progress low;
- make completion evidence explicit;
- make completed work orient the owner to current project state: what changed,
  what can be done now, and where to click or run to prove it;
- turn proof guidance into launchable, copyable, or manually actionable steps
  when Guildhall can safely own the action;
- make review evidence explicit, including calibrated UX review when a task
  changes user-facing comprehension, recovery, trust, or task flow;
- require plan-completeness review so important governance, privacy, rollout,
  cost, drift, and override concerns surface without the user having to ask
  "anything else?";
- centralize persistence so task state, evidence, logs, memory, artifacts,
  review audit, archives, and compaction all use one storage boundary;
- move risky execution into an explicit runtime boundary;
- suggest better-fit tools, libraries, shared abstractions, and visibility
  helpers instead of generating everything bespoke;
- escalate product, taste, risk, and release judgment instead of silently
  deciding those for the user.

## Research Sources To Apply

### Work Breakdown Structure

Use WBS thinking for outcome-oriented decomposition, not task-tree theater.
Guildhall should distinguish initiative, deliverable, task, and worker-local
step. The coordinator owns the shape of the work; the worker owns the local
plan for the accepted task.

Reference: PMI Practice Standard for Work Breakdown Structures, Third Edition.
Source: <https://www.pmi.org/standards/work-breakdown-structures-third-edition>

### INVEST

Use INVEST as a readiness rubric, adapted away from strict user-story language:

- **Independent-ish:** the task can move without hidden prerequisite work;
- **Negotiable:** the implementation can adapt as evidence appears;
- **Valuable:** completion creates a useful artifact, decision, or product
  state;
- **Estimable:** the work is bounded enough to reason about;
- **Small:** one worker can complete it in a focused pass;
- **Testable:** completion can be proved.

Source: <https://agilealliance.org/glossary/invest/>

### Scrum Refinement And Definition Of Done

Use refinement and Definition of Done without importing Scrum ceremony. A task
is not ready just because it has a title. It is ready when Guildhall knows what
would count as done, what proof is expected, and what still requires a human
decision.

Source: <https://scrumguides.org/scrum-guide.html>

### Kanban Flow And WIP Limits

Use WIP limits to reduce stalled half-work. Guildhall should prefer finishing,
blocking, shelving, or explicitly deferring active work before opening another
lane.

Source: <https://kanban.university/kanban-guide/>

### Cognitive Load Theory

Use cognitive-load theory as a product-design constraint. The user should not
have to read a wall of context to answer a product question. The worker should
not receive a giant prompt when a scoped brief plus retrieval pointers would
do.

Product implications:

- one question per card;
- one decision per visible step;
- segmented briefs: goal, context, boundaries, proof, open judgment;
- progressive disclosure for evidence and rationale;
- no bundled approval cards that hide several decisions.

Source: <https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning-segmenting-pretraining-and-modality-principles/DD24C2F48B9B1277CE59F78276110258>

### Goal-Setting Theory

Use specific goals when the work is clear. Use learning goals when the work is
complex or uncertain. A vague implementation task with hidden research is a
bad task; split it into a research/decision task first.

Source: <https://med.stanford.edu/content/dam/sm/s-spire/documents/PD.locke-and-latham-retrospective_Paper.pdf>

### Implementation Intentions

Turn common blockers into if-then plans attached to the task:

- If the relevant API contract is unclear, inspect the live endpoint before
  editing.
- If verification fails because fixtures are stale, inspect fixture ownership
  before changing product code.
- If the worker must choose between product behaviors, stop and ask.

Source: <https://www.sciencedirect.com/science/chapter/bookseries/abs/pii/S0065260106380021>

### LLM Planning Research

Apply least-to-most, plan-and-solve, and ReAct-style loops as runtime
structure, not hidden prompt magic:

- decompose first, solve second;
- inspect evidence before asking the user;
- interleave action and observation;
- revise the plan when observations disprove assumptions.

Sources:

- <https://arxiv.org/abs/2205.10625>
- <https://arxiv.org/abs/2305.04091>
- <https://arxiv.org/abs/2210.03629>

### UX Review Calibration

Use UX review calibration as the review-side counterpart to task shaping.
Guildhall should not merely ask "did a reviewer approve?" It should know
whether that reviewer recipe has caught similar failures in a source-backed
corpus.

The initial source-backed categories come from usability heuristics, checkout
and form friction research, deceptive-design taxonomies, and regulatory dark
pattern guidance. The detailed source notes live at
`internal/research/2026-05-25-ux-review-calibration-source-notes.md`.

Product implications:

- risky user-facing tasks get a `reviewRisk` profile during shaping;
- substantial feature plans get a `plan_completeness` lane that looks for
  missing governance, privacy, cost, drift, rollout, mandatory-lane, and
  override concerns;
- specs name the UX review recipes and artifacts required for review;
- workers cannot hand off review without the requested screenshots, routes,
  DOM snapshots, copy snippets, or click-through paths;
- reviewer fanout can include calibrated recipe-backed reviewers;
- `gate_check` enforces deterministic artifact and static UX contracts;
- escaped UX review misses become new calibration cases;
- Coordinator tuning changes context, model, settings, or prompt one variable
  at a time.

Sources:

- <https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1_Letter-compressed.pdf>
- <https://baymard.com/learn/audit-checkout-flow-hidden-friction>
- <https://www.deceptive.design/types>
- <https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers>

## Product Contract

Guildhall should take off the user's plate:

- remembering the project structure;
- finding likely files, commands, and prior decisions;
- keeping normal agent execution inside a predictable, disposable workspace;
- noticing when a task is too broad;
- splitting work into finishable chunks;
- drafting acceptance criteria and proof paths;
- routing implementation, research, repair, release, and settings asks into
  different lanes;
- preserving evidence and follow-up state.
- orienting the user after work completes: what changed, what is possible now,
  how to prove it, and what remains unverified.
- noticing when a better-fit tool, library, project abstraction, preview
  surface, seed script, or smoke test would make the work more repeatable.

Guildhall should not take off the user's plate:

- product taste;
- risk tolerance;
- release judgment;
- naming and positioning choices that change what the product means;
- business or ethical tradeoffs;
- granting ambient access to host paths, local daemons, browser state, or
  container sockets;
- installing, adopting, or running new tooling paths that change the project
  contract without confirmation;
- permission to mutate Git history or publish work when policy says to ask.

The key design question for every human step is:

> What is the smallest decision Guildhall can ask for now, after doing all the
> inspection it can safely do itself?

## Proposed 0.9.0 Capabilities

### Project Orientation And Proof Paths

Make project orientation and proof paths a central 0.9.0 finishability lane.
The detailed source plan is
`internal/plans/archive/2026-05-27-project-orientation-and-proof-paths.md`.

The product question this lane answers is:

> What changed, what can I do now, and where do I click or run to prove it?

Key product changes:

- store current project orientation in checked-in `.guildhall/` project state,
  with append-only evidence in local history;
- add agent-authored, schema-validated proof paths and completion handoffs;
- require agents to propose and refine proof paths as part of doing the work;
- distinguish automated verification, manual proof, local proof, staging proof,
  production proof, test-provider proof, and live-provider proof;
- add confidence labels such as agent-proposed, discovered from config,
  confirmed by successful run, owner-confirmed, stale, and unverified;
- expose launch steps as copy/open/manual actions first, and only later as
  managed long-running command buttons;
- require readiness, status, stop/restart, port-conflict, log-inspection,
  redaction, and reload-recovery behavior before Guildhall runs long-lived
  local commands;
- fold rare owner-attention items into the first list on Project Overview
  instead of keeping a standalone Inbox by default;
- keep Thread as the active command/conversation surface and Work as the task
  operations surface;
- rename task-level Overview to Summary so project Overview remains the only
  Overview;
- reduce task-drawer detail tabs to Summary, Spec, Journey, Review, and
  Evidence, with Journey absorbing proof paths and completion handoffs.

Preferred project IA direction:

```text
Project
  Overview
  Memory

Thread
Work
Release
Activity

Settings
```

This lane should start data-model-first with a small visible Journey slice:

1. add structured `ProofPath` and `CompletionHandoff` state;
2. teach the spec, worker, reviewer, and coordinator agents to produce and
   validate it;
3. render proof paths and completion handoffs in task Journey;
4. use the resulting data to reshape Project Overview around current-state
   orientation.

### Task Readiness Score

Add a coordinator-owned readiness assessment with dimensions:

- outcome clarity;
- size;
- proofability;
- context load;
- dependency risk;
- uncertainty;
- user-judgment exposure.

The score should explain itself in plain language and recommend one of:

- ready for implementation;
- needs one user question;
- needs research/spike first;
- split into smaller tasks;
- shelve or defer.

### Diagnostic Export

Shelve this as a future internal support tool, not a 0.8.0 runtime requirement.
Guildhall should eventually offer a redacted diagnostic export that gathers the
small set of files needed to debug a project report: service status, provider
resolution, recent event logs, active task state, relevant checkpoints,
pressure-test state, and selected local-history evidence. The export should
preserve the same compact-summary-to-evidence chain described in the memory
layout contract, while redacting API keys, provider tokens, secrets, and
machine-local paths that are not needed for support.

This is worth keeping because it would turn “something got stuck” reports into
inspectable evidence bundles. It should stay behind the higher-value
finishability work until the runtime and evidence contracts settle.

### Decomposition Reasons

When Guildhall splits a task, persist why:

- too broad;
- unclear outcome;
- missing proof path;
- too much context;
- hidden dependency;
- product judgment required;
- implementation and research are mixed.

### Task Kinds

Make task kind explicit:

- implementation;
- research;
- decision;
- spike;
- cleanup;
- verification;
- release;
- learning.

Task kind should change the readiness bar. A research task needs a learning
goal and output format. An implementation task needs a proof path. A decision
task needs options, tradeoffs, and a named owner.

### Definition Of Done

Promote Definition of Done to first-class task state. It should be visible in
Thread, task review, and release readiness.

### If-Then Plans

Attach blocker handling to tasks. The worker should know when to inspect,
continue, narrow scope, or ask.

### Context Budget

Estimate whether a task's useful context fits in one worker brief. If not,
Guildhall should split the task or create a precursor research task.

### Coordinator Reflection

Add an occasional coordinator review that asks:

- Are tasks repeatedly too big?
- Are workers stalling at the same boundary?
- Are we asking users questions Guildhall could have answered by inspecting?
- Are we making product judgments that should be explicit user decisions?
- Are too many tasks active at once?

This review should produce suggested practice or preference candidates, not
silently rewrite project behavior.

### Review Calibration And Failure Corpus

Add a Coordinator-owned review calibration loop. UX is the first lane, but the
same machinery should eventually apply to security, accessibility, performance,
API design, docs, migrations, and reliability.

The core objects are:

- failure corpus cases with hidden expected findings;
- reviewer recipes with model/settings/prompt/context versions;
- calibration results that record matched findings, missed findings, false
  positives, and useful-fix quality;
- task `reviewRisk` profiles that require calibrated recipes and artifacts;
- escaped-miss records that turn human-found review failures into future
  calibration cases.

The implementation plan is
`internal/plans/2026-05-25-review-calibration-and-failure-corpus.md`.

### Persistence Boundary

Retool Guildhall persistence so generated state and evidence do not keep
spreading through copy-pasted file writes. Review audit should be the first major
consumer, but the 0.9.0+ shape is broader: task state, task evidence, memory,
decisions, logs, transcripts, checkpoints, artifacts, levers, config, corpus
maps, design-system state, and archives should all route through one central
persistence boundary.

The source design is
`internal/design-notes/archive/persistence-system-boundary.md`.

Product implications:

- new durable features do not write directly to managed Guildhall paths;
- domain stores stay ergonomic, but delegate placement, provenance, evidence
  refs, compaction, and backend writes to the persistence layer;
- compact project summaries remain shareable under `./.guildhall/`;
- bulky/private evidence remains local by default;
- UI, CLI, MCP, and agents read the same compact/full evidence model;
- missing local evidence is shown honestly instead of silently breaking an
  audit trail.

The migration order should be:

1. persistence core and static guardrail;
2. review audit as first consumer;
3. task state and task evidence;
4. memory, decisions, transcripts, and checkpoints;
5. artifacts, corpus map, design system, skills, levers, and config;
6. reader convergence across UI, CLI, MCP, and agent context;
7. backend freedom for SQLite, object storage, encryption, or export bundles.

### Podman Project Runtime

Move the deferred Podman/containerized project runtime into the 0.9.0 planning
track. This is the runtime counterpart to task finishability: a task is easier
to finish safely when the agent has a boring Linux workspace, durable mounted
Guildhall state, explicit project mounts, and visible capability requests
instead of ambient host access.

The source spec remains
`internal/specs/2026-05-22-guildhall-0-8-podman-project-runtime.md`, but its
release target is 0.9.0 or later. The 0.9 shape should keep these invariants:

- the container is disposable, but Guildhall memory is not;
- host `~/.guildhall` stays durable and mounted into the runtime;
- project source stays host-owned and live-mounted;
- normal project commands run inside the container by default;
- extra host access, additional mounts, exposed ports, browser access, local
  daemon access, and container-engine access are explicit capability requests;
- the host UI remains the trust, approval, and evidence surface.

This should start as a manual spike before becoming the default runtime:

1. boot a Debian-based Podman container for one test project;
2. mount the project and host `~/.guildhall`;
3. run normal install, test, typecheck, browser, and port-exposure flows;
4. prove host/container file ownership stays sane on macOS;
5. record logs and command evidence with container id, project id, cwd, and env
   provenance;
6. make denied or expired capabilities visible as task blockers.

### Internal Benchmarks And Hermes Comparison

Add benchmarks as a late 0.9.0 implementation lane after the runtime,
persistence, proof-path, memory, MCP, task-shaping, and review-calibration
work. The detailed source plan is
`internal/plans/2026-05-27-guildhall-0-9-benchmarks-and-hermes-comparison.md`.

This lane should measure Guildhall's actual finishability promise before it
tries to publish any external score:

- a Guildhall-native lifecycle eval for intake, readiness, decomposition,
  worker scope, review, gate checks, proof paths, completion handoffs, memory
  reuse, and MCP auditability;
- a Terminal-Bench/TBLite-style adapter as the first high-value external
  comparison, because it maps to terminal-backed project work and Hermes
  documents the same benchmark family;
- a SWE-bench-style coding lane for worker patch quality, starting with local
  fixtures before public SWE-bench Lite or Verified infrastructure;
- a Hermes comparison runbook that fixes model/provider settings, benchmark
  version, task subset hash, timeout, retry policy, cost, latency, and evidence
  paths before comparing results;
- a question-resolution path for benchmark and CLI runs where multiple-choice
  owner questions can carry one recommended answer, run-scoped automation
  policy can auto-resolve eligible questions, and every Guildhall-made answer
  is recorded separately from human input;
- tau-bench-style policy/tool scenarios and OSWorld/WebArena-style browser or
  desktop tasks as later follow-ons unless another 0.9 task explicitly depends
  on them.

The scorecard should include false-success rate, owner interventions,
auto-resolutions, unnecessary questions, split quality, proof completeness,
handoff quality, memory precision, auditability, cost, latency, and
deterministic pass/fail. It should not produce public "Guildhall beats Hermes"
claims.

## Public Docs Posture

Public docs may lightly say Guildhall uses evidence-backed ideas from
cognitive-load research, goal-setting research, flow systems, and LLM planning.
They should not sound like a methodology sales pitch.

Good public framing:

> Guildhall uses those ideas quietly: one question at a time, visible proof of
> done, small work packets, and fewer half-finished lanes.

Bad public framing:

> Guildhall implements a full scientific agile project management framework.

## Acceptance Criteria For 0.9.0

- A broad request can produce a visible task-shaping assessment before work is
  dispatched.
- A too-large task is split with a durable reason and a clear parent/child
  relationship.
- A task cannot be marked ready for implementation without outcome, boundary,
  and proof fields.
- A completed task produces an owner-facing handoff that says what changed,
  what can be done now, how to prove it, what Guildhall verified, and what
  remains unverified.
- Project Overview can orient a cold user to current project state without
  requiring transcript archaeology.
- Proof paths can render copy/open/manual launch steps with confidence and
  scope labels before any long-running process runner ships.
- Human-facing intake cards ask one decision at a time and show only the
  evidence needed to answer that decision.
- Research, decision, and implementation tasks have distinct completion
  contracts.
- The Podman runtime spike can run one registered project inside a disposable
  container while preserving durable host Guildhall state and explicit
  capability approval for extra host access.
- Coordinator reflection can suggest, but not auto-approve, a new project or
  global preference/practice based on repeated task-shaping evidence.
- Risky user-facing work can require calibrated UX review recipes, reviewer
  artifacts, and gate-checked review evidence before completion.
- Public docs describe the science-backed influence lightly and accurately.
