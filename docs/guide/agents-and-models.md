---
title: Agents & models
---

# Agents & models

Five agent roles exist, each backed by a different system prompt and tool set:

| Role | Responsibility | Typical model tier |
|---|---|---|
| `spec` | Interviews the user to refine tasks in `exploring`. | High — reasoning-heavy. |
| `coordinator` | Makes promotion/rejection decisions per domain. | High. |
| `worker` | Writes code, runs commands, ships diffs. | Mid-to-high — coding-specific. |
| `reviewer` | Evaluates completed work against spec + rubric. | Mid. |
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

Model IDs resolve against the catalog in `src/core/models.ts`.

## Cognitive profiles

Each role has a `CognitiveProfile` declaring what it needs from a model — context window, tool use, reasoning. The orchestrator uses these to validate model assignments at boot.

## Permission modes

Agents run under a [`PermissionMode`](../subsystems/engine#permission-modes):

- `plan` — no side effects; agents can read but not write.
- `default` — standard allow-list; destructive operations prompt.
- `full_auto` — unrestricted; use only in sandboxed worktrees.

`remediation_autonomy` and `worktree_isolation` interact with permission mode to decide how aggressively agents may self-recover.

## Persistence

Every agent conversation is snapshotted to `memory/sessions/` per project. You can resume any agent from its last snapshot — see [Sessions](../subsystems/sessions).
