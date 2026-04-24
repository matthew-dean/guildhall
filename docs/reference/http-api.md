---
title: Web server routes
help_topic: reference.http_api
help_summary: |
  The Hono server at src/runtime/serve.ts exposes REST + SSE endpoints the
  dashboard uses. Default port 7842. Secrets are redacted in /api/config.
---

# HTTP API

Served by `src/runtime/serve.ts` (Hono). Default port `7842`. All routes are local-only unless you've explicitly bound externally.

## Page routes

- `GET /` — SPA root (detail or setup).
- `GET /setup` — setup wizard.

## Project state

| Route | Purpose |
|---|---|
| `GET /api/project` | Project detail + tasks + run state. |
| `POST /api/project/start` | Boot the orchestrator. |
| `POST /api/project/stop` | Graceful stop. |
| `GET /api/project/activity` | Activity summary (counts by status). |
| `GET /api/project/progress` | Tail of `PROGRESS.md`. |
| `GET /api/project/events` | SSE feed of orchestrator events. |

## Tasks

| Route | Purpose |
|---|---|
| `POST /api/project/intake` | Create exploring task. Body: `{ask, domain?, title?}`. |
| `GET /api/project/task/:id` | Full task + recent events. |
| `POST /api/project/task/:id/pause` | Mark blocked. |
| `POST /api/project/task/:id/shelve` | Mark shelved. |
| `POST /api/project/task/:id/approve-spec` | Advance to `spec_review`. |
| `POST /api/project/task/:id/resume` | Append follow-up to transcript. |
| `POST /api/project/task/:id/resolve-escalation` | Close an escalation. |

## Meta-intake

| Route | Purpose |
|---|---|
| `POST /api/project/meta-intake` | Kick off bootstrap. |
| `GET /api/project/meta-intake/draft` | Current spec + coordinator draft preview. |
| `POST /api/project/meta-intake/approve` | Merge draft into `guildhall.yaml`. |

## Config & providers

| Route | Purpose |
|---|---|
| `GET /api/config` | Project config (secrets redacted). |
| `GET /api/config/levers` | Current lever positions. |
| `GET /api/project/design-system` | Current design system or null. |
| `POST /api/setup/providers` | Detect & configure installed providers. |

## Wire format

Most responses are plain JSON. `GET /api/project/events` is `text/event-stream`; each event has a `type` field matching one of the types in [`src/backend-host/wire.ts`](../subsystems/backend-host).
