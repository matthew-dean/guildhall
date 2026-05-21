---
title: CLI
---

# CLI

The browser UI is the main way to use Guildhall. The CLI is the companion path
for service lifecycle, project registry work, and the kind of narrow debugging
session that is easier in a terminal than in the project shell.

Use the CLI when you want to:

- Start or stop a controlled runtime tick from a terminal.
- Start or stop the background local service, or reopen it on a specific path.
- Register, list, or unregister projects in the local service registry.
- Run setup without automatically opening a browser.
- Generate model bakeoff replay reports while comparing lane choices.

## Common workflows

```bash
# Open the browser UI for the current project
guildhall serve

# Run one controlled orchestrator tick
guildhall run --domain ui --max-ticks 1

# Register an existing project
guildhall register ~/projects/my-app

# Write a model bakeoff replay report
guildhall model-bakeoff
```

## Command reference

See the [CLI reference](./reference) for every command, flag, and example.

## Related docs

- [Quick start](../guide/quick-start) — browser-first setup and first task.
- [Running Guildhall](../guide/running) — browser run controls first, CLI run commands second.
- [Environment variables](../reference/env) — runtime configuration knobs.
- [Open model recommendations](../guide/open-models) — current tested open-model lanes and bakeoff approach.
