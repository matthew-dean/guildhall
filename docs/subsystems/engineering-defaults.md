---
title: Engineering defaults
help_topic: subsystem.engineering_defaults
help_summary: |
  Best-practice guidelines (coding, testing, frontend, git, security, deps,
  architecture, documentation, review) auto-injected into every agent's
  system prompt. Override per-project by shadowing files under
  memory/engineering-defaults/.
---

# Engineering defaults

**Source:** `src/engineering-defaults/`

Every agent boot appends a block of best-practice guidance to the system prompt. The content is a set of short markdown files — one per topic — that ship with GuildHall and can be shadowed per-project.

## Topics

```ts
type EngineeringDefaultTopic =
  | 'coding'
  | 'testing'
  | 'frontend'
  | 'git'
  | 'security'
  | 'dependencies'
  | 'architecture'
  | 'documentation'
  | 'review'
```

Each topic is a standalone `.md` file under `src/engineering-defaults/`.

## Public API

```ts
import {
  loadEngineeringDefaults,
  composeSystemPromptWithDefaults,
} from 'guildhall/engineering-defaults'

const defaults = await loadEngineeringDefaults(workspace)
const fullPrompt = composeSystemPromptWithDefaults(baseSystemPrompt, defaults)
```

The composer keeps the base prompt first and appends a `## Engineering defaults` section with each topic under its own subheading.

## Overriding per project

Drop a file at `memory/engineering-defaults/<topic>.md` to shadow the built-in version. Example — to tighten `testing.md` for your project, write a new one at `memory/engineering-defaults/testing.md` and it'll replace the bundled file.

## Why this is separate from skills

Skills are opt-in (agents load them when they want them). Engineering defaults are always-on. A skill teaches *how* to do a specific procedure; defaults set the baseline the agent carries into every procedure.
