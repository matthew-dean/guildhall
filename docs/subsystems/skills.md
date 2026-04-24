---
title: Skills
help_topic: subsystem.skills
help_summary: |
  Skills are reusable instruction sets (markdown + YAML frontmatter) agents
  can load at will. They teach procedures without baking them into system
  prompts.
---

# Skills

**Source:** `src/skills/`

A skill is a markdown document with YAML frontmatter describing a reusable procedure — "how to write a changelog entry", "how to convert a fixture to a factory", etc. Agents discover skills via the `skill_tool` and load them on demand.

## Skill format

```markdown
---
name: write-changelog
description: Compose a user-facing changelog entry from a merged PR.
trigger_patterns:
  - "PR merged to main"
---

# Write changelog

1. Read `CHANGELOG.md`.
2. Determine the unreleased section...
```

## Loading

- **Bundled skills** — shipped in `src/skills/bundled/` and loaded by `loadBundledSkills()`.
- **User skills** — placed under `memory/skills/*.md` (or `<workspace>/skills/*.md`) and loaded by the file-based loader.

## Registry

```ts
import { SkillRegistry, loadBundledSkills } from 'guildhall/skills'

const registry = new SkillRegistry()
registry.registerAll(await loadBundledSkills())
```

Registries are keyed by `name` (from frontmatter) so later registrations can override earlier ones.

## Invoking from an agent

The agent calls `skill_tool.list()` to see what's available and `skill_tool.invoke(name, args)` to append the skill content to its context. Invocation is recorded in `tool_metadata.invoked_skills` so the same skill isn't re-loaded every turn.
