---
title: Quick start
---

# Quick start

## Prerequisites

- Node.js ≥ 20
- `git` on your `PATH`
- One of: Claude Code CLI, Codex CLI, an OpenAI-compatible local server (for example llama.cpp or LM Studio), or an Anthropic-compatible / OpenAI-compatible API key

## Install

Recommended on macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/matthew-dean/guildhall/main/scripts/install.sh | sh
```

Also supported:

```bash
npm install -g guildhall
```

## Start Guildhall

```bash
guildhall serve
```

This starts the local Guildhall service if needed and opens the Projects view.

## Attach and initialize a project

From the Projects view, choose **Attach project** and pick an existing folder.

- If the folder already contains `guildhall.yaml`, Guildhall registers it and
  opens the project immediately.
- If it does not, Guildhall opens that folder in an uninitialized state and
  walks you through setup inside the project shell.

Setup writes a `guildhall.yaml` at the project root, creates `.guildhall/` for
project-local state, adds `.guildhall/` to the repo `.gitignore`, and walks
you through:

1. **Identity** — workspace name + slug
2. **Provider** — pick how you'll call LLMs (auto-detects installed CLIs)
3. **Launch** — trigger repo inspection so Guildhall can infer repo structure and draft starter tasks, or skip ahead and hand-edit YAML

Everything the wizard sets is editable later from the Settings page.

## Add a task and run

```bash
# Add a work item to the exploring queue
guildhall intake "add a ghost button variant" --domain ui

# Advance the spec once you're happy with it
guildhall approve-spec task-001

# Run the coordinator (blocks; Ctrl-C to stop)
guildhall run
```

Or just run `guildhall serve` and do everything from the dashboard.

## Where state lives

```
<workspace root>/
├─ guildhall.yaml                # workspace config (commit this)
├─ .gitignore                    # init adds .guildhall/ here
├─ .guildhall/config.yaml        # project-local Guildhall settings
└─ memory/
   ├─ TASKS.json                 # the work queue
   ├─ agent-settings.yaml        # every lever and its provenance
   ├─ sessions/                  # agent conversation snapshots
   └─ transcripts/               # per-task audit trail
```

## Next steps

- [Core concepts](./concepts) — vocabulary you'll need.
- [CLI reference](../reference/cli) — every command and flag.
- [`guildhall.yaml` reference](../reference/workspace-config) — every field.
- [Levers](../levers/) — every named knob, with a page per lever.
