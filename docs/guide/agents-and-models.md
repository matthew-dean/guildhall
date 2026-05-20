---
title: Agents & models
---

# Agents & models

Five agent roles exist, each backed by a different system prompt and tool set.
The construction model is the simplest way to understand the split: one role
drafts the blueprint, one keeps the job coherent, one performs trade work, one
inspects, and one enforces deterministic checks.

| Role | Responsibility | Typical model tier |
|---|---|---|
| `spec` | Surveys missing context and drafts the task blueprint in `exploring`. | High — reasoning-heavy. |
| `coordinator` | Keeps the project/domain plan coherent and makes promotion/rejection decisions. | High. |
| `worker` | Performs bounded trade work against the accepted blueprint. | Mid-to-high — coding-specific. |
| `reviewer` | Inspects completed work against the blueprint + rubric. | Mid. |
| `gateChecker` | Runs deterministic checks and custom gates. | Low — mostly shell/parse. |

## Assigning models

```yaml
models:
  spec: claude-sonnet-4-6
  coordinator: claude-sonnet-4-6
  worker: qwen2.5-coder-32b-instruct
  reviewer: qwen2.5-coder-14b-instruct
  gateChecker: qwen2.5-coder-7b-instruct
```

Model IDs resolve against Guildhall's bundled model catalog.

## Cognitive profiles

Each role has a `CognitiveProfile` declaring what it needs from a model — context window, tool use, reasoning. The coordinator uses these to validate model assignments at boot.

## Permission modes

Agents run under a permission mode:

- `plan` — no side effects; agents can read but not write.
- `default` — standard allow-list; destructive operations prompt.
- `full_auto` — unrestricted; use only in sandboxed worktrees.

`remediation_autonomy` and `worktree_isolation` interact with permission mode to decide how aggressively agents may self-recover.

## Persistence

Every agent conversation is snapshotted to `memory/sessions/` per project. You can resume any agent from its last snapshot.
