# Guildhall 0.9.0 Benchmarks And Hermes Comparison

**Status:** proposed late 0.9.0 implementation lane
**Owner:** future Guildhall release planning
**Priority:** after the 0.9 runtime, persistence, proof-path, memory, MCP, task-shaping, and review-calibration work
**Depends on:** 0.9 runtime command evidence, proof paths, completion handoffs, memory packets, MCP context surfaces, and review calibration

## Thesis

0.9.0 should add a benchmark lane that measures the thing Guildhall actually
claims to improve: not only whether an agent can patch code, but whether the
workflow turns a request into bounded, inspectable, provable, finishable work.

The benchmark work should come after the higher-priority 0.9 implementation
lanes because the eval harness needs their artifacts:

- runtime-backed command execution;
- durable evidence records;
- proof paths and completion handoffs;
- accepted memory in future context;
- MCP-readable runtime, memory, and context state;
- task readiness, decomposition, and review-risk records.

The first goal is not a public leaderboard. It is a repeatable internal harness
that lets Guildhall answer:

> Is Guildhall getting better at finishing real work with less owner babysitting
> and fewer false-success claims?

## Benchmark Set

### P0: Guildhall Lifecycle Eval

This is the most important benchmark because it matches the product promise.
It should use frozen project fixtures and saved realistic asks, then score the
full Guildhall workflow.

What it tests:

- request shaping and one-question-at-a-time intake;
- task readiness and decomposition;
- proof-path proposal quality;
- worker scope discipline;
- reviewer rejection quality;
- gate-check evidence discipline;
- completion handoff truthfulness;
- memory candidate quality and accepted-memory reuse;
- MCP auditability without raw shell reads.

Core metrics:

- `task_success`: completed task passes deterministic checks;
- `false_success`: Guildhall claims done while required proof is missing or red;
- `owner_interventions`: number and type of owner decisions requested;
- `auto_resolutions`: questions, approvals, and escalations Guildhall answered because automation policy allowed it;
- `unnecessary_questions`: questions Guildhall could have answered from repo or runtime evidence;
- `split_quality`: broad work split into coherent child tasks with reasons;
- `proof_completeness`: proof path names automated, manual, local, live, and unverified evidence honestly;
- `handoff_quality`: owner can tell what changed, what to do now, and what remains uncertain;
- `memory_precision`: accepted memory affects later work; proposed memory stays inert;
- `auditability`: UI/API/MCP can explain state without transcript archaeology.

Initial fixture families:

- small bug fix with clear tests;
- ambiguous product/spec ask that should not jump straight to implementation;
- too-large feature request requiring parent/child split;
- user-facing UI change requiring screenshot or DOM evidence;
- blocked external-provider setup that should become owner-actionable steps;
- regression where repo-wide tests are red but task-scoped proof is green;
- repeated-task scenario that should produce and reuse accepted memory.

### P1: Terminal-Bench / TBLite Adapter

Terminal-Bench-style tasks are the highest-value external comparison because
Guildhall is a local software-work harness with terminal-heavy execution.
Hermes officially documents TerminalBench2 and TBLite benchmark environments,
so this is also the cleanest Hermes comparison lane.

What it tests:

- one-task completion inside a sandbox;
- command execution reliability;
- install/test/debug loops;
- timeout and cancellation behavior;
- evidence capture;
- false-finish resistance.

Plan:

1. Build a Guildhall benchmark adapter that can receive a task instruction,
   workspace path, timeout, model/provider config, and verification command.
2. Run a small TBLite smoke subset first.
3. Add full TBLite only after runtime cost, timeout, and result persistence are
   predictable.
4. Add TerminalBench2 as a larger, slower comparison track if the adapter works.
5. Record results as JSONL plus a Markdown report with trajectories, costs,
   verification outcomes, and failure taxonomy.

Comparison rules:

- compare Guildhall and Hermes with the same model/provider where possible;
- use the same task subset, timeout, retry policy, and verification rules;
- report pass rate and operational evidence, not just headline score;
- mark any unsupported benchmark task as unsupported rather than failed when
  the harness cannot legally or technically run it.

### P1: SWE-Bench-Style Coding Eval

SWE-bench-style tasks test repository patching against real issue descriptions
and deterministic tests. This is important for the worker lane, but it is not
enough to evaluate Guildhall as a workflow.

What it tests:

- repo orientation;
- patch generation;
- focused verification;
- test repair;
- scope control.

Plan:

1. Start with a small SWE-bench-style local fixture set rather than full public
   SWE-bench infrastructure.
2. Add an adapter for SWE-bench Lite or Verified only after runtime isolation
   and dependency setup are stable.
3. Score both patch correctness and Guildhall-specific workflow quality.
4. Track when Guildhall asks a useful clarifying question versus when it should
   proceed directly.

Metrics:

- resolved/pass rate;
- files changed;
- commands run;
- failed-command recovery;
- over-editing;
- proof path accuracy;
- reviewer/gate catch rate;
- cost and latency.

### P2: Hermes Official Benchmark Comparison

Hermes currently documents a benchmark/environment framework with TerminalBench2,
TBLite, YC-Bench, and a SWE-bench-style training environment. Guildhall should
compare against Hermes where the benchmark measures a shared capability, while
being explicit about what does not map.

Comparison tracks:

- **TBLite:** primary fast external comparison.
- **TerminalBench2:** larger external terminal-work comparison.
- **SWE-bench-style:** compare worker coding ability if both harnesses can run
  the same task family.
- **YC-Bench:** useful as a contrast for long-horizon strategy, but not a
  direct Guildhall release gate unless Guildhall adds a strategy simulation
  surface.

Hermes comparison report should include:

- benchmark name and version;
- task subset hash;
- model/provider and inference settings;
- tool access and terminal backend;
- timeout/retry policy;
- pass/fail outcome;
- cost, latency, turns, and command count;
- failure class;
- evidence path;
- known unfairness or mismatch.

Do not publish "Guildhall beats Hermes" style claims from this lane. The
useful result is a disciplined contrast:

- where Guildhall's structure helps;
- where Hermes' simpler or broader agent runtime does better;
- where the benchmark mostly measures the model, not the harness;
- where the task shape does not match Guildhall's product promise.

### P2: Tool/User Policy Eval

Use tau-bench-style ideas after the core benchmark harness exists. This is
relevant to intake, policy-following, and capability requests, but it is less
urgent than terminal/coding benchmarks.

Candidate Guildhall-shaped scenarios:

- provider setup policy where some steps require owner approval;
- capability request approval/denial and fallback;
- release-policy decision with commit/push/PR constraints;
- memory proposal acceptance where proposed memory must stay inert.

### P3: Browser/Desktop Agent Evals

OSWorld, WebArena, and similar browser/desktop benchmarks are useful later if
Guildhall grows a stronger GUI/browser-control execution lane. For 0.9.0, use
browser proof as part of Guildhall-native lifecycle eval rather than trying to
run a full desktop-agent leaderboard.

## Question Resolution And Automation Policy

Benchmark runs need a non-interactive way through human questions, spec
approvals, and recoverable escalations. That should not be a benchmark-only
hack. It should be the same product primitive Guildhall uses for trust posture:
how much judgment Guildhall is allowed to exercise before asking the owner.

### Recommended Options

Any multiple-choice owner question should be able to carry one recommended
answer. This is useful for normal UX and essential for benchmark automation.

Recommended-answer metadata should include:

- recommended choice id;
- confidence: low, medium, high;
- reason in owner-facing language;
- evidence refs used to make the recommendation;
- risk if wrong;
- whether the answer changes product behavior, security posture, billing,
  release state, data/privacy policy, or external provider setup.

The UI should show the recommendation without pretending the user already
approved it. The benchmark harness can use the same field when automation
policy allows auto-resolution.

### Automation Policy Levels

Model this as a project setting rather than a binary benchmark flag. Suggested
owner-facing levels:

- **Ask more often:** Guildhall asks before most judgment calls and only
  auto-resolves low-risk, high-confidence operational questions.
- **Ask when necessary:** default. Guildhall auto-resolves low-risk,
  high-confidence questions and asks for product, release, security, billing,
  data/privacy, irreversible, or low-confidence decisions.
- **Fully automated mode:** Guildhall may choose recommended answers and
  continue without waiting, but still records every auto-resolution and should
  stop for decisions the project policy marks non-delegable.

CLI and benchmark runs should be able to override the project default for that
run, for example:

```bash
guildhall run --automation ask-when-necessary
guildhall benchmarks run lifecycle --fixture-set smoke --automation fully-automated
```

The exact command names can change during implementation, but the contract
should not: run-scoped automation policy must be explicit, recorded, and visible
in the benchmark report.

### Auto-Resolution Records

Whenever Guildhall answers on behalf of the owner, persist a record:

- question or escalation id;
- task id and run id;
- automation policy level;
- selected answer or resolution text;
- recommendation confidence;
- evidence refs;
- agent/model that made the choice;
- why policy allowed auto-resolution;
- whether a human later overrode it;
- whether the task ultimately passed or failed.

Benchmark reports should separate:

- human answers;
- auto-resolved answers that matched the recommendation;
- auto-resolved answers without a recommendation;
- questions blocked because policy did not allow automation;
- cases where a bad auto-resolution caused failure or rework.

### Non-Delegable Decisions

Even in fully automated mode, project policy should be able to mark some
decisions as non-delegable. Defaults should likely include:

- granting new host access or broad capability requests;
- publishing, pushing, merging, or force-updating shared Git history;
- changing billing, legal, privacy, security, or production data behavior;
- adopting new external services or paid provider paths;
- irreversible destructive actions.

For benchmarks, these should be reported as `blocked_by_policy` unless the
fixture explicitly supplies an allowed synthetic answer.

## Implementation Slices

### Slice 1: Benchmark Result Schema

Create a shared result schema for Guildhall-native and external comparisons.

Fields:

- run id, benchmark id, benchmark version, task id, task subset hash;
- Guildhall version, runtime image, model/provider, settings, tool policy;
- task instruction, fixture ref, project ref, verification command refs;
- start/end timestamps, duration, token use, cost, turns, command count;
- automation policy, auto-resolution count, blocked-by-policy count;
- result: pass, fail, unsupported, inconclusive, aborted;
- failure class and failure summary;
- proof path and evidence refs;
- UI/API/MCP audit refs;
- redaction and publishability flags.

### Slice 2: Question Recommendation And Auto-Resolution

Add the owner-question primitives needed for both normal UX and benchmark runs.

Required behavior:

- multiple-choice questions can name one recommended option;
- recommendations carry confidence, reason, risk, and evidence refs;
- run-scoped automation policy can auto-answer eligible questions;
- auto-resolution records are persisted through the same evidence boundary as
  benchmark results;
- automation policy is visible in reports and does not silently change the
  project default;
- non-delegable policy decisions remain blocked unless the fixture explicitly
  provides a synthetic answer.

### Slice 3: Guildhall Lifecycle Fixture Harness

Add local fixtures that run through Guildhall's own task lifecycle and produce
machine-readable scorecards.

Required outputs:

- JSONL run records;
- Markdown run report;
- evidence index;
- failure taxonomy summary;
- top regressions;
- recommended follow-up tasks.

### Slice 4: Terminal-Bench/TBLite Adapter Spike

Build the smallest possible adapter that can run a tiny TBLite-style task
through Guildhall's runtime and verifier.

The spike passes when:

- the task runs in the managed runtime;
- verification result is captured;
- logs and command evidence are persisted;
- the report distinguishes harness failure from task failure;
- the result can be compared with a Hermes run using the same task id/subset.

### Slice 5: Hermes Comparison Runbook

Write a runbook that explains how to run Hermes and Guildhall against the same
benchmark subset.

The runbook must specify:

- exact Hermes version or commit;
- exact Guildhall version or commit;
- benchmark dataset/version;
- task subset hash;
- model/provider settings;
- env vars and secrets required, with redaction rules;
- timeout/retry/budget settings;
- where outputs land;
- how to interpret unsupported or inconclusive tasks.

### Slice 6: Reporting UI Or CLI

Start with CLI reports. A visible UI can come later if the benchmark report is
useful enough.

Potential command shape:

```bash
guildhall benchmarks run lifecycle --fixture-set smoke
guildhall benchmarks run tblite --subset smoke --model <provider/model>
guildhall benchmarks compare hermes --guildhall-run <path> --hermes-run <path>
```

## Acceptance Criteria

- Guildhall has a local lifecycle benchmark that exercises shaping, work,
  review, gate, proof, handoff, and memory reuse.
- Multiple-choice owner questions can carry recommended answers with confidence,
  reason, risk, and evidence refs.
- Benchmark runs can use an explicit run-scoped automation policy to resolve
  eligible questions and escalations without waiting for a human.
- Auto-resolved questions are persisted and reported separately from human
  answers, including bad or policy-blocked decisions.
- Benchmark reports record false-success and auditability failures, not just
  pass/fail.
- A TBLite-style smoke subset can run through Guildhall's runtime-backed
  command path.
- A Hermes comparison runbook exists and can compare at least one shared
  benchmark subset without overclaiming.
- Reports include model/provider, runtime image, task subset hash, timeout,
  retry policy, cost, latency, and evidence refs.
- Benchmark outputs are internal by default and redacted before any public use.

## Non-Goals For 0.9.0

- A public Guildhall leaderboard.
- Claims that one harness is universally better than another.
- Full OSWorld/WebArena support.
- Training or RL loops.
- Treating SWE-bench or Terminal-Bench as the whole Guildhall quality story.
