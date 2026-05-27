# DeepInfra API Design Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Guildhall deliberately use the DeepInfra/OpenAI-compatible API features that reduce wasted work, improve parse reliability, and expose model capability tradeoffs, while explicitly not enabling paid `service_tier` priority.

**Architecture:** Keep provider-specific request fields behind the existing `ApiMessageRequest` boundary so orchestrator and runtime code can opt in without coupling to one host. Add deterministic tests at the provider boundary first, then add higher-level policy helpers for structured JSON, reasoning controls, model metadata, tool narrowing, and prompt-cache-aware context budgets. The paid `service_tier` knob is documented as intentionally unsupported unless a future user explicitly asks for it.

**Tech Stack:** TypeScript, Vitest, OpenAI-compatible chat completions, DeepInfra prompt caching and chat API options, Guildhall runtime/orchestrator tests.

---

## File Structure

- Modify `src/engine/client.ts`: add provider-neutral optional fields for OpenAI-compatible request extras.
- Modify `src/providers/openai-client.ts`: forward supported fields, keep usage reporting enabled for streamed tool calls, and preserve fallback behavior for strict local servers.
- Modify `src/providers/__tests__/openai-client.test.ts`: pin the outbound JSON body for reasoning, structured output, `tool_choice`, and streamed usage with tools.
- Modify `src/runtime/cli.ts`: let JSON-completion helpers send a JSON-schema `response_format` when a schema is known.
- Create `src/runtime/model-api-policy.ts`: central policy for reasoning controls, structured-output support, cache-aware defaults, and the explicit `service_tier` exclusion.
- Create `src/runtime/__tests__/model-api-policy.test.ts`: test policy decisions for Qwen cached workers, Qwen thinking, Kimi, and generic local models.
- Create `src/runtime/deepinfra-model-metadata.ts`: parse DeepInfra model metadata into capability/price facts used by bakeoff and config validation.
- Create `src/runtime/__tests__/deepinfra-model-metadata.test.ts`: fixture tests for cached input pricing, structured-output support, reasoning controls, and non-Qwen challengers.
- Modify `src/engine/query-engine.ts`, `src/engine/run-query.ts`, and `src/agents/guildhall-agent.ts`: pass request policy into worker/coordinator turns without making every call site know provider field names.
- Modify `src/runtime/orchestrator.ts`: apply role/status-specific model API policy and cache-aware prompt keys.
- Modify tool registry/orchestrator tests once the tool surface is mapped: narrow tool lists by role and task phase instead of always sending the full corpus.
- Modify `docs/guide/open-models.md`, `docs/guide/agents-and-models.md`, and `docs/reference/workspace-config.md`: document cache-aware model defaults, reasoning/structured-output behavior, and the explicit non-use of `service_tier`.
- Modify `internal/audits/flow-audit.md`: keep the live checklist in sync with completed and deferred DeepInfra API hardening work.

## Task 1: Provider Request Surface

**Files:**
- Modify: `src/engine/client.ts`
- Modify: `src/providers/openai-client.ts`
- Test: `src/providers/__tests__/openai-client.test.ts`

- [x] **Step 1: Write failing tests**

Add tests showing that `OpenAICompatibleClient.streamMessage()` sends:

```ts
expect(captured?.response_format).toEqual(jsonSchemaResponseFormat)
expect(captured?.reasoning_effort).toBe('low')
expect(captured?.reasoning).toEqual({ effort: 'low', exclude: false })
expect(captured?.tool_choice).toBe('auto')
expect(captured?.stream_options).toEqual({ include_usage: true })
```

The streamed-usage test must include at least one tool so it fails against the current `if (tools) ... else stream_options` behavior.

- [x] **Step 2: Run test to verify failure**

Run:

```bash
pnpm exec vitest run src/providers/__tests__/openai-client.test.ts --reporter=dot
```

Expected: fail because provider request extras are not typed/forwarded and `stream_options` is missing when tools are present.

- [x] **Step 3: Implement minimal provider support**

Add optional fields to `ApiMessageRequest`:

```ts
response_format?: Record<string, unknown>
reasoning_effort?: string
reasoning?: Record<string, unknown>
tool_choice?: string | Record<string, unknown>
```

Forward them in the OpenAI-compatible request body, and always include:

```ts
stream_options: { include_usage: true }
```

Do not add `service_tier`.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm exec vitest run src/providers/__tests__/openai-client.test.ts --reporter=dot
```

Expected: all provider tests pass.

## Task 2: Structured JSON Outputs

**Files:**
- Modify: `src/runtime/cli.ts`
- Test: `src/runtime/__tests__/cli.test.ts`

- [x] **Step 1: Write failing test**

Pin that a JSON helper call sends:

```ts
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'guildhall_json_response',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { items: { type: 'array', items: { type: 'object' } } },
      required: ['items'],
    },
  },
}
```

- [x] **Step 2: Implement schema opt-in**

Thread an optional `responseFormat` through `completeOpenAiCompatibleJson()` and use it at call sites where Guildhall expects machine-readable JSON.

- [x] **Step 3: Verify**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/cli.test.ts --reporter=dot
```

Expected: JSON-completion tests pass and parsing behavior is unchanged.

## Task 3: Reasoning Policy

**Files:**
- Create: `src/runtime/model-api-policy.ts`
- Test: `src/runtime/__tests__/model-api-policy.test.ts`
- Modify: `src/runtime/orchestrator.ts`

- [x] **Step 1: Write policy tests**

Cover these cases:

```ts
expect(resolveModelApiPolicy({ role: 'worker', modelId: 'Qwen/Qwen3.5-35B-A3B' }).reasoning_effort).toBeUndefined()
expect(resolveModelApiPolicy({ role: 'coordinator', modelId: 'Qwen/Qwen3-235B-A22B-Thinking-2507' }).reasoning_effort).toBe('medium')
expect(resolveModelApiPolicy({ role: 'reviewer', modelId: 'moonshotai/Kimi-K2.6' }).reasoning_effort).toBe('low')
expect(resolveModelApiPolicy({ role: 'worker', modelId: 'local-model' }).service_tier).toBeUndefined()
```

- [x] **Step 2: Implement policy helper**

Return only supported fields. The helper must not produce `service_tier`.

- [x] **Step 3: Wire policy**

Apply policy where agent turns are prepared so all OpenAI-compatible calls get the same role/model behavior.

- [x] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/model-api-policy.test.ts src/runtime/__tests__/orchestrator.test.ts --reporter=dot
```

Expected: policy and orchestrator tests pass.

## Task 4: Model Metadata Gate

**Files:**
- Create: `src/runtime/deepinfra-model-metadata.ts`
- Test: `src/runtime/__tests__/deepinfra-model-metadata.test.ts`
- Modify: `src/core/models.ts`

- [x] **Step 1: Write fixture tests**

Use DeepInfra-like fixture objects to verify cached input pricing and capability extraction:

```ts
expect(parseDeepInfraModel(fixture).pricing.cachedInputPerMillionUsd).toBe(0.05)
expect(parseDeepInfraModel(fixture).capabilities.promptCaching).toBe(true)
expect(parseDeepInfraModel(fixture).capabilities.reasoningControls).toBe(true)
```

- [x] **Step 2: Implement parser**

Normalize model id, input price, output price, cached input price, context length, structured output support, tool-call support, and reasoning support.

- [x] **Step 3: Enforce cached-worker candidates**

Keep default worker and bakeoff challenger entries cache-aware. If a model has no cached price, mark it as exploratory rather than default-candidate.

- [x] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/deepinfra-model-metadata.test.ts src/core/__tests__/models.test.ts --reporter=dot
```

Expected: cached-worker metadata tests pass.

## Task 5: Tool-List Narrowing

**Files:**
- Inspect/modify: `src/engine/tools.ts`
- Inspect/modify: `src/engine/run-query.ts`
- Inspect/modify: `src/runtime/orchestrator.ts`
- Test: existing orchestrator/tool tests plus new focused tests near the selected tool-surface code.

- [ ] **Step 1: Map current tool registration**

Use:

```bash
rg -n "tools:|register|ToolRegistry|input_schema|tool_choice" src -g'*.ts'
```

Expected: identify the single boundary that prepares tools for model calls.

- [ ] **Step 2: Write failing tests**

Pin role/status surfaces:

```ts
expect(toolNamesFor({ role: 'worker', phase: 'implementation' })).toContain('read_file')
expect(toolNamesFor({ role: 'worker', phase: 'implementation' })).not.toContain('create_project')
expect(toolNamesFor({ role: 'coordinator', phase: 'intake' })).toContain('create_task')
```

- [ ] **Step 3: Implement focused tool profiles**

Keep profiles additive and explicit. If an unknown role/phase appears, use the current full list as a compatibility fallback and log the missing profile as follow-up evidence.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run src/engine src/runtime --reporter=dot
```

Expected: role/status tool narrowing tests pass without breaking existing tool-call behavior.

## Task 6: Prompt-Cache-Aware Context Budgets

**Files:**
- Modify: `src/runtime/prompt-cache.ts`
- Modify: context-selection files found with `rg -n "corpus|context|budget|map" src/runtime src/engine -g'*.ts'`
- Test: `src/runtime/__tests__/prompt-cache.test.ts` plus a new context-budget regression test.

- [ ] **Step 1: Write failing tests**

Pin that stable prefixes stay byte-for-byte identical across turns while mutable task detail stays later in the message list. Pin that repeated stable context reports cached-token usage when provider usage includes `prompt_tokens_details.cached_tokens`.

- [ ] **Step 2: Implement stable-prefix boundary**

Group provider instructions, role policy, repository map, and compact project facts before changing task/live-progress content. Keep high-churn evidence later.

- [ ] **Step 3: Add budget regression**

Test that the worker does not eagerly inline full files when the corpus map is sufficient for the first action.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run src/runtime/__tests__/prompt-cache.test.ts src/runtime/__tests__/orchestrator.test.ts --reporter=dot
```

Expected: cache key, cached-token accounting, and context-budget tests pass.

## Task 7: Documentation And Flow Audit

**Files:**
- Modify: `docs/guide/open-models.md`
- Modify: `docs/guide/agents-and-models.md`
- Modify: `docs/reference/workspace-config.md`
- Modify: `internal/audits/flow-audit.md`

- [x] **Step 1: Update docs**

Document the practical rules:

```md
- Guildhall sends `prompt_cache_key` for OpenAI-compatible providers when a stable cache identity exists.
- Cached worker defaults must have advertised cached-input pricing.
- Structured JSON requests use provider response schemas when available.
- Reasoning controls are role/model policy, not ad hoc prompt text.
- Guildhall intentionally does not send `service_tier` by default because it can add cost.
```

- [x] **Step 2: Update flow audit**

Mark completed API-hardening checks and list remaining bakeoff/e2e follow-ups.

- [x] **Step 3: Verify full slice**

Run:

```bash
pnpm exec vitest run src/providers/__tests__/openai-client.test.ts src/runtime/__tests__/prompt-cache.test.ts src/core/__tests__/models.test.ts --reporter=dot
pnpm build
```

Expected: targeted tests and build pass.

## Self-Review

- Spec coverage: reasoning controls, structured output, tool narrowing, streamed usage with tool calls, model metadata/cached-price gating, and prompt-cache layout are covered. `service_tier` is explicitly excluded.
- Placeholder scan: no TBD/fill-in placeholders remain; all tasks name concrete files, tests, and commands.
- Type consistency: request fields use the same snake_case property names as OpenAI-compatible APIs and remain optional at the provider boundary.
