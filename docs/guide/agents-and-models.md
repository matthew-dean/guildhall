---
title: Agents & models
---

# Agents & models

Six model roles exist, each backed by a different system prompt, tool set, or
runtime lane.
The construction model is the simplest way to understand the split: one role
drafts the blueprint, one keeps the job coherent, one performs trade work, one
inspects, one enforces deterministic checks, and one enriches project context.

| Role | Responsibility | Typical model tier |
|---|---|---|
| `spec` | Surveys missing context and drafts the task blueprint in `exploring`. | High — reasoning-heavy. |
| `coordinator` | Keeps the project/domain plan coherent and makes promotion/rejection decisions. | High. |
| `worker` | Performs bounded trade work against the accepted blueprint. | Mid-to-high — coding-specific. |
| `reviewer` | Inspects completed work against the blueprint + rubric. | Mid. |
| `gateChecker` | Runs deterministic checks and custom gates. | Low — mostly shell/parse. |
| `contextIndexer` | Summarizes code purpose, contracts, canonical abstractions, and read-next guidance for the Corpus Map. | Mid — code-aware, structured, fast enough for repeated indexing. |

## Assigning models

```yaml
models:
  spec: deepseek-ai/DeepSeek-V4-Flash
  coordinator: deepseek-ai/DeepSeek-V4-Flash
  worker: Qwen/Qwen3-235B-A22B-Instruct-2507
  reviewer: deepseek-ai/DeepSeek-V4-Flash
  gateChecker: deepseek-ai/DeepSeek-V4-Flash
  contextIndexer: zai-org/GLM-4.6
```

Model IDs resolve against Guildhall's bundled model catalog.

Guildhall's public open-model recommendations live in
[Open model recommendations](./open-models). Those notes are based on saved
development replay prompts and treated as a starting point, not a
permanent ranking.

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
