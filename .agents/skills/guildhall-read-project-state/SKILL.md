---
name: guildhall-read-project-state
description: Read authoritative Guildhall project orientation, current tasks, registered artifacts, decisions, memory, and capability requests. Use when starting meaningful Guildhall work, asking what is current or next, resolving artifact IDs such as artifact:flow-audit, checking task state, or determining whether a checkout is initialized; do not use raw files as if they came from MCP.
---

# Read Guildhall Project State

1. Check whether Guildhall MCP resources and tools are available.
2. When available, read `guildhall://project`, `guildhall://project/tasks`, and
   `guildhall://project/artifacts` first. Read decisions, memory, runtime, or
   capability requests only when the task needs them.
3. Resolve registered artifacts with `guildhall.read_artifact`; do not copy a
   concrete artifact path into a new plan or handoff.
4. Treat an empty project config plus no tasks/artifacts as an uninitialized or
   unregistered checkout. State that plainly. Do not manufacture tasks or
   initialize the repository unless the owner requested initialization.
5. When MCP is unavailable or the project is not initialized, inspect local
   `guildhall.yaml`, `.guildhall/`, `internal/plans/README.md`, and relevant
   plans. Label those reads as local-file fallback evidence.
6. Before requesting new host access, list existing capability requests and
   create a non-duplicate request through Guildhall rather than assuming access.
7. After meaningful work driven by an active external task, append concise task
   evidence through Guildhall. Do not append evidence when no task exists.

Return the current authority source, active work, blockers or missing setup,
the next safe action, and any local fallback used.
