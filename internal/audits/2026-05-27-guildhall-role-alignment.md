---
title: Guildhall role alignment audit
---

# Guildhall role alignment audit

Date: 2026-05-27

This audit distills the product role Guildhall should play for the user after
the pressure-test correction. It is intentionally broader than intake.

## Product role

Guildhall's job is not to make it possible to run an agent loop. Its job is to
make agentic project work trustworthy.

The user should be able to drop rough thoughts, worries, partial plans,
screenshots, bug reports, taste notes, and contradictions into Guildhall.
Guildhall should turn that raw material into high-quality work by doing the
pressure that a diligent senior team would normally do around the work:

- clarify vision without making the user choose a process;
- inspect the existing project, docs, memory, decisions, and live state before
  asking;
- turn intent into complete-enough specs and task boundaries;
- define acceptance criteria and verification before implementation;
- use TDD where the work can be proven with tests;
- choose reviewer lenses and deterministic gates based on risk;
- make assumptions, deferrals, blocked setup, and owner-only calls visible;
- preserve proof and memory so future agents get smarter.

The owner should supervise judgment, not babysit process. Guildhall should ask
for help only when the answer changes product intent, quality bar, risk
tolerance, release boundary, taste, or a tradeoff the project cannot decide on
its own.

## What 0.9 already covers

- Runtime isolation and release artifacts make project work less dependent on
  the host machine.
- Proof paths, completion handoffs, review plans, and calibration work make
  finished work more inspectable.
- Memory and MCP plans aim to make Guildhall able to explain what it knows and
  carry learning into future agents.
- Pressure-test intake now treats all build-changing work as pressure-tested,
  with the degree owned by Guildhall.

## Obvious misses to incorporate into 0.9

### 1. Intent fidelity is not first-class enough

Guildhall needs a durable "vision fit" check for each meaningful task or phase:
what the user appears to want, what would count as a miss, and what part of the
ask is taste/judgment rather than implementation detail. Product briefs cover
some of this, but not every task gets a clear owner-intent trace today.

0.9 target: add owner-vision fit to pressure summaries, spec review, and
completion handoff.

### 2. Completeness is split across prompts, not state

The system has strong prompts and gates, but completeness reasoning still lives
too much in agent instructions. A future agent or MCP client should be able to
read the task state and see the completeness map directly: intent, boundaries,
ACs, verification, reviewer lenses, evidence consulted, assumptions, deferrals,
and open owner-only calls.

0.9 target: promote pressure-test summary into a durable completeness packet.

### 3. Human supervision budget is not explicit

Guildhall should minimize human supervision without hiding judgment calls. Today
it asks questions and records blockers, but it does not always explain why the
owner is needed versus why Guildhall can decide automatically.

0.9 target: every owner question/blocker should state the decision type and why
Guildhall cannot safely decide it alone.

### 4. The alchemy loop is incomplete

Guildhall should visibly transform messy input into gold: raw input -> pressure
summary -> spec -> implementation -> proof -> review -> memory. The pieces
exist, but the UI and MCP do not yet expose that transformation as one coherent
story.

0.9 target: add a task/phase "why this is ready" summary that links the raw ask,
pressure summary, spec, proof, review, and memory candidates.

### 5. Memory needs quality gates, not just capture

Memory should not become a transcript dump or random lesson store. Guildhall
needs to decide what was learned, whether it is project-specific or user-level,
whether it is reliable, and when future agents should see it.

0.9 target: memory candidates should have provenance, confidence, scope,
expiry/staleness policy, and surfacing rules, with MCP visibility.

### 6. Review should look for missing pressure, not only bad output

Reviewers should inspect whether the right pressure was applied: was the spec
complete enough, were tests chosen correctly, were reviewer lenses sufficient,
did the work drift from the user's vision, and did the handoff explain proof in
a way the owner can digest?

0.9 target: add "pressure adequacy" to review planning and reviewer prompts.

### 7. Public language should explain reader value, not machinery

Public docs should make the reader feel the relevant promise for their work.
Trust is central for teams and serious codebases, but it is not the only value.
Some readers want speed and flow. Some want completeness, tests, and review.
Some want security, governance, and auditability. Runtime, MCP, memory,
pressure-test, and review docs should point back to those reader needs instead
of reading like separate internal systems.

0.9 target: add a release/docs pass after feature slices that checks whether
the public story serves casual builders, serious developers, and technical
leaders without flattening every feature into the same trust claim.

## Proposed release-priority adjustment

Keep runtime foundation first because it is the substrate for safe work. Then
raise the trust/completeness story so it lands before broader UI polish:

1. Runtime foundation and release artifact model.
2. Persistence boundary and write-path guardrail.
3. Runtime-backed command execution and evidence.
4. Pressure summaries and completeness packets.
5. Proof paths and completion handoffs.
6. Memory store, memory quality gates, and effective memory packet.
7. MCP runtime/memory/context/completeness surfaces.
8. Owner-facing UI for "why this is ready / blocked / done."
9. Task readiness, decomposition, and finishability rules.
10. Review calibration, pressure adequacy, and failure corpus.
11. Feature docs and screenshot updates shipped with each feature PR.
12. Internal benchmarks and Hermes comparison.
