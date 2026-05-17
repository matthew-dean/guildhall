---
title: CLI reference
help_topic: reference.cli
help_summary: |
  Every shipped `guildhall` subcommand — init, register, unregister, list,
  run, serve, start, open, stop, config, intake, approve-spec, resume,
  meta-intake, and approve-meta-intake — with flags and examples.
---

# CLI reference

**Entry point:** `src/runtime/cli.ts` (bundled to `dist/cli.js` → `guildhall` bin).

The CLI talks to the same local service and project files as the browser UI. Use
it when the terminal is the faster control surface or when you want Guildhall
inside another script.

## `guildhall init [path]`

Interactive setup flow. Creates `guildhall.yaml`, registers the project, and
opens the browser UI at the setup wizard for that project.

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

## `guildhall intake "<ask>"`

Create a new `exploring` task (FR-12). The Spec Agent picks it up on the next tick.

Flags:

- `--workspace <id|path>` — target project. The flag keeps the runtime term.
- `--domain <id>` — *required*; which coordinator domain owns this task.
- `--project <path>` — override projectPath for this task only.
- `--title <string>` — short human title.
- `--task-id <id>` — supply an explicit id.

## `guildhall approve-spec <task-id>`

Advance a task from `spec_review` to `ready`.

Flags: `--workspace <id|path>` (target project), `--note <string>`.

## `guildhall resume <task-id>`

Append a follow-up message to an `exploring` task (continues the intake conversation).

Flags: `--workspace <id|path>` (target project), `--message <string>`, `--resolve-escalation <id>`, `--resolution <string>`.

## `guildhall meta-intake`

Bootstrap coordinators by interviewing the agent about your codebase (FR-14). Writes a draft; does not modify `guildhall.yaml` until approved.

Flags: `--workspace <id|path>` (target project), `--force` (re-run even if already bootstrapped).

## `guildhall approve-meta-intake`

Merge the meta-intake draft into `guildhall.yaml`.

Flags: `--workspace <id|path>` (target project).

## Examples

```bash
guildhall init ~/projects/my-app
guildhall run my-app --domain ui
guildhall intake "add a ghost button" --workspace my-app --domain ui
guildhall approve-spec task-001 --workspace my-app
guildhall serve
```
