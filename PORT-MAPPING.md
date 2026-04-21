# OpenHarness → Guildhall Port Mapping

**Companion to:** [SPEC.md](SPEC.md), [PLAN.md](PLAN.md)
**Upstream reference:** `/Users/matthew/git/oss/OpenHarness/` (pinned to cloned SHA; update this doc when re-syncing)

This is the working plan for translating OpenHarness modules from Python to TypeScript. It lists each module, its target location, port difficulty, idiom notes, and test strategy. Update as ports land.

---

## 1. Idiom translation reference

| Python | TypeScript |
|---|---|
| `pydantic.BaseModel` with `Literal` type field | `z.discriminatedUnion('type', [...])` |
| `pydantic.Field(default_factory=dict)` | `z.record(...).default({})` or `z.object({...}).default({})` |
| Pydantic validator | Zod `.refine()` or separate validation function |
| `@dataclass(frozen=True)` | `readonly` class or `Object.freeze(...)` |
| `asyncio.Queue` | Custom async queue or `p-queue` |
| `asyncio.Lock` | Async Mutex (`async-mutex`) or a simple `pending` flag |
| `asyncio.Future` | `Promise` with exposed `resolve`/`reject` (Deferred pattern) |
| `asyncio.to_thread(fn)` | Worker thread or `Promise.resolve(fn())` where fn is truly sync |
| `async with` | `try`/`finally` or a disposable helper |
| `yield` in async generator | `async function*` |
| `AsyncIterator[T]` | `AsyncIterable<T>` or `AsyncGenerator<T>` |
| `subprocess` / `asyncio.create_subprocess_exec` | Node `child_process.spawn` or `execa` |
| `shlex.quote` | `shell-escape` npm package |
| `httpx` | `fetch` (Node 18+) or `undici` |
| `typer` | `commander` or `citty` |
| `Path` from pathlib | `node:path` + `node:fs/promises` |
| `uuid.uuid4()` | `crypto.randomUUID()` |
| `datetime` | `Date` (ISO strings for persistence) |
| `yaml.safe_load` | `js-yaml` `.load()` |

---

## 2. Module-by-module plan

Ordered by port sequence. Each row: source → target, LOC, difficulty, status, notes.

### Tier 1 — Foundation (wire protocol + message types)

| # | Upstream | Target (`@guildhall/...`) | LOC | Difficulty | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | `ui/protocol.py` | `protocol/src/wire.ts` | 221 | Moderate | in progress | **Redesign on port:** upstream uses a single Pydantic model with all-optional fields; we split into a proper discriminated union on `type`. Adds compile-time safety Python leaves on the table. |
| 2 | `engine/stream_events.py` | `protocol/src/events.ts` | 89 | Mechanical | pending | Seven frozen dataclasses → Zod discriminated union. No async, no validation, clean. |
| 3 | `engine/messages.py` | `protocol/src/messages.ts` | 221 | Mechanical | pending | `ContentBlock` is a `Field(discriminator='type')` union — direct `z.discriminatedUnion` map. `ToolUseBlock` default UUID → Zod default with `crypto.randomUUID()`. `.to_api_param()` → serializer function. |

**Tier 1 exit criteria:** `@guildhall/protocol` typechecks + tests pass, including round-trip JSON validation for every event and every content block type.

### Tier 2 — Engine core

| # | Upstream | Target (`@guildhall/...`) | LOC | Difficulty | Status | Notes |
|---|---|---|---|---|---|---|
| 4 | `engine/query_engine.py` + `engine/query.py` | `engine/src/query-engine.ts` + `engine/src/run-query.ts` | 300+ | **Redesign** | pending | The `run_query` function (inside `query.py`) is the actual loop. Needs careful TS translation: async generator yielding `StreamEvent`, permission checks gate tool execution, reactive compaction on context-overflow API error, retry logic. |
| 5 | `ui/runtime.py` (RuntimeBundle + build_runtime/start_runtime/close_runtime/handle_line) | `engine/src/runtime.ts` | ~200 | Moderate | pending | Dependency injection container. Lazy plugin loading. Adapt settings merge to read Guildhall's `guildhall.yaml` (not OH's settings). |
| 6 | `services/session_storage.py` | `sessions/src/index.ts` | 80 | Mechanical | pending | SHA1 hash of cwd → session dir. JSON snapshots. Node equivalents map 1:1. |

**Tier 2 exit criteria:** single-turn agent invocation runs end-to-end. Prompt in → LLM call → tool use → tool result → assistant complete. All streaming via the Tier 1 protocol. Mid-turn resume demonstrated.

### Tier 3 — Extensibility

| # | Upstream | Target (`@guildhall/...`) | LOC | Difficulty | Status | Notes |
|---|---|---|---|---|---|---|
| 7 | `skills/registry.py` + `skills/loader.py` + `skills/types.py` | `skills/src/*` | ~150 | Mechanical | pending | Filesystem scan + YAML frontmatter parse. Bundled skills (commit/debug/diagnose/plan/review/simplify/test) ship in-package as string literals or loaded from bundled data. |
| 8 | `hooks/events.py` + `hooks/executor.py` + `hooks/types.py` + `hooks/schemas.py` | `hooks/src/*` | ~240 | Moderate | pending | Subprocess + HTTP + sub-agent invocation. Careful shell escaping (`shell-escape`). Timeout via `Promise.race`. |
| 9 | `ui/backend_host.py` | `engine/src/backend-host.ts` | 785 | Moderate | pending | Reference implementation of the event-protocol host. Stdin/stdout bidirectional JSONL with `OHJSON:` prefix. Async mutex for write serialization. Future-based permission/question flows. |
| 10 | `tasks/manager.py` + `tasks/types.py` | `tasks/src/*` | ~385 | Moderate | pending | Background subprocess lifecycle. Maps to Node `child_process` with PID tracking + output file sink. |
| 11 | `mcp/` subtree | `mcp/src/*` | TBD | Moderate | pending | MCP client. JS MCP SDK exists upstream from Anthropic — may be able to use the SDK directly and skip porting the client code. Investigate before porting. |
| 12 | `services/cron.py` | `cron/src/*` | 50 | Mechanical | pending | JSON job registry + cron validation. `cron-parser` npm for expressions. |

**Tier 3 exit criteria:** skills load from disk and inject into system prompt. Hooks fire on lifecycle events and can block actions. MCP tools work. Background tasks run.

### Tier 4 — CLI & glue

| # | Upstream | Target (`@guildhall/...`) | Status | Notes |
|---|---|---|---|---|
| 13 | `cli.py` (flag surface) | `runtime/src/cli.ts` | pending | Replace Typer with Commander. Keep Guildhall's existing CLI structure; port OH flags that make sense (`--permission-mode`, `--max-turns`, `--model`, etc.). |
| 14 | `autopilot/` subtree | — | **DROP** | OH's autopilot replaced by Guildhall's lifecycle orchestration. |
| 15 | REPL + swarm + multi-channel bots | — | **DROP** | Out of scope. |

---

## 3. Test porting strategy

**Principle:** each ported module ships with its tests in the same PR. A module is not "done" until its tests pass in TypeScript.

**Mechanical translations:**
- `pytest` `def test_foo():` → vitest `it('foo', () => {...})`
- `pytest.fixture` → vitest `beforeEach` / `beforeAll`
- `@pytest.mark.parametrize` → `it.each([...])`
- `assert x == y` → `expect(x).toEqual(y)`
- `pytest.raises(Exc)` → `expect(() => ...).toThrow(Exc)`

**Redesigned tests:**
- Pydantic `ValidationError` tests → Zod `SafeParseError` tests against equivalent malformed inputs
- `asyncio`-specific tests (queue ordering under contention) → Promise/Mutex equivalents
- Tests depending on Python-specific error strings → assert on error `.code` or error class, not message

**Skipped tests (and why):**
- Tests for OH's multi-channel bots (Slack/Telegram/etc.) — out of scope, modules not ported
- Tests for OH's React/Ink frontend — replaced by Tauri
- Tests for OH autopilot — replaced by Guildhall orchestration

**Record in each ported test file:** a header comment pointing to the upstream test file.

---

## 4. Per-file attribution

Every file ported from OpenHarness begins with:

```typescript
/**
 * Ported from openharness/src/openharness/<path>.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: <sha>
 *
 * Changes from upstream:
 *   - <list deliberate deviations>
 */
```

---

## 5. Dependency graph of ports

```
protocol/wire      ← nothing (leaf)
protocol/events    ← protocol/messages
protocol/messages  ← nothing (leaf)

engine/messages    ← protocol/messages
engine/query       ← protocol/events, engine/messages, tool-registry, permission-checker
engine/runtime     ← engine/query, skills, hooks, mcp, sessions

sessions           ← engine/messages

skills/            ← nothing (leaf, consumed by engine/runtime)
hooks/             ← protocol/events (for hook result events), engine/messages (payloads)
mcp/               ← nothing (leaf, consumed by engine/runtime)
tasks/             ← engine/messages (for agent tasks)

backend-host       ← engine/runtime, protocol/wire, protocol/events
```

Critical path for a minimum usable build: `protocol` → `engine` → `sessions` → `backend-host`. Everything else is parallelizable.

---

## 6. Port completion checklist (per module)

- [ ] Upstream file read in full and documented
- [ ] TS file created with attribution header
- [ ] Types ported with idiom translations applied
- [ ] Tests ported (including negative tests)
- [ ] `pnpm typecheck` green
- [ ] `pnpm test` green for this package
- [ ] Cross-references to other ported modules resolved
- [ ] PR description cross-references upstream file + lists deliberate deviations
- [ ] Entry in this doc status column updated to `done`
