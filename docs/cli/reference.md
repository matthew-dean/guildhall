---
title: CLI reference
help_topic: reference.cli
help_summary: |
  Every shipped `guildhall` subcommand — init, register, unregister, list,
  run, serve, start, open, stop, config, and model-bakeoff — with flags and
  examples.
---

# CLI reference

**Entry point:** `src/runtime/cli.ts` (bundled to `dist/cli.js` → `guildhall` bin).

The CLI talks to the same local service and project files as the browser UI.
Use it for local service lifecycle, project registry management, and focused
debug runs. Task creation, approval, and setup interviews live in the browser
UI and HTTP API rather than as separate human-facing CLI commands.

## `guildhall init [path]`

Open the setup flow for a project. The default path launches the browser setup
wizard; completing that flow creates `guildhall.yaml` and registers the
project.

Flags:

- `--port <n>` (default `7777`) — local service / browser UI port.
- `--no-browser` — don't auto-open the browser.
- `--cli-wizard` — use the text wizard instead of the web one.
- `--no-serve` — with `--cli-wizard`, write `guildhall.yaml` and register the
  project without launching the web wizard. Without `--cli-wizard`, Guildhall
  still serves the browser setup flow.

## `guildhall register <path>`

Register an existing project (must contain `guildhall.yaml`) in
`~/.guildhall/registry.yaml`.

## `guildhall unregister <id|path>`

Remove a project from the registry. Does not delete `memory/` or
`guildhall.yaml`.

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

## `guildhall model-bakeoff [--context-indexer] [output.json]`

Write a deterministic model bakeoff replay report. The command currently uses
saved replay scenarios and simulated lanes so it can validate Guildhall's
scoring/reporting path without spending provider credits.

Default output:

- `artifacts/model-bakeoff/model-bakeoff-report.json`
- `artifacts/model-bakeoff/model-bakeoff-report.md`

Use `--context-indexer` to run the semantic Corpus Map bakeoff. That writes
`artifacts/model-bakeoff/context-indexer-report.json` and a Markdown summary by
default, using DeepInfra candidate lanes for choosing a cheap, fast indexing
model.

The optional positional argument chooses the JSON path. Guildhall writes the
Markdown summary beside it.

## Examples

```bash
guildhall init ~/projects/my-app
guildhall run my-app --domain ui
guildhall serve
guildhall model-bakeoff artifacts/model-bakeoff/report.json
guildhall model-bakeoff --context-indexer
```
