---
title: runtime_isolation
help_topic: lever.runtime_isolation
help_summary: |
  Whether parallel workers get isolated runtime resources (ports, PIDs,
  filesystem scratch dirs). `slot_allocation` assigns each worker a numbered
  slot whose env vars offset ports and paths; `none` lets workers share.
---

# `runtime_isolation`

**Scope:** project • **Default:** `none`

Whether fanned-out workers get isolated port/path slots.

## Positions

| Position | Effect |
|---|---|
| `none` | Workers share the project's runtime resources (ports, temp dirs). Fine for code-only tasks. |
| `slot_allocation` | Each worker gets a slot index. The orchestrator sets `GUILDHALL_SLOT=<n>`, `GUILDHALL_PORT_BASE=<base+n*100>`, etc., and the project's scripts can key off those. |

## When you need `slot_allocation`

- Parallel dev servers that would otherwise bind the same port.
- Parallel test runs that share a database or filesystem scratch space.
- Any workflow that spawns long-lived subprocesses.

## Related

- `SlotAllocator` in `src/runtime/` — the component that hands out slots.
- [`concurrent_task_dispatch`](./concurrent-task-dispatch) — `slot_allocation` only matters when fanning out.
