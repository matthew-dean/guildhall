# Guildhall MCP Server Contract

**Status:** 0.9 MCP/runtime/memory slice

Guildhall exposes project state to external agents through a host-owned MCP
server. The MCP contract names Guildhall concepts, not execution backends.
Podman, host-browser proxying, credential brokering, and container-engine
brokering can sit behind the same contract later.

## Resources

- `guildhall://project`
- `guildhall://project/tasks`
- `guildhall://project/tasks/<task-id>`
- `guildhall://project/artifacts`
- `guildhall://project/artifacts/<artifact-id>`
- `guildhall://project/decisions`
- `guildhall://project/memory`
- `guildhall://project/learning`
- `guildhall://project/context`
- `guildhall://project/local-history`
- `guildhall://project/codebase-knowledge`
- `guildhall://project/runtime`
- `guildhall://project/capability-requests`

`guildhall://project` is the audit overview. It includes runtime state, memory
health, codebase-map freshness, and the latest context-debug health so an
external agent can answer "what does Guildhall know and how healthy is that
knowledge?" before it falls back to shell reads.

`guildhall://project/memory` is not just `MEMORY.md`. It summarizes the
normalized memory store, project/global learning adapters, project skills, and
the compact Markdown memory artifact. Proposed and observed memory stays
visible as untrusted/proposed; active and used memory is what agents can rely on
without re-asking.

`guildhall://project/context` exposes bounded context-debug summaries: task,
agent, model, context size, health warnings, and memory packet counts. It does
not dump full prompts or transcripts.

`guildhall://project/local-history` is health-only by default. It names where
local history lives, file counts, byte counts, and retention hints, but does not
stream transcripts, command logs, or snapshots through a broad resource.

`guildhall://project/codebase-knowledge` summarizes the codebase map, stale
marker, areas, abstractions, and read-next guidance.

`guildhall://project/runtime` summarizes runtime status, backend setup,
migration mode, image, mounts, ports, and bounded health checks.

## Tools

- `guildhall.read_artifact`
- `guildhall.append_task_evidence`
- `guildhall.create_capability_request`
- `guildhall.list_capability_requests`
- `guildhall.list_memory`
- `guildhall.read_memory`
- `guildhall.record_memory_observation`
- `guildhall.update_memory_status`
- `guildhall.read_effective_context`

## Audit Rule

Any tool that mutates Guildhall state writes a visible evidence record with the
calling source, task id when available, timestamp, and plain-language summary.

Memory tools are lifecycle-aware. External agents can record observed memory,
promote or retire it by status, read a specific record by id, and ask Guildhall
for the effective memory packet it would inject for a task. This lets MCP
clients verify what Guildhall knows and what it withheld instead of guessing
from raw files.

## Runtime Boundary

The first server runs on the host over stdio. Container runtimes can later use a
proxied context, but the public MCP tools remain intent-shaped:
`create_capability_request`, not `mount_podman_volume`.

## Bounding And Redaction

MCP resources are summary surfaces by default. They clip long output and redact
common secret tokens and secret-looking key/value lines. Broad resources do not
dump unbounded logs, full prompts, transcript bodies, environment files, or
runtime command output. Purpose-built tools can expose narrower records later,
but each such tool must keep an explicit budget and state why the data is safe
to show.
