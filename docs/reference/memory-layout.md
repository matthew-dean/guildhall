---
title: Memory layout
help_topic: reference.memory_layout
help_summary: |
  The memory/ directory is the on-disk state. Contains TASKS.json (queue),
  agent-settings.yaml (levers), sessions/ (per-agent snapshots),
  transcripts/ (audit trail), PROGRESS.md, events.ndjson, and
  optional business-envelope.yaml + engineering-defaults/ overrides.
---

# Memory layout

Everything GuildHall persists sits under `memory/` at the workspace root. Commit it with the project — the queue, levers, and transcripts are part of the project's history.

```
memory/
├─ TASKS.json                    # the work queue, keyed by task id
├─ agent-settings.yaml           # every lever + provenance
├─ business-envelope.yaml        # optional: Goals + Guardrails
├─ PROGRESS.md                   # append-only human-readable log
├─ events.ndjson                 # line-delimited JSON event log
├─ sessions/                     # per-agent conversation snapshots
│  └─ <project-hash>/<session>.json
├─ transcripts/                  # per-task audit trail (markdown)
│  └─ <task-id>/
│     ├─ transcript.md
│     └─ verdicts/
├─ skills/                       # optional: user-authored skills
│  └─ <skill-name>.md
├─ engineering-defaults/         # optional: shadowing built-in defaults
│  └─ <topic>.md
└─ guilds.yaml                   # optional: custom guild roster
```

## What to commit and what to ignore

- **Commit**: `TASKS.json`, `agent-settings.yaml`, `business-envelope.yaml`, `PROGRESS.md`, `transcripts/`, `skills/`, `engineering-defaults/`, `guilds.yaml`.
- **Ignore**: `events.ndjson`, `sessions/`. They regenerate and contain ephemeral stream data.

A starter `.gitignore` snippet:

```gitignore
memory/events.ndjson
memory/sessions/
.guildhall/config.yaml
.guildhall/worktrees/
```

## Global data

Session snapshots can alternately live in `~/.cache/guildhall/sessions/` keyed by `SHA1(projectPath)` — this is the default when `GUILDHALL_DATA_DIR` is unset.
