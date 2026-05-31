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

A teammate can clone the project and see the accepted settings, active tasks,
sealed task summaries, decisions, and project facts. They do not inherit your
raw run history. The short version: commit the compact project record; keep the
rich scrollback on your machine.

## File Formats

The file format gives you a quick clue about who is meant to read or edit the
file.

| Format | Used for | Why |
|---|---|---|
| YAML | Project settings you may review or edit: `guildhall.yaml`, `.guildhall/agent-settings.yaml`, coordinator config, project practices, personas, business envelope, overrides. | YAML gives readable diffs, comments, and stable hand edits. |
| JSON | App-owned state: the active queue, task indexes, compact archive records, local evidence blobs, API payloads. | JSON is strict and predictable. Guildhall keeps committed JSON small. |
| JSONL | Append-only high-volume history: event streams, refresh history, debug ledgers. | JSONL can be streamed one record at a time. Do not put months of append history into one committed JSON array. |
| Markdown | Narrative durable knowledge: project memory, decisions, progress summaries, specs, review packets. | Markdown is for prose people need to read. Keep committed Markdown curated, not a raw transcript dump. |

Two rules matter more than the extension:

- **Committed files must stay bounded.** `TASKS.json` is the active queue, not
  every task forever. Finished work is sealed into compact archive records,
  while full evidence moves to local history.
- **Raw history is local by default.** Transcripts, heartbeats, context-debug
  snapshots, checkpoints, and event streams live under
  `~/.guildhall/data/projects/<project-hash>/` unless a compact summary belongs
  in the shared project record.

## Evidence Links

Compact memory is allowed to summarize. It is not allowed to become
untraceable.

When a compact shared artifact can affect future work, Guildhall keeps links
back to the evidence that produced it. Task summaries, sealed archives,
pressure-test facts, project memories, practice proposals, global preference
suggestions, and resume checkpoints can point back to task ids, transcript ids,
event ids, checkpoint ids, or local-history paths.

The pattern is simple:

- the compact artifact explains the useful conclusion;
- its source references identify the raw or fuller local evidence;
- the UI can show the summary first and let a reviewer drill into evidence when
  the conclusion matters.

If local history has been compacted or deleted, Guildhall says that the full
evidence is no longer available instead of presenting the compact summary as if
it were independently proven.

## Git Defaults

You should not have to manage a long allowlist by hand.

Commit:

- `./guildhall.yaml`
- shared `./.guildhall/` project state

Ignore:

- `./.guildhall/config.yaml`
- generated Corpus Map files such as `./.guildhall/codebase-map.yaml`,
  `./.guildhall/codebase-map.stale.json`, and
  `./.guildhall/codebase-map.history.jsonl`
- `./.guildhall/external-agent-links.json`, which can contain local agent ids
  and checkout-specific target paths
- local/private `./.guildhall/` buckets such as `local/`, `worktrees/`,
  `cache/`, `tmp/`, `logs/`, `sessions/`, `transcripts/`, `context-debug/`,
  `events/`, `checkpoints/`, and `dev-tools/`
- everything under `~/.guildhall/`

Guildhall writes and migrates a small managed block in the project
`.gitignore` for this. The mental model is: commit the project plan and compact
state; do not commit machine state.

The Corpus Map is regenerated from the checkout when Guildhall assembles agent
context or when you refresh it from Settings/CLI. Because it records the local
project root and deterministic scan output, the generated map is ignored even
though human-authored overlays such as
`./.guildhall/codebase-map.overrides.yaml` remain trackable.

Inside committed `.guildhall`, Guildhall keeps the files bounded. Active tasks
stay in `TASKS.json`; finished work is sealed into compact task archives;
heartbeats, transcripts, checkpoints, debug snapshots, raw events, and full
archive evidence go to local history automatically.

## Migration

Guildhall tracks project migrations in `./.guildhall/migrations.json`. That
ledger is versioned so future releases can add project, workspace, or database
migrations without turning each one into a separate one-off command.

Start by checking the project:

```sh
guildhall migrate status .
guildhall migrate plan .
```

Then apply safe automatic migrations:

```sh
guildhall migrate apply .
```

Some 0.8.0 migrations intentionally wait for explicit approval because they
touch project-facing files. Use `--include-prompt` when you are ready for those:

```sh
guildhall migrate apply --include-prompt .
```

Guildhall 0.9 also lists a manual runtime-backed project migration. That
migration is not applied by the package installer or by `guildhall migrate
apply`. It is guided from the app because Guildhall first checks the mounted
project directory, the mounted `~/.guildhall` directory, required runtime tools,
DNS, and command-log persistence. Host-run compatibility remains available
until those checks pass and you accept runtime-backed mode for that project.

The runtime migration record lives in host-owned local history, not in the
project checkout. It records the runtime image tag/digest, runtime API version,
mount layout such as `/workspace/<project-slug>` and
`/home/guildhall/.guildhall`, the health-check result, and the rollback state
needed to return to host-run compatibility.

If `guildhall migrate status` shows a migration under `Blocked`, the current
runtime cannot safely run the project yet. That usually means the project is on
an old storage location or incompatible schema. Guildhall asks before writing
the migration so you can avoid surprise Git changes, but the project needs that
migration before new runs or task resumes can continue.

Older projects with `./memory/` can still run the direct compatibility command.
Start with a dry run:

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

The compatibility command is useful when you want direct control over
`--delete-source` and `--update-gitignore`. For release-by-release checks, use
the generic `guildhall migrate` commands first.

When `--update-gitignore` makes a previously committed local/private file
ignored, the migration also removes that file from the Git index while leaving
the working-tree copy in place. Commit the resulting deletion so future clones
stop tracking machine-local Guildhall state.

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

When a task reaches done, Guildhall also creates a done-task summary bundle. That
bundle keeps the journey, decision, evidence, learning candidates, and open
residue in committed project state, while the full transcript moves back to
source-evidence status. If an old transcript is compacted or pruned, the summary
keeps evidence references and marks whether the full evidence is still
available.

Deleting local history does not delete committed project state. The project
falls back to the shared task/spec/planning summaries in `./.guildhall/`.

## Global Data

Machine-global Guildhall state sits outside the project:

- `~/.guildhall/registry.yaml` — registered projects
- `~/.guildhall/providers.yaml` — shared API keys and local-model URLs
- `~/.guildhall/config.yaml` — machine-wide defaults
- `~/.guildhall/learning.json` — user/global learned preferences
- `~/.guildhall/data/projects/<project-hash>/` — local history for one project

## MCP View

MCP resources are a bounded view over the same split. They are not raw directory
listings.

Stable project resources include:

- `guildhall://project` — compact project, runtime, memory, codebase, and
  context health.
- `guildhall://project/tasks` and `guildhall://project/tasks/<task-id>` —
  queue and task summaries.
- `guildhall://project/artifacts` and
  `guildhall://project/artifacts/<artifact-id>` — registered artifacts such as
  flow audits.
- `guildhall://project/feedback` — accepted feedback and decision packets for
  workers and reviewers.
- `guildhall://project/design` — Design System Profile, taste,
  catalog/preview, and design feedback summary.
- `guildhall://project/memory` and `guildhall://project/learning` — active
  memory and suggested learnings.
- `guildhall://project/context` and `guildhall://project/local-history` —
  bounded context-debug and local-history health, not raw transcripts.
- `guildhall://project/codebase-knowledge` — Corpus Map freshness and read-next
  pointers.
- `guildhall://project/runtime` — runtime state, image, migration mode, mounts,
  ports, and health checks.
- `guildhall://project/capability-requests` — requested host access or other
  missing capabilities.

The bridge also exposes memory tools so outside agents can list, read, record,
or update memory through the same validation path Guildhall uses.
