---
title: Quick start
---

# Quick start

## Prerequisites

- Node.js ≥ 20
- `git` on your `PATH`
- One of: Claude Code CLI, Codex CLI, an OpenAI-compatible local server (for example llama.cpp or LM Studio), or an Anthropic-compatible / OpenAI-compatible API key

## Install and initialize

From inside the project you want the guild to work on:

```bash
npx guildhall init
```

`init` writes a `guildhall.yaml` at the workspace root, creates `.guildhall/` for local-only state, adds `.guildhall/` to the repo `.gitignore`, and pops open the dashboard at `http://localhost:7777/setup`. The wizard walks you through:

1. **Identity** — workspace name + slug
2. **Provider** — pick how you'll call LLMs (auto-detects installed CLIs)
3. **Launch** — either trigger the meta-intake (agent interviews you and drafts coordinators), or skip to the dashboard and hand-edit YAML

Everything the wizard sets is editable later from the Settings page.

## Add a task and run

```bash
# Add a work item to the exploring queue
guildhall intake "add a ghost button variant" --domain ui

# Advance the spec once you're happy with it
guildhall approve-spec task-001

# Run the orchestrator (blocks; Ctrl-C to stop)
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
