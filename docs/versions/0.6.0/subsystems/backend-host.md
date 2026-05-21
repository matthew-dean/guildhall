---
title: Backend host
help_topic: subsystem.backend_host
help_summary: |
  Bridges the agent runtime with the web UI over an OHJSON wire protocol
  (line-delimited JSON events prefixed with OHJSON:). Encodes state
  snapshots, transcript items, task transitions, and escalations.
---

# Backend host

**Source:** `src/backend-host/`

The backend host connects a running runtime to the web UI. Events flow out (transcript items, state changes, tool executions); commands flow in (submit_line, permission responses, command selections).

## Wire protocol

Every message is a single line prefixed with `OHJSON:` followed by a JSON object:

```
OHJSON:{"type":"ready"}
OHJSON:{"type":"state_snapshot","tasks":[...]}
OHJSON:{"type":"transcript_item","taskId":"task-001","item":{...}}
```

Line-prefix framing means the stream can be multiplexed with logs without a separate channel.

## Event types

**Backend → Frontend:**

- `ready` — handshake.
- `state_snapshot` — full tasks + run state.
- `transcript_item` — single turn addition to a task's transcript.
- `task_transition` — `{taskId, from, to, reason}`.
- `escalation_raised` — an agent or coordinator raised an escalation.
- `agent_issue` — recoverable agent-side issue (stall, rate-limit, etc.).

**Frontend → Backend:**

- `submit_line` — user text for the current agent.
- `permission_response` — approve/deny a pending permission prompt.
- `select_command` — user picked a dashboard action.

## Public API

```ts
import {
  ReactBackendHost,
  encodeBackendEvent,
  parseFrontendRequest,
} from 'guildhall/backend-host'

const host = new ReactBackendHost({ orchestrator, onEvent })
await host.handleRequest(request)
```

`ReactBackendHost` (the name is historical — it's backend-framework-agnostic) owns the bidirectional flow.
