# Context Cost Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut repeated Guildhall LLM input spend by budgeting injected context, replacing stable repeated blocks with references/digests, and preventing broad state reads when task-scoped evidence exists.

**Architecture:** Add a small context-budget layer between raw context sources and `buildContext` output. The builder should assemble candidate sections, split stable cacheable prefixes from dynamic task deltas, apply role/status budgets, emit auditable omission/compression reasons, and ensure session history never keeps paying for stale full-context packets. DeepInfra prompt caching should be treated as a first-class provider feature: stable prefix content must be byte-stable and first in the prompt, requests should carry a session-scoped cache key when supported, and usage telemetry should record cached input tokens. Tool policy should steer agents toward task-scoped reads and corpus-map-guided verification instead of whole-queue or broad rediscovery reads.

**Tech Stack:** TypeScript, Vitest, existing `src/runtime/context-builder.ts`, `src/runtime/context-observability.ts`, orchestrator/session persistence, and web/runtime tool policy tests.

---

## Files

- Create: `src/runtime/context-budget.ts` — pure budget policy, section classification, stable-section hashing, compression/omission helpers.
- Create: `src/runtime/prompt-cache.ts` — provider-neutral prompt-cache key generation, cacheable-prefix assembly, and cached-token usage extraction.
- Create: `src/runtime/__tests__/context-budget.test.ts` — focused unit tests for budget decisions.
- Create: `src/runtime/__tests__/prompt-cache.test.ts` — focused tests for cache key stability, prefix ordering, and usage parsing.
- Modify: `src/runtime/context-builder.ts` — build named candidate sections, apply role/status budget, expose stable-section refs and section decisions.
- Modify: `src/runtime/context-observability.ts` — record budget, omitted/compressed sections, stable refs, and regression warnings as structured audit data.
- Modify: `src/providers/openai-client.ts` — pass supported cache keys to OpenAI-compatible providers and propagate `prompt_tokens_details.cached_tokens` in usage telemetry.
- Modify: `src/providers/__tests__/openai-client.test.ts` — prove `prompt_cache_key` is sent and cached-token details are preserved.
- Modify: `src/runtime/__tests__/context-builder.test.ts` — regression tests for worker, reviewer, gate, spec context sizes and section behavior.
- Modify: `src/runtime/orchestrator.ts` or the agent session construction seam where context is appended — compact/replace prior injected-context messages rather than accumulating full context packets.
- Modify: relevant orchestrator/session tests in `src/runtime/__tests__/orchestrator.test.ts` — prove repeated turns do not retain old full context.
- Modify: tool schema/policy files that expose `read-tasks` / task queue reads to agents, likely under `src/tools/` and agent tool assembly in `src/runtime/orchestrator.ts`.
- Modify: tool tests under `src/tools/__tests__/` and/or orchestrator tests — prove reviewer/gate use task-scoped state and broad reads are blocked or discouraged.
- Modify: `internal/audits/flow-audit.md` — record the final verified fix and measured before/after evidence.

---

### Task 1: Add Pure Context Budget Policy

**Files:**
- Create: `src/runtime/context-budget.ts`
- Create: `src/runtime/__tests__/context-budget.test.ts`

- [ ] **Step 1: Write failing tests for role budgets**

Add tests that define the intended budgets before implementation:

```ts
import { describe, expect, it } from 'vitest'
import { applyContextBudget } from '../context-budget.js'

describe('applyContextBudget', () => {
  it('keeps worker context under the default worker budget by compressing stable sections first', () => {
    const result = applyContextBudget({
      agentRole: 'worker',
      taskStatus: 'in_progress',
      sections: [
        { key: 'taskSummary', label: 'Task summary', text: 'task '.repeat(3000), stability: 'task-delta', priority: 100 },
        { key: 'personaPrompt', label: 'Persona prompt', text: 'persona '.repeat(2000), stability: 'stable', priority: 30 },
        { key: 'reviewRubrics', label: 'Review rubrics', text: 'rubric '.repeat(1500), stability: 'stable', priority: 25 },
        { key: 'corpusMap', label: 'Corpus map', text: 'src/web/lib/Button.svelte: use this\n'.repeat(300), stability: 'semi-stable', priority: 60 },
        { key: 'recentProgress', label: 'Recent progress', text: 'progress '.repeat(2000), stability: 'rolling', priority: 70 },
      ],
    })

    expect(result.formatted.length).toBeLessThanOrEqual(12_000)
    expect(result.decisions.some(d => d.key === 'personaPrompt' && d.action === 'reference')).toBe(true)
    expect(result.decisions.some(d => d.key === 'reviewRubrics' && d.action === 'reference')).toBe(true)
    expect(result.formatted).toContain('Context reference: personaPrompt')
  })

  it('gives reviewers review evidence over broad recent history', () => {
    const result = applyContextBudget({
      agentRole: 'reviewer',
      taskStatus: 'review',
      sections: [
        { key: 'taskSummary', label: 'Task summary', text: 'task '.repeat(1500), stability: 'task-delta', priority: 100 },
        { key: 'reviewPacket', label: 'Review packet', text: 'packet '.repeat(2000), stability: 'task-delta', priority: 95 },
        { key: 'recentProgress', label: 'Recent progress', text: 'progress '.repeat(4000), stability: 'rolling', priority: 20 },
        { key: 'corpusMap', label: 'Corpus map', text: 'map '.repeat(2000), stability: 'semi-stable', priority: 15 },
      ],
    })

    expect(result.formatted.length).toBeLessThanOrEqual(10_000)
    expect(result.formatted).toContain('## Review packet')
    expect(result.decisions.find(d => d.key === 'recentProgress')?.action).not.toBe('include-full')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-budget.test.ts --reporter=dot
```

Expected: fail because `src/runtime/context-budget.ts` does not exist.

- [ ] **Step 3: Implement minimal budget policy**

Create `src/runtime/context-budget.ts` with:

```ts
import { createHash } from 'node:crypto'

export type ContextSectionStability = 'stable' | 'semi-stable' | 'rolling' | 'task-delta'
export type ContextBudgetAction = 'include-full' | 'clip' | 'reference' | 'omit'

export interface ContextBudgetSection {
  key: string
  label: string
  text: string
  stability: ContextSectionStability
  priority: number
}

export interface ContextBudgetInput {
  agentRole: string
  taskStatus: string
  sections: ContextBudgetSection[]
}

export interface ContextBudgetDecision {
  key: string
  label: string
  originalChars: number
  finalChars: number
  action: ContextBudgetAction
  reason: string
  hash?: string
}

export interface ContextBudgetResult {
  formatted: string
  maxChars: number
  decisions: ContextBudgetDecision[]
}

const ROLE_BUDGETS: Record<string, number> = {
  worker: 12_000,
  reviewer: 10_000,
  gateChecker: 6_000,
  spec: 10_000,
  coordinator: 8_000,
}

export function contextBudgetForRole(agentRole: string): number {
  return ROLE_BUDGETS[agentRole] ?? 10_000
}

export function stableContextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export function applyContextBudget(input: ContextBudgetInput): ContextBudgetResult {
  const maxChars = contextBudgetForRole(input.agentRole)
  const ordered = [...input.sections].sort((a, b) => b.priority - a.priority)
  const decisions: ContextBudgetDecision[] = []
  const rendered: string[] = []
  let used = 0

  for (const section of ordered) {
    const trimmed = section.text.trim()
    if (!trimmed) continue

    const full = `## ${section.label}\n${trimmed}`
    const remaining = maxChars - used
    if (full.length <= remaining) {
      rendered.push(full)
      used += full.length + 2
      decisions.push({
        key: section.key,
        label: section.label,
        originalChars: section.text.length,
        finalChars: full.length,
        action: 'include-full',
        reason: 'fits within role budget',
      })
      continue
    }

    if (section.stability === 'stable' || section.stability === 'semi-stable') {
      const hash = stableContextHash(trimmed)
      const ref = `## ${section.label}\nContext reference: ${section.key}#${hash}. Reuse the prior stable context unless task evidence says it changed.`
      if (ref.length <= Math.max(0, remaining)) {
        rendered.push(ref)
        used += ref.length + 2
      }
      decisions.push({
        key: section.key,
        label: section.label,
        originalChars: section.text.length,
        finalChars: ref.length <= Math.max(0, remaining) ? ref.length : 0,
        action: 'reference',
        reason: 'stable context exceeded remaining budget',
        hash,
      })
      continue
    }

    const clipRoom = Math.max(0, remaining - `## ${section.label}\n`.length - 80)
    if (clipRoom > 400) {
      const clipped = `## ${section.label}\n${trimmed.slice(-clipRoom)}\n[Earlier ${section.label} omitted by context budget.]`
      rendered.push(clipped)
      used += clipped.length + 2
      decisions.push({
        key: section.key,
        label: section.label,
        originalChars: section.text.length,
        finalChars: clipped.length,
        action: 'clip',
        reason: 'rolling context clipped to fit role budget',
      })
    } else {
      decisions.push({
        key: section.key,
        label: section.label,
        originalChars: section.text.length,
        finalChars: 0,
        action: 'omit',
        reason: 'section did not fit remaining budget',
      })
    }
  }

  return { formatted: rendered.join('\n\n').trim(), maxChars, decisions }
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-budget.test.ts --reporter=dot
```

Expected: pass.

---

### Task 2: Apply Budgets in `buildContext`

**Files:**
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/__tests__/context-builder.test.ts`

- [ ] **Step 1: Write failing context-builder regression tests**

Add tests that build a real `BuiltContext` with oversized sections and assert:

```ts
expect(ctx.formatted.length).toBeLessThanOrEqual(12_500)
expect(ctx.formatted).toContain('Context reference: personaPrompt')
expect(ctx.formatted).not.toContain('progress line 1')
expect(ctx.formatted).toContain('progress line 120')
```

Add a reviewer-specific test:

```ts
expect(ctx.formatted.length).toBeLessThanOrEqual(10_500)
expect(ctx.formatted).toContain('## Review Packet')
expect(ctx.formatted).not.toContain('## Corpus Map\n' + giantCorpusMapText)
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-builder.test.ts -t "context budget|reviewer context budget" --reporter=dot
```

Expected: fail because `buildContext` currently concatenates all non-empty sections directly.

- [ ] **Step 3: Replace direct concatenation with budgeted sections**

In [src/runtime/context-builder.ts](/Users/matthew/git/oss/guildhall/src/runtime/context-builder.ts), replace the final `formatted = [...]` assembly with candidate sections passed through `applyContextBudget`.

Use this classification:

```ts
const budgeted = applyContextBudget({
  agentRole: roleForTaskStatus(task.status),
  taskStatus: task.status,
  sections: [
    { key: 'taskSummary', label: 'Current Task', text: taskSummary, stability: 'task-delta', priority: 100 },
    { key: 'reviewPacket', label: 'Review Packet', text: reviewPacket, stability: 'task-delta', priority: task.status === 'review' || task.status === 'gate_check' ? 95 : 0 },
    { key: 'workerModePrompt', label: 'Worker Mode', text: workerModePrompt, stability: 'stable', priority: 85 },
    { key: 'languageMap', label: 'Language Map', text: languageMap, stability: 'semi-stable', priority: 80 },
    { key: 'corpusMap', label: 'Corpus Map', text: corpusMap, stability: 'semi-stable', priority: task.status === 'in_progress' ? 75 : 25 },
    { key: 'projectMemory', label: 'Relevant Project Memory', text: projectMemory, stability: 'semi-stable', priority: 70 },
    { key: 'recentProgress', label: 'Recent Progress', text: recentProgress, stability: 'rolling', priority: 65 },
    { key: 'recentDecisions', label: `Recent Decisions (${task.domain})`, text: recentDecisions, stability: 'rolling', priority: 55 },
    { key: 'personaPrompt', label: 'Persona Prompt', text: personaPrompt, stability: 'stable', priority: 45 },
    { key: 'reviewRubrics', label: 'Review Rubrics (selected for this task)', text: reviewRubrics, stability: 'stable', priority: task.status === 'review' ? 60 : 35 },
    { key: 'designSystem', label: 'Design System', text: designSystem, stability: 'stable', priority: 30 },
    { key: 'exploringTranscript', label: 'Exploring Transcript (tail)', text: exploringTranscript, stability: 'rolling', priority: task.status === 'exploring' ? 85 : 0 },
    { key: 'envelope', label: 'Business Envelope (FR-23)', text: envelope, stability: 'semi-stable', priority: 50 },
  ],
})

const formatted = [
  '<!-- FORGE CONTEXT: injected just-in-time, do not modify -->',
  budgeted.formatted,
  '<!-- END FORGE CONTEXT -->',
].filter(Boolean).join('\n\n').trim()
```

Return `contextBudget: budgeted` from `BuiltContext` so observability can record it.

- [ ] **Step 4: Run context-builder tests**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-builder.test.ts --reporter=dot
```

Expected: pass after updating assertions that assumed full sections always appear.

---

### Task 3: Replace Raw Recent Progress Tail With Task-Scoped Digest

**Files:**
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/__tests__/context-builder.test.ts`

- [ ] **Step 1: Write failing test**

Add a test where `PROGRESS.md` contains 120 lines across unrelated tasks and only 6 lines reference the active task/domain:

```ts
expect(ctx.recentProgress).toContain('task-006 fixed dashboard card')
expect(ctx.recentProgress).toContain('frontend review handoff')
expect(ctx.recentProgress).not.toContain('unrelated task-001')
expect(ctx.recentProgress.length).toBeLessThan(1_500)
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-builder.test.ts -t "task-scoped progress digest" --reporter=dot
```

Expected: fail because `extractRecentProgress` currently returns the last 60 lines.

- [ ] **Step 3: Implement `extractTaskScopedProgress`**

Replace `extractRecentProgress(progress)` with:

```ts
function extractTaskScopedProgress(progress: string, task: Task): string {
  const lines = progress.trimEnd().split('\n').filter(Boolean)
  const needles = [
    task.id.toLowerCase(),
    task.domain.toLowerCase(),
    ...task.title.toLowerCase().split(/\s+/).filter((word) => word.length >= 5),
  ]
  const relevant = lines.filter((line) => {
    const lower = line.toLowerCase()
    return needles.some((needle) => lower.includes(needle))
  })
  const selected = relevant.length > 0 ? relevant : lines.slice(-12)
  return selected.slice(-20).join('\n').slice(-1_500)
}
```

Use `extractTaskScopedProgress(progress, task)` inside `buildContext`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-builder.test.ts --reporter=dot
```

Expected: pass.

---

### Task 4: Make Corpus Map Single-Use Per Target Set

**Files:**
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/__tests__/context-builder.test.ts`

- [ ] **Step 1: Write failing tests**

Create one test for a fresh worker pass and one resumed pass with a checkpoint:

```ts
expect(fresh.corpusMap).toContain('## Corpus Map')
expect(resumed.corpusMap).not.toContain('## Corpus Map')
expect(resumed.taskSummary).toContain('### Likely Target Files')
expect(resumed.formatted).toContain('Context reference: corpusMap')
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-builder.test.ts -t "corpus map single-use" --reporter=dot
```

Expected: fail because corpus map is included whenever `codebaseMap` exists.

- [ ] **Step 3: Implement target-set gating**

Add:

```ts
function shouldIncludeFullCorpusMap(task: Task, checkpoint: Checkpoint | null): boolean {
  if (task.status !== 'in_progress') return false
  if (!checkpoint) return true
  if (checkpoint.filesTouched.length === 0) return true
  return false
}
```

When false, do not inject full `corpusMap`; inject only a reference plus likely target files and checkpoint files.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-builder.test.ts --reporter=dot
```

Expected: pass.

---

### Task 5: Add DeepInfra Prompt-Cache Support And Stable Prefix Ordering

**Files:**
- Create: `src/runtime/prompt-cache.ts`
- Create: `src/runtime/__tests__/prompt-cache.test.ts`
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/providers/openai-client.ts`
- Modify: `src/providers/__tests__/openai-client.test.ts`
- Modify: `src/runtime/context-observability.ts`

- [x] **Step 1: Write failing prompt-cache tests**

Add tests for stable cache keys and prefix placement:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildPromptCacheKey,
  splitCacheableContextPrefix,
  cachedPromptTokens,
} from '../prompt-cache.js'

describe('prompt-cache helpers', () => {
  it('uses a stable per-project-role-task-session cache key without timestamps', () => {
    expect(buildPromptCacheKey({
      provider: 'openai-api',
      projectId: 'fair-labor-license',
      taskId: 'task-006',
      agentRole: 'worker',
      sessionId: 'session-a',
    })).toBe('openai-api:fair-labor-license:task-006:worker:session-a')
  })

  it('keeps stable cacheable prefix before dynamic task deltas', () => {
    const split = splitCacheableContextPrefix([
      { key: 'system', text: 'stable system', cacheability: 'cacheable' },
      { key: 'personaPrompt', text: 'stable persona', cacheability: 'cacheable' },
      { key: 'taskSummary', text: 'dynamic task', cacheability: 'dynamic' },
      { key: 'recentProgress', text: 'rolling progress', cacheability: 'dynamic' },
    ])

    expect(split.formatted).toMatch(/^stable system\n\nstable persona\n\ndynamic task\n\nrolling progress$/)
    expect(split.cacheablePrefixChars).toBe('stable system\n\nstable persona'.length)
  })

  it('extracts cached prompt tokens from DeepInfra-compatible usage details', () => {
    expect(cachedPromptTokens({
      prompt_tokens: 5000,
      prompt_tokens_details: { cached_tokens: 4800 },
    })).toBe(4800)
  })
})
```

- [x] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/prompt-cache.test.ts --reporter=dot
```

Expected: fail because `prompt-cache.ts` does not exist.

Observed on 2026-05-25: failed because `../prompt-cache.js` could not be
resolved.

- [x] **Step 3: Implement prompt-cache helpers**

Create `src/runtime/prompt-cache.ts`:

```ts
export type PromptCacheability = 'cacheable' | 'dynamic'

export interface PromptCacheKeyInput {
  provider: string
  projectId: string
  taskId: string
  agentRole: string
  sessionId: string
}

export interface PromptCacheSection {
  key: string
  text: string
  cacheability: PromptCacheability
}

export function buildPromptCacheKey(input: PromptCacheKeyInput): string {
  return [
    input.provider,
    input.projectId,
    input.taskId,
    input.agentRole,
    input.sessionId,
  ].map(cacheKeyPart).join(':')
}

export function splitCacheableContextPrefix(sections: PromptCacheSection[]): {
  formatted: string
  cacheablePrefixChars: number
} {
  const cacheable = sections.filter((section) => section.cacheability === 'cacheable' && section.text.trim())
  const dynamic = sections.filter((section) => section.cacheability === 'dynamic' && section.text.trim())
  const prefix = cacheable.map((section) => section.text.trim()).join('\n\n')
  const suffix = dynamic.map((section) => section.text.trim()).join('\n\n')
  return {
    formatted: [prefix, suffix].filter(Boolean).join('\n\n'),
    cacheablePrefixChars: prefix.length,
  }
}

export function cachedPromptTokens(usage: unknown): number {
  const details = (usage as { prompt_tokens_details?: { cached_tokens?: unknown } } | null)?.prompt_tokens_details
  return typeof details?.cached_tokens === 'number' ? details.cached_tokens : 0
}

function cacheKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
}
```

- [x] **Step 4: Add OpenAI-compatible `prompt_cache_key` support**

Extend `ApiMessageRequest` if needed to carry an optional `prompt_cache_key` or provider options object. In `src/providers/openai-client.ts`, add it to the request body only when present:

```ts
if (request.prompt_cache_key) {
  body.prompt_cache_key = request.prompt_cache_key
}
```

Add a test in `src/providers/__tests__/openai-client.test.ts`:

```ts
it('passes prompt_cache_key through to OpenAI-compatible providers', async () => {
  let requestBody: Record<string, unknown> | null = null
  const fakeFetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body))
    return sseResponse([
      dataFrame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ])
  }) as unknown as typeof fetch

  const client = new OpenAICompatibleClient({ fetch: fakeFetch })
  await collect(client.streamMessage({
    model: 'm',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    max_tokens: 8,
    tools: [],
    prompt_cache_key: 'openai-api:fll:task-006:worker:s1',
  }))

  expect(requestBody?.prompt_cache_key).toBe('openai-api:fll:task-006:worker:s1')
})
```

Implementation note: OpenAI-compatible requests now carry `prompt_cache_key`
when the orchestrator has supplied one. If a strict local/OpenAI-compatible
server rejects the field as an unknown parameter, the client retries the same
request once without the key so optimistic cache support does not break local
providers.

- [x] **Step 5: Preserve cached-token usage telemetry**

Update usage parsing so DeepInfra's `usage.prompt_tokens_details.cached_tokens` survives into Guildhall usage telemetry. Add a provider test with an SSE usage frame:

```ts
expect(usage.promptTokensDetails?.cachedTokens).toBe(4800)
```

If the protocol type does not currently have this field, add an optional field instead of overloading prompt token counts.

Implemented as optional `cached_input_tokens` on usage snapshots. DeepInfra-
compatible `usage.prompt_tokens_details.cached_tokens` is preserved by the
OpenAI-compatible SSE parser and accumulated by the query engine.

- [x] **Step 5a: Set deterministic cache keys at orchestration time**

The orchestrator now calls an optional `setPromptCacheKey()` hook before each
agent turn. The key format is:

```text
<provider>:<workspaceId>:<taskId>:<agentRole>:<workspaceId>-<agentRole>
```

This keeps keys stable across turns for the same provider/workspace/task/role
while avoiding timestamps or run-specific counters. The `GuildhallAgent` hook
passes the key through `QueryEngine` and `runQuery` into the provider request.

- [ ] **Step 6: Modify `buildContext` ordering for cache hits**

When applying budgeted sections, order cacheable stable sections first and keep them byte-stable:

1. system/agent stable instructions if they are in the message body
2. stable persona prompt
3. stable rubrics
4. stable corpus-map reference or full corpus map when still needed
5. dynamic task summary
6. checkpoint/worktree/revision deltas
7. recent progress/decisions/transcript

Do not include timestamps, task-updated times, random ordering, or run-specific paths inside the cacheable prefix unless they are unavoidable. If a section contains run-specific dynamic data, mark it `dynamic` even if its label sounds stable.

- [ ] **Step 7: Record cacheability and cache hits in context observability**

Extend context-debug records with:

```ts
promptCache?: {
  key: string
  cacheablePrefixChars: number
  cachedInputTokens?: number
}
```

Regression assertion:

```ts
expect(record.promptCache?.cacheablePrefixChars).toBeGreaterThan(1000)
expect(record.promptCache?.key).toContain('task-006:worker')
```

- [ ] **Step 8: Run prompt-cache tests**

Run:

```bash
pnpm exec vitest run \
  src/runtime/__tests__/prompt-cache.test.ts \
  src/providers/__tests__/openai-client.test.ts \
  src/runtime/__tests__/context-builder.test.ts \
  src/runtime/__tests__/context-observability.test.ts \
  --reporter=dot
```

Expected: pass.

---

### Task 6: Compact Prior Injected Context In Agent Sessions

**Files:**
- Modify: `src/runtime/orchestrator.ts` or the session-message helper used before `agent.generate`.
- Modify: `src/runtime/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Write failing regression test**

Create a test with two worker ticks on the same task. The fake agent should capture received message text lengths.

Assert:

```ts
expect(secondPrompt).not.toContain('old unique giant context marker')
expect(secondPrompt).toContain('Previous Guildhall context replaced')
expect(secondPrompt.length).toBeLessThan(firstPrompt.length + 2_000)
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/orchestrator.test.ts -t "compacts prior injected context" --reporter=dot
```

Expected: fail because prior full context remains in session history.

- [ ] **Step 3: Implement context replacement**

Before appending the new context message, scan prior conversation messages for:

```text
<!-- FORGE CONTEXT: injected just-in-time, do not modify -->
```

Replace each old dynamic context body with:

```md
<!-- FORGE CONTEXT REPLACED -->
Previous Guildhall context replaced by a newer task-scoped context packet.
Retained reference: <hash>
<!-- END FORGE CONTEXT REPLACED -->
```

Keep the most recent non-context assistant/tool messages intact.

Do not remove or reorder the current request's stable cacheable prefix. DeepInfra prompt caching matches repeated content at the beginning of the prompt, and the docs note that even a small prefix change can invalidate the cache. Session compaction should remove stale dynamic packets from conversation history while preserving a byte-stable prefix for the current request.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/orchestrator.test.ts -t "compacts prior injected context|provider capacity|turn limit" --reporter=dot
```

Expected: pass, including provider-capacity and turn-limit regression tests.

---

### Task 7: Replace Broad Task Reads With Task-Scoped Reads

**Files:**
- Modify: `src/tools/task-queue.ts`
- Modify: `src/tools/__tests__/task-queue.test.ts`
- Modify: tool assembly in `src/runtime/orchestrator.ts` if needed.

- [ ] **Step 1: Write failing tests**

Add tests that reviewer/gate tool metadata either does not expose broad `read-tasks`, or returns a compact task-scoped packet when given `taskId`.

```ts
expect(toolNamesForReviewer).not.toContain('read-tasks')
expect(toolNamesForReviewer).toContain('read-current-task')
```

For the tool output:

```ts
expect(output.length).toBeLessThan(20_000)
expect(output).toContain('"id": "task-006"')
expect(output).not.toContain('"id": "unrelated-task"')
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run src/tools/__tests__/task-queue.test.ts src/runtime/__tests__/orchestrator.test.ts -t "read-current-task|read-tasks" --reporter=dot
```

Expected: fail where broad `read-tasks` is still available or returns full queues.

- [ ] **Step 3: Implement task-scoped read**

Add `read-current-task` with required `taskId`, returning only:

```ts
{
  id,
  title,
  status,
  assignedTo,
  spec,
  acceptanceCriteria,
  latestNotes: notes.slice(-8),
  latestCheckpoint,
  reviewPacketPath,
}
```

For reviewer/gate agents, remove or hide `read-tasks` unless a diagnostic/debug mode is explicitly enabled.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run src/tools/__tests__/task-queue.test.ts src/runtime/__tests__/orchestrator.test.ts --reporter=dot
```

Expected: pass.

---

### Task 8: Upgrade Context Observability From Passive Warnings To Regression Gates

**Files:**
- Modify: `src/runtime/context-observability.ts`
- Modify: `src/runtime/__tests__/context-observability.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests asserting records include:

```ts
expect(record.budget.maxChars).toBe(12_000)
expect(record.budget.finalChars).toBeLessThanOrEqual(12_000)
expect(record.budget.decisions).toContainEqual(expect.objectContaining({
  key: 'personaPrompt',
  action: 'reference',
}))
expect(record.health).not.toContainEqual(expect.objectContaining({ code: 'context_too_large' }))
expect(record.promptCache?.cacheablePrefixChars).toBeGreaterThan(0)
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-observability.test.ts --reporter=dot
```

Expected: fail because budget metadata is not yet recorded.

- [ ] **Step 3: Record budget details**

Extend `ContextDebugRecord`:

```ts
budget?: {
  maxChars: number
  finalChars: number
  decisions: Array<{
    key: string
    action: string
    originalChars: number
    finalChars: number
    reason: string
    hash?: string
  }>
}
```

Add a health check that emits `context_budget_exceeded` as an error if `ctx.formatted.length > ctx.contextBudget.maxChars + 500`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-observability.test.ts --reporter=dot
```

Expected: pass.

---

### Task 9: Add End-To-End Cost Regression Fixture

**Files:**
- Create: `src/runtime/__tests__/context-cost-regression.test.ts`

- [ ] **Step 1: Write failing fixture test**

Use a synthetic task with:

- huge `PROGRESS.md`
- huge `DECISIONS.md`
- huge `MEMORY.md`
- corpus map present
- checkpoint present
- two repeated worker ticks

Assert:

```ts
expect(workerRecord.contextChars).toBeLessThanOrEqual(12_500)
expect(reviewerRecord.contextChars).toBeLessThanOrEqual(10_500)
expect(secondWorkerPromptChars).toBeLessThan(firstWorkerPromptChars + 2_000)
expect(secondWorkerCachedInputTokens).toBeGreaterThan(0)
expect(readTasksToolOutputChars).toBe(0)
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/context-cost-regression.test.ts --reporter=dot
```

Expected: fail before Tasks 1-7 are complete.

- [ ] **Step 3: Wire fixture through final implementation**

Use existing test helpers from `context-builder.test.ts` and `orchestrator.test.ts`. Do not call real providers. Fake agents should capture prompts and tool metadata.

- [ ] **Step 4: Run full relevant regression set**

Run:

```bash
pnpm exec vitest run \
  src/runtime/__tests__/context-budget.test.ts \
  src/runtime/__tests__/prompt-cache.test.ts \
  src/runtime/__tests__/context-builder.test.ts \
  src/runtime/__tests__/context-observability.test.ts \
  src/runtime/__tests__/context-cost-regression.test.ts \
  src/runtime/__tests__/orchestrator.test.ts \
  src/tools/__tests__/task-queue.test.ts \
  --reporter=dot
```

Expected: pass.

---

### Task 10: Live Audit Proof And Flow Audit Update

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [ ] **Step 1: Run a local synthetic replay**

Run a local replay or deterministic test project that produces context-debug records for worker and reviewer.

Expected evidence:

```text
worker context <= 12.5k chars
reviewer context <= 10.5k chars
old full context packets are replaced in session history
DeepInfra usage reports cached input tokens on repeated provider-backed requests when supported
read-tasks is not used by reviewer/gate
```

- [ ] **Step 2: Update flow audit**

Add a checked item to [internal/audits/flow-audit.md](/Users/matthew/git/oss/guildhall/internal/audits/flow-audit.md) with:

- before averages from FLL (`worker avg 17.5k`, `reviewer avg 29.1k`)
- after fixture/live replay numbers
- test command used
- any remaining follow-up debt

- [ ] **Step 3: Final verification**

Run:

```bash
pnpm build
```

Expected: build passes. Existing third-party Svelte warnings are acceptable only if unchanged.

---

## Self-Review

**Spec coverage:** The plan covers each diagnosed leak: role budgets, raw progress tails, repeated corpus map injection, stale full context in session history, broad `read-tasks`, passive-only observability, and an end-to-end regression fixture.

**Placeholder scan:** No task uses TBD/TODO/implement-later language. Each task includes exact files, failing-test intent, commands, and expected outcomes.

**Type consistency:** New `ContextBudget*` types are defined in Task 1 and reused consistently in Tasks 2 and 7. The plan expects `BuiltContext` to expose the budget result so observability can record it.
