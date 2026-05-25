# Guildhall MCP Server Contract

**Status:** first implementation slice

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
- `guildhall://project/capability-requests`

## Tools

- `guildhall.read_artifact`
- `guildhall.append_task_evidence`
- `guildhall.create_capability_request`
- `guildhall.list_capability_requests`

## Audit Rule

Any tool that mutates Guildhall state writes a visible evidence record with the
calling source, task id when available, timestamp, and plain-language summary.

## Runtime Boundary

The first server runs on the host over stdio. Container runtimes can later use a
proxied context, but the public MCP tools remain intent-shaped:
`create_capability_request`, not `mount_podman_volume`.
