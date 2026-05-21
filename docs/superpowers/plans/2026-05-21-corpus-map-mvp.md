# Corpus Map MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Guildhall Corpus Map engine so workers receive compact, reuse-oriented architecture context before editing.

**Architecture:** Add an internal `@guildhall/corpus-map` module under `src/corpus-map` with deterministic discovery, fingerprinting, partial refresh, query ranking, and context rendering. Wire it into `buildContext`, CLI refresh, and Settings status without making indexing a hard blocker.

**Tech Stack:** TypeScript, Node fs/crypto/child_process, `yaml`, existing Hono serve API, existing Svelte Settings surface, Vitest.

---

## File Structure

- Create `src/corpus-map/types.ts`: shared map, refresh, query, and context types.
- Create `src/corpus-map/discovery.ts`: git-aware file discovery and fingerprint helpers.
- Create `src/corpus-map/build.ts`: full/partial refresh and map synthesis.
- Create `src/corpus-map/query.ts`: deterministic query/ranking and context packet rendering.
- Create `src/corpus-map/storage.ts`: YAML/JSONL/stale/override persistence.
- Create `src/corpus-map/index.ts`: public module exports.
- Modify `tsconfig.json` and `vitest.config.ts`: add `@guildhall/corpus-map` alias.
- Modify `src/runtime/context-builder.ts`: inject compact Corpus Map block.
- Modify `src/runtime/cli.ts`: add `guildhall corpus-map refresh [path]`.
- Modify `src/runtime/serve.ts`: add status/refresh endpoints.
- Modify `src/web/surfaces/project/SettingsTab.svelte`: add read-only Codebase Map panel and refresh action.
- Add tests under `src/corpus-map/__tests__/` and extend runtime/UI tests.

## Task 1: Internal Module And Storage

- [x] **Step 1: Write tests for map persistence and full build**

Create `src/corpus-map/__tests__/corpus-map.test.ts` with fixtures that write a tiny repo containing `package.json`, `src/web/lib/Button.svelte`, `src/runtime/serve.ts`, and docs. Assert `refreshCodebaseMap({ reason: 'manual' })` writes `codebase-map.yaml`, records files with hashes, creates areas, and creates a button abstraction.

- [x] **Step 2: Add types and storage helpers**

Create `types.ts` and `storage.ts` with `CodebaseMap`, `CorpusFileEntry`, `loadCodebaseMap`, `saveCodebaseMap`, `appendCodebaseMapHistory`, and stale-state helpers.

- [x] **Step 3: Implement discovery and full refresh**

Implement git-aware file listing, fallback walk, fingerprinting, lightweight language/kind classification, regex exports/imports, area synthesis, abstraction synthesis, and verification command extraction.

- [x] **Step 4: Verify**

Run `pnpm test src/corpus-map/__tests__/corpus-map.test.ts`.

## Task 2: Partial Refresh And Query

- [x] **Step 1: Write failing tests for partial refresh**

Assert touching `src/web/lib/Button.svelte` updates only that file fingerprint while preserving unrelated file entries and recomputing the `button` abstraction. Assert `package.json` forces a full refresh.

- [x] **Step 2: Write failing tests for query/context ranking**

Assert `findExistingAbstraction(map, 'button')` returns the command-button abstraction before leaf files. Assert `buildWorkerCorpusContext` stays under budget and includes `Corpus fit required`.

- [x] **Step 3: Implement partial refresh and deterministic query**

Implement `requiresFullRefresh`, touched-file normalization, changed/deleted file replacement, query scoring, abstraction lookup, and context packet rendering.

- [x] **Step 4: Verify**

Run `pnpm test src/corpus-map/__tests__/corpus-map.test.ts`.

## Task 3: Runtime Context Injection

- [x] **Step 1: Add context-builder test**

Extend `src/runtime/__tests__/context-builder.test.ts` to write a `codebase-map.yaml`, call `buildContext`, and assert the formatted context contains `## Corpus Map`, `Reuse / Extend`, and `Corpus fit required`.

- [x] **Step 2: Inject map slice**

Modify `buildContext` to load the map from `memoryDir`, call `buildWorkerCorpusContext`, expose `corpusMap` on `BuiltContext`, and append the block before project memory.

- [x] **Step 3: Verify**

Run `pnpm test src/runtime/__tests__/context-builder.test.ts`.

## Task 4: CLI And Settings Status

- [x] **Step 1: Add serve/CLI tests**

Extend `serve-settings` or focused endpoint tests for `GET /api/project/codebase-map/status` and `POST /api/project/codebase-map/refresh`. Add a CLI helper test if the command parser is already testable; otherwise keep CLI behavior covered by typecheck/build.

- [x] **Step 2: Add runtime endpoints and CLI command**

Add endpoints that return map counts, last refresh, stale state, and support manual refresh. Add `guildhall corpus-map refresh [path]` for local/manual use.

- [x] **Step 3: Add Settings panel**

Show Codebase Map status in Advanced Settings with counts and a refresh button. Keep it read-only and compact.

- [x] **Step 4: Verify**

Run targeted settings/runtime tests.

## Task 5: Agent Prompt Contracts

- [x] **Step 1: Add prompt tests or snapshot assertions where available**

Assert worker/reviewer/spec prompts mention corpus fit requirements.

- [x] **Step 2: Update prompts**

Add Corpus Map obligations to Spec, Worker, and Reviewer agents without bloating unrelated prompt sections.

- [x] **Step 3: Verify full gates**

Run `pnpm test src/corpus-map/__tests__/corpus-map.test.ts src/runtime/__tests__/context-builder.test.ts src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts`, then `pnpm typecheck`, then `pnpm build`.

## Self-Review

- Spec coverage: The plan covers artifacts, partial refresh, query/ranking, context injection, Settings status, CLI refresh, and agent contracts.
- Placeholder scan: No `TBD`/`TODO` placeholders are intentionally left.
- Type consistency: Public API names match the technical spec.
