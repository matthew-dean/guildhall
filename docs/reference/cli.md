---
title: CLI reference
help_topic: reference.cli
help_summary: |
  Every `guildhall` subcommand — init, register, list, run, serve, config,
  intake, approve-spec, resume, meta-intake, approve-meta-intake — with
  flags and examples.
---

# CLI reference

**Entry point:** `src/runtime/cli.ts` (bundled to `dist/cli.js` → `guildhall` bin).

## `guildhall init [path]`

Interactive setup wizard. Creates `guildhall.yaml`, registers the workspace, and pops open the dashboard at `/setup`.

Flags:

- `--port <n>` (default `7842`) — dashboard port.
- `--no-browser` — don't auto-open the browser.
- `--no-serve` — don't start the dashboard at all; just write config.
- `--cli-wizard` — use the text wizard instead of the web one.

## `guildhall register <path>`

Register an existing workspace (must contain `guildhall.yaml`) in `~/.guildhall/registry.yaml`.

## `guildhall unregister <id|path>`

Remove a workspace from the registry. Does not delete `memory/` or `guildhall.yaml`.

## `guildhall list`

Print all registered workspaces with id, name, and absolute path.

## `guildhall run [id|path]`

Run the orchestrator. Blocks until Ctrl-C or no work remains.

Flags:

- `--domain <id>` — only tick this one coordinator domain.
- `--max-ticks <n>` — stop after N ticks. For testing.
- `--one-task` — stop after one task reaches a terminal, PR, or blocked
  handoff point.

## `guildhall serve [path]`

Start the web dashboard.

Flags:

- `--port <n>` (default `7842`).
- `--no-open` — don't open a browser.

## `guildhall config [id|path]`

Re-run the setup wizard against an existing workspace.

## `guildhall intake "<ask>"`

Create a new `exploring` task (FR-12). The Spec Agent picks it up on the next tick.

Flags:

- `--workspace <id|path>` — target workspace.
- `--domain <id>` — *required*; which coordinator domain owns this task.
- `--project <path>` — override projectPath for this task only.
- `--title <string>` — short human title.
- `--task-id <id>` — supply an explicit id.

## `guildhall approve-spec <task-id>`

Advance a task from `exploring` to `spec_review`.

Flags: `--workspace <id|path>`, `--note <string>`.

## `guildhall resume <task-id>`

Append a follow-up message to an `exploring` task (continues the intake conversation).

Flags: `--workspace <id|path>`, `--message <string>`, `--resolve-escalation <id>`, `--resolution <string>`.

## `guildhall meta-intake`

Bootstrap coordinators by interviewing the agent about your codebase (FR-14). Writes a draft; does not modify `guildhall.yaml` until approved.

Flags: `--workspace <id|path>`, `--force` (re-run even if already bootstrapped).

## `guildhall approve-meta-intake`

Merge the meta-intake draft into `guildhall.yaml`.

Flags: `--workspace <id|path>`.

## Examples

```bash
guildhall init ~/projects/my-app
guildhall run my-app --domain ui
guildhall intake "add a ghost button" --workspace my-app --domain ui
guildhall approve-spec task-001 --workspace my-app
guildhall serve
```
