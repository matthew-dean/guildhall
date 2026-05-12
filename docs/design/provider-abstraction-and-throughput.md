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
2. **Bounded lane-specific concurrency**
3. **Explicit slot/worktree ownership**
4. **Product copy that describes protocol families, not incidental product names**
