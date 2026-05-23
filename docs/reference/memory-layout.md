---
title: Memory layout
help_topic: reference.memory_layout
help_summary: |
  The memory/ directory is the on-disk state. Contains TASKS.json (queue),
  agent-settings.yaml (levers), learning.json (project learning),
  project-skills.json (project skill proposals), sessions/ (per-agent snapshots),
  transcripts/ (audit trail), PROGRESS.md, events.ndjson, and
  optional business-envelope.yaml + engineering-defaults/ overrides.
---

# Memory layout

Everything Guildhall persists sits under `memory/` at the project root.
Commit it with the project — the queue, levers, and transcripts are part of
the project's history.

```
memory/
├─ TASKS.json                    # the work queue, keyed by task id
├─ agent-settings.yaml           # every lever + provenance
├─ learning.json                 # project-scoped learned behavior
├─ project-skills.json           # suggested/active/dismissed project skills
├─ business-envelope.yaml        # optional: Goals + Guardrails
├─ PROGRESS.md                   # append-only human-readable log
├─ events.ndjson                 # line-delimited JSON event log
├─ sessions/                     # per-agent conversation snapshots
│  └─ <project-hash>/<session>.json
├─ transcripts/                  # per-task audit trail (markdown)
│  └─ <task-id>/
│     ├─ transcript.md
│     └─ verdicts/
├─ skills/                       # optional: explicit project skill files
│  └─ <skill-name>.md
├─ engineering-defaults/         # optional: shadowing built-in defaults
│  └─ <topic>.md
└─ guilds.yaml                   # optional: custom guild roster
```

## What to commit and what to ignore

- **Commit**: `TASKS.json`, `agent-settings.yaml`, `learning.json`, `project-skills.json`, `business-envelope.yaml`, `PROGRESS.md`, `transcripts/`, `skills/`, `engineering-defaults/`, `guilds.yaml`.
- **Ignore**: `events.ndjson`, `sessions/`. They regenerate and contain ephemeral stream data.

## Learned behavior

Project-specific learning lives in `memory/learning.json`. It records suggested
and active project facts, project policies, product suggestions, and workspace
import defaults learned from this project. Project skill proposals live next to
it in `memory/project-skills.json`; active project skills are still only used
when the workspace opts into project-local skills.

Machine-wide user preferences and model-lane recommendations live outside the
project in `~/.guildhall/learning.json`.

Use Settings → Memory in the browser to inspect project memories,
cross-project preferences, project playbooks, and Guildhall product ideas. You
can accept, dismiss, make project-wide, or reset learned records there. Product
ideas can open a prefilled GitHub issue draft with **Give product feedback**,
but they do not change runtime behavior by themselves.

A starter `.gitignore` snippet:

```gitignore
memory/events.ndjson
memory/sessions/
.guildhall/config.yaml
.guildhall/worktrees/
```

## Global data

Session snapshots live under `~/.guildhall/data/sessions/` by default when
`GUILDHALL_DATA_DIR` is unset.

Machine-global Guildhall state sits outside the project:

- `~/.guildhall/registry.yaml` — registered projects
- `~/.guildhall/providers.yaml` — shared API keys and local-model URLs
- `~/.guildhall/config.yaml` — machine-wide defaults
- `~/.guildhall/learning.json` — user/global learned preferences and model-lane recommendations
