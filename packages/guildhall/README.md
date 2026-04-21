# Guildhall

A general-purpose multi-agent operating system for software projects.

Guildhall runs a team of LLM agents (coordinators, spec writers, workers, reviewers, gate-checkers) against a project directory. It reads and writes `guildhall.yaml`, keeps a persistent memory directory, and exposes a local web dashboard you can steer the agents from.

## Quick start

```bash
# In the project you want agents to work on:
npx guildhall init

# Or install it as a dependency:
npm install guildhall
npx guildhall init
```

`guildhall init` writes `guildhall.yaml` and launches a dashboard at <http://localhost:7842/setup> that walks you through:

1. **Identity** — workspace name + slug
2. **Provider** — Claude (via Claude Code CLI), Codex (via Codex CLI), local `llama.cpp` / LM Studio, or paste-in Anthropic / OpenAI API key
3. **Launch** — either start the agent-guided bootstrap (the meta-intake agent interviews you about the codebase and drafts coordinators), or skip to the dashboard and edit `guildhall.yaml` by hand

Everything the wizard sets is editable later from the Settings page in the dashboard.

## What it writes

- `guildhall.yaml` — workspace config (coordinators, model assignments, ignore patterns); safe to commit
- `.guildhall/config.yaml` — project-local runtime state (preferred provider, API keys); auto-gitignored (`0600` perms)
- `memory/` — persistent orchestrator state (tasks, progress logs, transcripts, skills); safe to commit

## Commands

```
guildhall init [path]              Launch dashboard + browser-based setup wizard
guildhall serve [path]             Start only the dashboard (project must already be initialized)
guildhall run   [id|path]          Run the orchestrator headlessly
guildhall intake "<ask>" --domain  Create a new task from the CLI
```

Run `guildhall help` for the full list.

## Provider setup

Guildhall never stores credentials it didn't need to. Preferred order:

| Provider | How it's picked up |
| --- | --- |
| Claude Pro/Max | Piggybacks on `~/.claude/.credentials.json` (installed by Claude Code CLI) |
| Codex | Piggybacks on `~/.codex/auth.json` (installed by Codex CLI) |
| Local `llama.cpp` / LM Studio | Probes your configured base URL (default: `http://localhost:1234/v1`) |
| Anthropic API | `$ANTHROPIC_API_KEY` or pasted into the wizard (stored in `.guildhall/config.yaml`) |
| OpenAI API | `$OPENAI_API_KEY` or pasted into the wizard |

## One project per install

Guildhall is designed to live inside `node_modules/` of a single project — version isolation comes from your existing `package.json` / lockfile, the same way ESLint or Vitest are pinned. Cross-project aggregation is a separate tool (guild-pro).

## License

[Fair Labor License (FLL) v1.2](./LICENSE). Free for individuals and organizations that compensate their workers fairly; paid commercial license required otherwise. Evaluation use is free for 90 days.
