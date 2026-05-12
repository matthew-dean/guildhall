---
title: Web server routes
help_topic: reference.http_api
help_summary: |
  The Hono server at src/runtime/serve.ts exposes REST + SSE endpoints the
  dashboard uses. Default port 7777. Project-scoped routes are anchored to
  the current project, and secrets are redacted in /api/config.
---

# HTTP API

Served by `src/runtime/serve.ts` (Hono). Default port `7777`. All routes are local-only unless you've explicitly bound externally.

## Service and page routes

- `GET /` — SPA root.
- `GET /projects` — projects home.
- `GET /setup` — setup wizard.
- `GET /api/service` — service metadata plus registered projects.
- `POST /api/service/attach-project` — attach a folder into the local service.

## Project state

| Route | Purpose |
|---|---|
| `GET /api/project` | Project detail + tasks + run state. |
| `GET /api/project/inbox` | Human-facing inbox items and blockers. |
| `GET /api/project/thread` | Thread surface data for setup, approvals, questions, and live work. |
| `GET /api/project/facts` | Aggregated project facts used by Settings. |
| `POST /api/project/start` | Boot the orchestrator. |
| `POST /api/project/stop` | Graceful stop. |
| `GET /api/project/activity` | Activity summary (counts by status). |
| `GET /api/project/progress` | Tail of `PROGRESS.md`. |
| `GET /api/project/events` | SSE feed of orchestrator events. |
| `GET /api/project/release-readiness` | Aggregated release-readiness verdict. |

## Tasks

| Route | Purpose |
|---|---|
| `POST /api/project/intake` | Create exploring task. Body: `{ask, domain?, title?}`. |
| `GET /api/project/task/:id` | Full task + recent events. |
| `POST /api/project/task/:id/pause` | Mark blocked. |
| `POST /api/project/task/:id/shelve` | Mark shelved. |
| `POST /api/project/task/:id/unshelve` | Move shelved work back into the queue. |
| `POST /api/project/task/:id/approve-brief` | Mark the brief as human-approved. |
| `POST /api/project/task/:id/approve-spec` | Advance to `spec_review`. |
| `POST /api/project/task/:id/resume` | Append follow-up to transcript. |
| `POST /api/project/task/:id/resolve-escalation` | Close an escalation. |
| `POST /api/project/task/:id/answer-questions` | Submit staged answers for co-active questions. |

## Meta-intake

| Route | Purpose |
|---|---|
| `POST /api/project/meta-intake` | Kick off bootstrap. |
| `POST /api/project/meta-intake/rerun` | Re-seed the bootstrap flow. |
| `GET /api/project/meta-intake/draft` | Current spec + coordinator draft preview. |
| `POST /api/project/meta-intake/approve` | Merge draft into `guildhall.yaml`. |
| `POST /api/project/meta-intake/synthesize` | Compress draft signals into a cleaner draft. |
| `GET /api/project/bootstrap/status` | Bootstrap verification status. |
| `POST /api/project/bootstrap/run` | Run verified bootstrap synchronously. |

## Workspace import and learning

| Route | Purpose |
|---|---|
| `GET /api/project/workspace-import/status` | Current import state and queue summary. |
| `GET /api/project/workspace-import/draft` | Draft import payload for review. |
| `POST /api/project/workspace-import` | Seed workspace import. |
| `POST /api/project/workspace-import/rerun` | Re-run import discovery. |
| `POST /api/project/workspace-import/approve` | Promote reviewed import findings. |
| `POST /api/project/workspace-import/dismiss` | Dismiss current import review without deleting it. |
| `GET /api/project/learning` | Effective project/user learning snapshot. |

## Config & providers

| Route | Purpose |
|---|---|
| `GET /api/config` | Project config (secrets redacted). |
| `GET /api/config/levers` | Current lever positions. |
| `GET /api/project/design-system` | Current design system or null. |
| `GET /api/project/local-config` | Local landing/merge preferences. |
| `GET /api/setup/providers` | Detect providers and current setup status. |
| `POST /api/setup/providers/config` | Save one provider's credential/config. |

## Wire format

Most responses are plain JSON. `GET /api/project/events` is `text/event-stream`; each event has a `type` field matching one of the types in [`src/backend-host/wire.ts`](../subsystems/backend-host).
