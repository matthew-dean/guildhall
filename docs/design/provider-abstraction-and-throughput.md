---
title: Provider abstraction and throughput
---

# Provider abstraction and throughput

This note captures the next architecture step after the one-task finisher
pivot: how Guildhall should grow from "finish one task reliably" into
"process a real queue without turning into a swarm-shaped mystery."

It also reframes provider support around durable protocol and auth boundaries
instead of product-specific names like "LM Studio."

## Problem

Guildhall already has the beginnings of a multi-lane runtime:

- intake/spec shaping
- worker implementation
- reviewer fanout
- gate verification
- coordinator escalation

But the current product language and config model still blur together several
different concerns:

- auth source
- transport protocol
- model-role mapping
- lane concurrency
- worktree/slot ownership

That makes two future goals harder than they need to be:

1. **Queue throughput:** moving from one-task autonomy to bounded unattended
   processing.
2. **Provider portability:** supporting known authenticated CLIs plus arbitrary
   OpenAI-compatible and Anthropic-compatible providers without product-specific
   special cases leaking everywhere.

## Read

### Execution shape

Guildhall should not move toward an unstructured "swarm." The right mental
model is a **bounded multi-lane task runner**:

- a small worker pool that owns task implementation
- a narrow spec/intake lane
- a bounded review/gate lane
- a low-throughput coordinator/adjudication lane

Each lane has different context needs, retry policies, and model preferences.

### Provider shape

Guildhall should stop presenting local OpenAI-compatible servers as if one
product name were the protocol.

The user-facing provider families should be:

1. **Authenticated CLIs**
   - `codex-oauth`
   - `claude-oauth`
2. **Custom OpenAI-compatible providers**
   - local servers
   - hosted OpenAI-shaped APIs
   - one or more named saved connections
3. **Custom Anthropic-compatible providers**
   - hosted Anthropic-shaped APIs
   - one or more named saved connections

Specific products such as LM Studio or llama.cpp remain examples, not top-level
concepts.

## Decision

Guildhall should evolve toward:

1. **One normalized provider runtime contract**
   - all agents receive provider/runtime settings through the same resolver
   - protocol family, auth source, base URL, model map, capability flags, and
     fallback policy are resolved once per run
2. **A shared provider client pool**
   - transport clients are reused across worker/reviewer/coordinator agents
   - concurrency is bounded at the runtime level instead of per-agent ad hoc
3. **A bounded lane scheduler**
   - one queue, multiple lane types, explicit slot ownership
   - no free-roaming swarm behavior
4. **Provider-scoped model presets**
   - `all`
   - `smart` + `workhorse`
   - explicit 5-role map
5. **Capability-aware routing**
   - providers advertise whether they support streaming, tool calls, reasoning
     blocks, long-context turns, resumable sessions, and browser/app control
   - lane assignment and fallback use those capabilities, not just provider ids

## Product shape

### 1. Provider taxonomy

The runtime and UI should separate:

- **Provider family**
  - `codex-oauth`
  - `claude-oauth`
  - `openai-compatible`
  - `anthropic-compatible`
- **Connection**
  - the concrete saved credential/base URL entry
- **Model preset**
  - provider-scoped role map

This means "LM Studio" becomes a connection label or example under
`openai-compatible`, not a first-class provider type that the rest of the
system special-cases forever.

### 2. Connection records

Global provider config should eventually support multiple saved custom
connections per protocol family, for example:

```yaml
providers:
  codex-oauth:
    verifiedAt: "2026-05-02T00:00:00Z"
  claude-oauth:
    verifiedAt: "2026-05-02T00:00:00Z"
  openai-compatible:
    default: "nvidia"
    connections:
      nvidia:
        baseUrl: "https://integrate.api.nvidia.com/v1"
        apiKey: "${OPENAI_COMPATIBLE_API_KEY}"
      minipc:
        baseUrl: "http://minipc:1234/v1"
  anthropic-compatible:
    default: "direct"
    connections:
      direct:
        baseUrl: "https://api.anthropic.com"
        apiKey: "${ANTHROPIC_API_KEY}"
```

That is a direction note, not an immediate migration requirement. The shorter
near-term step is to normalize the UI and runtime around protocol families even
if only one connection per family is supported at first.

### 3. Provider-scoped models

Model config should remain provider-scoped and support three levels of
granularity:

```yaml
models:
  openai-compatible:
    all: "qwen/qwen3.5-122b-a10b"
```

```yaml
models:
  codex-oauth:
    smart: "gpt-5.3-codex"
    workhorse: "gpt-5.3-codex"
```

```yaml
models:
  claude-oauth:
    spec: "claude-sonnet-4-6"
    coordinator: "claude-sonnet-4-6"
    worker: "claude-sonnet-4-6"
    reviewer: "claude-sonnet-4-6"
    gateChecker: "claude-sonnet-4-6"
```

Resolution order:

1. explicit role key
2. `smart` / `workhorse`
3. `all`
4. built-in defaults for that provider family

### 4. Capability manifest

Every provider runtime should resolve to a compact capability manifest:

- streaming
- tool calling
- structured tool schema strictness
- reasoning side-channel behavior
- resumable session support
- browser/app-control safety
- max recommended concurrency
- max recommended context window class

This should become the basis for:

- routing specific lanes
- warning about dangerous assignments
- fallback decisions
- UI explainability

### 5. Lane scheduler

Guildhall should grow into a bounded scheduler with explicit lane classes:

1. **Spec lane**
   - default concurrency: `1`
   - handles intake, clarification, spec drafting
2. **Worker lane**
   - default concurrency: `N`, capped by worktree slots
   - owns code changes
3. **Review lane**
   - default concurrency: bounded fanout
   - persona reviewers and gate checker
4. **Coordinator lane**
   - default concurrency: `1`
   - adjudication, escalation synthesis, task splitting

These are logical lanes, not separate orchestrators.

### 6. Shared provider client pool

A run should create or acquire transport clients from a shared pool keyed by:

- provider family
- connection identity
- auth source
- base URL
- effective model preset hash

Agents should not hand-roll independent HTTP clients with slightly different
timeouts or base URLs. The pool is responsible for:

- connection reuse
- rate limiting / concurrency caps
- transient error backoff
- circuit breaking after repeated failures
- emitting provider-health events to the UI

### 7. Queue progression rules

Queue throughput should stay conservative:

1. Prove one task can finish and merge.
2. Allow one worker slot plus intake/review.
3. Scale to 3 concurrent worker slots with real blocked-state handling.
4. Only then consider 10+ tasks or "run until blocked/exhausted."

The target is not "50 agents talking." The target is:

- a boring queue
- visible blocked reasons
- reliable continuation through eligible work

### 8. Multi-project handling

The importer and runtime should continue to assume **single-project by
default**. Multi-project routing is exceptional and should require strong
evidence from the workspace shape.

This matters here because worker-pool scheduling and provider routing become
much harder to reason about if every nested folder becomes its own project by
accident.

## Runtime invariants

- **One config resolver.** Every lane gets provider/runtime settings from the
  same normalized resolver.
- **One client pool.** Agents do not create bespoke transport clients when an
  equivalent pooled client exists.
- **Slots cap workers.** Worktree/slot allocation remains the hard limit for
  code-changing concurrency.
- **Coordinator stays narrow.** Coordinators adjudicate and route; they do not
  become a second worker pool.
- **Capabilities outrank brand names.** Routing and fallback should use
  protocol/capability truth, not product labels.
- **Single-project is the default assumption.** Multi-project routing requires
  evidence, not mere nested folders.

## Suggested backlog

### Feature A: Provider taxonomy cleanup

Replace product-specific provider language with a protocol-first model:

- authenticated CLIs
- OpenAI-compatible custom providers
- Anthropic-compatible custom providers

### Feature B: Normalized provider runtime

Centralize effective provider/runtime resolution for every lane and every API
surface.

### Feature C: Capability manifest

Give the scheduler and UI a shared source of truth for provider abilities and
limits.

### Feature D: Shared client pool

Reuse clients and impose concurrency/rate limits centrally.

### Feature E: Lane scheduler

Turn the current one-task kernel into a bounded multi-lane queue runner without
introducing swarm ambiguity.

### Feature F: Throughput proof

Prove queue continuation first at 1 task, then 3, then 10, then "until
blocked/exhausted."

## Implementation tasks

1. **Rename provider UX to protocol families**
   - move user-facing docs/UI from `LM Studio` toward `OpenAI-compatible`
   - keep product names as examples or saved connection labels
2. **Introduce saved connection identities**
   - support at least one named custom connection per protocol family
   - leave room for multiple later
3. **Normalize effective provider runtime config**
   - one resolver used by start preflight, orchestrator lanes, provider tests,
     and UI status
4. **Add provider capability manifests**
   - static defaults plus runtime-learned hints
5. **Build a shared provider client pool**
   - keyed by normalized connection identity and effective model preset
6. **Add lane-level concurrency controls**
   - spec lane, worker lane, review lane, coordinator lane
7. **Bind worker concurrency to slot/worktree availability**
8. **Add blocked-state queue continuation**
   - skip blocked work, continue on eligible work, surface explicit reasons
9. **Add queue-run modes**
   - `finish one`
   - `finish up to N`
   - `run until blocked/exhausted`
10. **Prove unattended throughput**
   - one real task merged
   - three real tasks processed without manual restart
   - ten-task dry run with explicit blocked accounting

## Recommendation

Do not start by building a giant scheduler.

Start with the parts that simplify everything else:

1. provider taxonomy cleanup
2. normalized provider runtime config
3. capability manifest
4. shared client pool

Then layer the bounded lane scheduler on top of the already-proven one-task
kernel.
