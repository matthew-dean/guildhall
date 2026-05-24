---
title: CLI reference
help_topic: reference.cli
help_summary: |
  Every shipped `guildhall` subcommand — init, register, unregister, list,
  run, serve, start, open, stop, config, corpus-map, and model-bakeoff — with
  flags and examples.
---

# CLI reference

**Entry point:** `./src/runtime/cli.ts` (bundled to `dist/cli.js` → `guildhall` bin).

The CLI talks to the same local service and project files as the browser UI.
Use it for local service lifecycle, project registry management, and focused
debug runs. Task creation, approval, and setup interviews live in the browser
UI rather than as separate human-facing CLI commands.

## `guildhall init [path]`

Open the setup flow for a project. The default path launches the browser setup
wizard; completing that flow creates `./guildhall.yaml` and registers the
project.

Flags:

- `--port <n>` (default `7777`) — local service / browser UI port.
- `--no-browser` — don't auto-open the browser.
- `--cli-wizard` — use the text wizard instead of the web one.
- `--no-serve` — with `--cli-wizard`, write `./guildhall.yaml` and register the
  project without launching the web wizard. Without `--cli-wizard`, Guildhall
  still serves the browser setup flow.

## `guildhall register <path>`

Register an existing project (must contain `./guildhall.yaml`) in
`~/.guildhall/registry.yaml`.

## `guildhall unregister <id|path>`

Remove a project from the registry. Does not delete `./.guildhall/` or
`./guildhall.yaml`.

## `guildhall list`

Print all registered projects with id, name, and absolute path.

## `guildhall run [id|path]`

Run the orchestrator. Blocks until Ctrl-C or no work remains.

Flags:

- `--domain <id>` — only tick this one coordinator domain.
- `--max-ticks <n>` — stop after N ticks. For testing.
- `--one-task` — stop after one task reaches a terminal, PR, or blocked handoff.

## `guildhall serve [path]`

Ensure Guildhall is running locally, then open the browser UI.

Flags:

- `--no-open` — don't open a browser.
- `[path]` — optional project path hint to open directly.

## `guildhall start`

Start the local Guildhall service in the background.

This is the daemon-style path when you want the service to keep running without
holding open the current terminal.

## `guildhall open [path]`

Open the running service in a browser. If the service is not already running,
Guildhall starts it first.

Flags:

- `[path]` — optional project path hint used when the service needs to start.

## `guildhall stop`

Stop the background Guildhall service.

## `guildhall config [id|path]`

Re-run the setup wizard against an existing project.

## `guildhall corpus-map refresh [--semantic] [path]`

Rebuild the compact [Corpus Map](../guide/corpus-map) for a workspace. This is mostly a debugging or
repair command; Guildhall also creates and refreshes maps during normal agent
context assembly.

```bash
guildhall corpus-map refresh .
guildhall corpus-map refresh --semantic .
```

Use `--semantic` to run the model-assisted `contextIndexer` enrichment pass
after the deterministic map is built. That pass writes purpose, architecture,
canonical abstraction, risk, and read-next guidance into the map's `semantic`
section.

## `guildhall memory migrate-0.8.0 [path]`

Dry-run or apply the 0.8.0 project-state migration. The migration moves legacy
`./memory/` content into the new split, compacts committed `.guildhall` state,
seals terminal tasks into small archive records, moves full evidence to local
history, and keeps heartbeat/progress noise out of committed files.

```bash
guildhall memory migrate-0.8.0 .
guildhall memory migrate-0.8.0 --apply --delete-source --update-gitignore .
```

Flags:

- `--apply` — write changes. Without it, the command reports a dry run.
- `--delete-source` — remove migrated legacy `./memory/` files after copying.
- `--update-gitignore` — write or refresh Guildhall's managed `.gitignore`
  block for shared `.guildhall` state and local/private ignores. If this makes
  an already tracked local/private file ignored, Guildhall removes it from the
  Git index and leaves the local copy on disk; commit that deletion.

## `guildhall memory compact-project-state [path]`

Run the compaction half of the migration against a project that already uses
`.guildhall`. This is safe as a maintenance command when a project has had many
task transitions.

```bash
guildhall memory compact-project-state --apply .
```

## `guildhall model-bakeoff [--context-indexer] [output.json]`

Write a deterministic model comparison replay report. The command currently
uses saved replay scenarios and simulated lanes so it can validate Guildhall's
scoring/reporting path without spending provider credits.

Default output:

- `artifacts/model-bakeoff/model-bakeoff-report.json`
- `artifacts/model-bakeoff/model-bakeoff-report.md`

Use `--context-indexer` to compare semantic [Corpus Map](../guide/corpus-map) candidates. That writes
`artifacts/model-bakeoff/context-indexer-report.json` and a Markdown summary by
default, using DeepInfra candidate lanes for choosing a cheap, fast indexing
model. The report includes the real-project evaluation ladder:
`narrative-harness` for documentation/product intent, `linecraft` for the first
small-to-medium code corpus, the Guildhall UI slice for design-system reuse,
and `jess` for hard architecture.

The optional positional argument chooses the JSON path. Guildhall writes the
Markdown summary beside it.

## Examples

```bash
guildhall init ~/projects/my-app
guildhall run my-app --domain ui
guildhall serve
guildhall corpus-map refresh --semantic .
guildhall model-bakeoff artifacts/model-bakeoff/report.json
guildhall model-bakeoff --context-indexer
```
