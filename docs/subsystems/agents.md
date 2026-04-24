---
title: Agents
help_topic: subsystem.agents
help_summary: |
  Five agent roles — spec, coordinator, worker, reviewer, gate-checker — each
  a stateful, tool-using conversation backed by the engine. Models are
  assigned per role in guildhall.yaml.
---

# Agents

Each agent is a `GuildhallAgent` wrapper around the [engine](./engine)'s `QueryEngine`, carrying message history, tool-carryover state, and an attached session for persistence.

**Source:** `src/agents/`

## Roles

| Role | Factory | Purpose |
|---|---|---|
| `spec` | `createSpecAgent()` | Interviews user during `exploring`. |
| `coordinator` | `createCoordinatorAgent()` | Per-domain promotion/rejection decisions. |
| `worker` | `createWorkerAgent()` | Builds code in `in_progress`. |
| `reviewer` | `createReviewerAgent()` | Evaluates work in `review`. |
| `gateChecker` | `createGateCheckerAgent()` | Runs deterministic checks + custom gates. |
| *persona reviewer* | `createPersonaReviewerAgent()` | Guild-specific review, fanned out at `review`. |

## Options

```ts
new GuildhallAgent({
  name: 'worker',
  llm: modelSet.worker,
  systemPrompt,
  tools,
  maxTurns: 40,
  maxTokens: 100_000,
  permissionChecker,
  skills,
  hookExecutor,
  compactor,
  sessionPersistence,
})
```

## Diff scope

`src/agents/diff-scope.ts` categorizes proposed changes as *critical*, *complex*, or *routine*. The coordinator uses this to decide whether to invoke extra reviewer personas. Critical diffs always fan out to all applicable guilds; routine diffs may short-circuit to a single reviewer.

## Warm resume

Every agent's conversation is snapshotted after each turn. When the orchestrator resumes a task, the agent is instantiated with `restoreSessionId` and continues from the snapshot. See [Sessions](./sessions).
