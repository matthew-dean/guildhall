---
title: Memory layout
help_topic: reference.memory_layout
help_summary: |
  Guildhall keeps compact shared project state in .guildhall and keeps bulky
  local history under ~/.guildhall/data/projects.
---

# Memory layout

Guildhall keeps enough state in the repo for another checkout to understand the
project, without committing every transcript, event, debug snapshot, or
intermediate receipt from every run.

That split has two lanes:

- **Shared project state** lives in `./.guildhall/`. Commit this when you want
  another checkout to understand the same project, tasks, settings, decisions,
  project facts, practices, personas, and compact progress.
- **Local history** lives in `~/.guildhall/data/projects/<project-hash>/`.
  This is for transcripts, stream events, context-debug snapshots, checkpoints,
  bootstrap status, session markers, and other bulky or private run evidence.

A teammate should be able to clone the project and see the accepted settings,
active tasks, sealed task summaries, decisions, and project facts. They should
not inherit your raw run history. That is the storage contract: compact shared
state in the repo, rich scrollback on your machine.

## Format Contract

The file format tells you who owns the data and how long it should live.

| Format | Used for | Why |
|---|---|---|
| YAML | Human-authored or human-reviewed project contract: `guildhall.yaml`, `.guildhall/agent-settings.yaml`, coordinator config, project practices, personas, business envelope, overrides. | YAML gives readable diffs, comments, and stable hand edits. Use it when a person may reasonably review or change the file. |
| JSON | Machine-owned bounded state: the active queue, task indexes, compact archive records, local evidence blobs, API payloads. | JSON has strict parsing and predictable TypeScript schema validation. Use it when the runtime owns the shape. Keep committed JSON small. |
| JSONL | Append-only high-volume history: event streams, refresh history, debug ledgers. | JSONL can be streamed one record at a time. Do not put months of append history into one committed JSON array. |
| Markdown | Narrative durable knowledge: project memory, decisions, progress summaries, specs, review packets. | Markdown is for prose people need to read. Keep committed Markdown curated, not a raw transcript dump. |

Two rules matter more than the extension:

- **Committed files must stay bounded.** `TASKS.json` is the active queue, not
  every task forever. Finished work is sealed into compact archive records,
  while full evidence moves to local history.
- **Raw history is local by default.** Transcripts, heartbeats, context-debug
  snapshots, checkpoints, and event streams live under
  `~/.guildhall/data/projects/<project-hash>/` unless a compact summary belongs
  in the shared project contract.

## Git Defaults

You should not have to manage a long allowlist by hand.

Commit:

- `./guildhall.yaml`
- shared `./.guildhall/` project state

Ignore:

- `./.guildhall/config.yaml`
- local/private `./.guildhall/` buckets such as `local/`, `worktrees/`,
  `cache/`, `tmp/`, `logs/`, `sessions/`, `transcripts/`, `context-debug/`,
  `events/`, and `checkpoints/`
- everything under `~/.guildhall/`

Guildhall writes and migrates a small managed block in the project
`.gitignore` for this. The mental model is: commit the project contract, do not
commit machine state.

Inside committed `.guildhall`, Guildhall keeps the files bounded. Active tasks
stay in `TASKS.json`; finished work is sealed into compact task archives;
heartbeats, transcripts, checkpoints, debug snapshots, raw events, and full
archive evidence go to local history automatically.

## Migration

Older projects with `./memory/` can be migrated in place. Start with a dry run:

```sh
guildhall memory migrate-0.8.0 .
```

Then apply it:

```sh
guildhall memory migrate-0.8.0 --apply --delete-source --update-gitignore .
```

The migration moves compact shared state into `./.guildhall/`, moves bulky or
private evidence into `~/.guildhall/data/projects/<project-hash>/`, and removes
the old root `memory/` directory. It also compacts the shared state it just
created, archiving terminal tasks into sharded files and moving heartbeat
progress into local history.

You can run the same compaction later as a maintenance step:

```sh
guildhall memory compact-project-state --apply .
```

This keeps `TASKS.json` focused on active work even after months of finished
tasks. Terminal task records remain committed, but each one changes in its own
small file instead of continually inflating one large JSON document. When a
task is sealed, Guildhall keeps a compact committed record and moves full
notes, verdicts, adjudications, gate history, and issue evidence into local
history.

## Retention

Local history is allowed to be generous because it is not committed, but it is
not meant to grow forever. Guildhall tracks local history size and file count per
project, keeps important audit evidence, and can compact old transcripts and
debug snapshots into smaller summaries when a project gets large.

Deleting local history does not delete committed project state. The project
falls back to the shared task/spec/planning summaries in `./.guildhall/`.

## Global Data

Machine-global Guildhall state sits outside the project:

- `~/.guildhall/registry.yaml` — registered projects
- `~/.guildhall/providers.yaml` — shared API keys and local-model URLs
- `~/.guildhall/config.yaml` — machine-wide defaults
- `~/.guildhall/learning.json` — user/global learned preferences
- `~/.guildhall/data/projects/<project-hash>/` — local history for one project
