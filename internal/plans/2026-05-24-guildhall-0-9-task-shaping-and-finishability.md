# Guildhall 0.9.0 Task Shaping And Finishability

**Status:** proposed 0.9.0 direction  
**Owner:** future Guildhall release planning  
**Depends on:** 0.8.0 Pressure-Test Intake and Git Story Closure  
**Related source:** `internal/specs/2026-05-22-guildhall-0-8-podman-project-runtime.md`

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
- move risky execution into an explicit runtime boundary;
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

Guildhall should not take off the user's plate:

- product taste;
- risk tolerance;
- release judgment;
- naming and positioning choices that change what the product means;
- business or ethical tradeoffs;
- granting ambient access to host paths, local daemons, browser state, or
  container sockets;
- permission to mutate Git history or publish work when policy says to ask.

The key design question for every human step is:

> What is the smallest decision Guildhall can ask for now, after doing all the
> inspection it can safely do itself?

## Proposed 0.9.0 Capabilities

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
- Human-facing intake cards ask one decision at a time and show only the
  evidence needed to answer that decision.
- Research, decision, and implementation tasks have distinct completion
  contracts.
- The Podman runtime spike can run one registered project inside a disposable
  container while preserving durable host Guildhall state and explicit
  capability approval for extra host access.
- Coordinator reflection can suggest, but not auto-approve, a new project or
  global preference/practice based on repeated task-shaping evidence.
- Public docs describe the science-backed influence lightly and accurately.
