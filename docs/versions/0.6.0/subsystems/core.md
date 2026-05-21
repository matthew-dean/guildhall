---
title: Core
help_topic: subsystem.core
help_summary: |
  Shared data models — Task, Gate, Goal, DesignSystem, workspace — used by
  every other subsystem. This is the vocabulary layer; it has no runtime
  dependencies.
---

# Core

**Source:** `src/core/`

Core defines the shared data models — the vocabulary every other subsystem speaks.

## Task

```ts
interface Task {
  id: string
  title: string
  domain: string
  status: TaskStatus
  priority: TaskPriority
  permissionMode: TaskPermissionMode
  spec?: TaskSpec
  acceptanceCriteria?: string[]
  gates?: { hard: HardGate[]; soft: SoftGate[] }
  reviewVerdicts?: ReviewVerdict[]
  revisions: number
  createdAt: string
  updatedAt: string
}

type TaskStatus =
  | 'proposed' | 'exploring' | 'spec_review' | 'ready'
  | 'in_progress' | 'review' | 'gate_check'
  | 'done' | 'shelved' | 'blocked'
```

## Gates

```ts
interface HardGate {
  id: string
  command: string          // shell command or builtin (lint/typecheck/test/build)
  allowedExitCodes?: number[]
  timeoutSeconds?: number
}

interface SoftGate {
  id: string
  rubric: SoftGateRubricItem[]
  weight: number
}

interface SoftGateRubricItem {
  id: string
  question: string
  weight: number
}
```

Hard gates run in `gate_check`; soft gates are scored in `review`.

## Goal & Guardrail (business envelope)

```ts
interface Goal { id: string; description: string; priority: number }
interface Guardrail { id: string; description: string; trigger: string }
```

The envelope is declared in `memory/business-envelope.yaml`; `business_envelope_strictness` controls enforcement.

## DesignSystem

```ts
interface DesignSystem {
  tokens: Record<string, unknown>     // colors, spacing, type scale, etc.
  primitives: PrimitiveSpec[]
  a11y: AccessibilityBaseline
  copyVoice: CopyVoice
}
```

Surfaced to agents as a read-only context block; used by the Accessibility Specialist and Color Theorist guilds for deterministic checks.

## Agent role & model catalog

```ts
type AgentRole = 'spec' | 'coordinator' | 'worker' | 'reviewer' | 'gateChecker'

interface CognitiveProfile { contextTokens: number; toolUse: boolean; reasoning: 'low'|'mid'|'high' }

const ROLE_PROFILES: Record<AgentRole, CognitiveProfile>
```

## Workspace helpers

```ts
import { defineWorkspace } from 'guildhall/core'

export default defineWorkspace({
  name: 'my-project',
  coordinators: [/* ... */],
  models: { spec: 'claude-sonnet-4-6', worker: 'qwen2.5-coder-32b-instruct' },
})
```

`defineWorkspace()` gives you typed authoring for `guildhall.workspace.ts` if you prefer TypeScript over YAML.

## CoordinatorDomain & memory layout

- `CoordinatorDomain` — the shape stored under `coordinators:` in `guildhall.yaml`.
- `memory.ts` — canonical layout of the `memory/` directory (paths for `TASKS.json`, `agent-settings.yaml`, `sessions/`, `transcripts/`).
