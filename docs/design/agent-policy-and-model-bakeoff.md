---
title: Agent policy and model bakeoff
---

# Agent policy and model bakeoff

Guildhall has spent the `0.5.0` cycle proving that real projects can move from
draft/spec through worker execution, review, gates, and done. The proof is
valuable, but the path exposed a pattern: too many live failures required tiny
runtime patches after the fact.

This note splits the work into two tracks:

1. `0.5.x`: decision-point unblockers required for the current product to feel
   usable.
2. `0.6.0`: a generalized policy and model-evaluation layer that reduces the
   need for bespoke fixes.

## Current Problem

The current runtime is strong at deterministic validation once the expected
path is known. It is weaker when an agent reaches a decision point that is
obvious to a human but underspecified to the runtime.

Recent examples include:

- worker-authored type/import failures being escalated as human ambiguity
- stale `oldString` edits requiring a focused reread
- clean `exit 0` verification being treated as warning work
- reviewer fan-out producing infrastructure-noise dissent
- dirty checkout blockers surfacing as raw setup strings
- imported drafts needing human shaping before they become runnable work

Most of these are not fundamentally separate product concepts. They are
instances of a smaller set of decision-point classes.

## 0.5.x Track: Decision-Point Unblockers

This is table-stakes product behavior, not future architecture.

Guildhall should not dead-end when it already has enough evidence to make a
bounded recovery move. The near-term release line should keep adding targeted
fixes only when they satisfy one of these categories.

### 1. Honest Human Stops

A stop is acceptable only when the next human action is visible and concrete.

Required behavior:

- Thread names the actual blocker.
- The card says what the user can do next.
- The run status does not imply hidden activity.
- Draft/import queues stop as `awaiting_human`, not as fake paused work.

### 2. Self-Authored Repair

If verification fails in files the worker touched, Guildhall should keep the
worker in repair mode instead of asking the user to adjudicate.

Examples:

- missing local import
- duplicate helper
- type error in authored expression
- stale edit target after a failed `oldString`

### 3. Verification-Backed Continuation

When a task has durable verification evidence, recovery prompts should preserve
that evidence as the primary frame.

Required state:

- last authoritative command
- pass/fail result
- failing output excerpt
- touched files
- current working hypothesis
- safe next mutation surface

### 4. Review/Gate Audit Closure

If review advances a task despite advisory or procedural dissent, the audit
trail must record the advancing decision. A `done` task cannot leave the latest
review story looking like an unresolved `revise`.

### 5. Dirty Checkout Recovery

Dirty checkout states must be productized:

- if Guildhall created the dirty state, package it into a task branch when safe
- if the dirty state is outside Guildhall ownership, ask for commit/stash with
  a clear repo name
- never surface only a raw git/worktree setup string

## 0.6.0 Track: Policy Runtime

The larger fix is to make these classes first-class runtime policy instead of
hardcoding every new symptom.

### Failure Classifier

Introduce a structured classifier over agent failures and blocked states:

- `self_authored_verification_failure`
- `stale_context`
- `missing_target_evidence`
- `environment_unavailable`
- `provider_unavailable`
- `human_product_decision`
- `reviewer_infrastructure_noise`
- `dirty_checkout_owned`
- `dirty_checkout_external`

The classifier can start deterministic and later use a cheap model for schema
repair or ambiguous classification.

### Recovery Playbooks

Each class maps to a bounded recovery playbook:

- reread one focused file
- rerun one authoritative command
- revert own unrelated drift
- rebootstrap
- restart from checkpoint
- route to review/gate
- ask the user a concrete question
- stop with explicit human action

The playbook should emit structured state that the UI and next agent turn can
reuse.

### Typed Agent Outputs

Agents should return typed packets for decision points instead of prose-only
justification.

Useful packet fields:

- `classification`
- `evidence`
- `lastCommand`
- `lastCommandPassed`
- `touchedFiles`
- `hypothesis`
- `nextAction`
- `needsHuman`
- `humanQuestion`

This mirrors the useful parts of systems like Hermes: isolated worker context,
typed result objects, orchestrator validation, and resource-aware scheduling.

## Model Bakeoff

Model choice should be measured against Guildhall-shaped work, not vibes.

DeepInfra cost matters here. A model like `Qwen/Qwen3.6-35B-A3B` can be
reasonable per input token but expensive across output-heavy recovery loops.
Guildhall should learn which model belongs in each lane.

### Candidate Lanes

- **Spec/intake:** cheap long-context model with good summarization
- **Schema repair/classification:** very cheap small model
- **Worker:** strongest tool-use/code model that passes replay tasks
- **Reviewer:** cheap model plus deterministic fallback
- **Coordinator:** stronger model only for real adjudication
- **Gate checker:** deterministic first, model only for malformed summaries

### Replay Set

Start with the historical failures from the `0.5.0` flow audit:

- imported draft shaping into a runnable task
- dirty checkout before worktree creation
- failed typecheck in touched files
- stale `oldString`
- warning-only `exit 0`
- reviewer fan-out infrastructure noise
- no-tool worker turn after checkpoint
- draft queue awaiting human shaping

Each model run should record:

- task outcome
- tool count
- false human escalations
- false approvals
- wall time
- input/output tokens
- estimated cost
- final audit packet quality

## Decision

Do not hold `0.5.0` for the full policy runtime. Do hold it for decision
points that still dead-end the current product.

The split is:

- `0.5.x`: fix known decision-point dead ends as product bugs.
- `0.6.0`: build classifier, playbooks, typed packets, and model bakeoff so
  future failures become evidence for policy improvement instead of another
  bespoke guard.
