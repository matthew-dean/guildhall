# Project Memory

This file is the long-term knowledge base for the Forge multi-agent system.
Agents append new sections here. Do not delete sections — add corrections as new entries.

---

## Forge System

Forge is a multi-agent operating system for software projects. Key rules:
- All state lives in memory/ — the orchestrator is stateless and can be restarted
- TASKS.json is the single source of truth; nothing happens outside it
- No task moves past spec_review without an explicit approved spec
- All completed work goes through: worker → reviewer → gate checker → done
- Hard gates cannot be skipped; soft gate overrides require an ADR entry

## Workspace Model

Forge separates the tool from the workspace:
- The tool lives at ~/git/oss/forge (installed once)
- A workspace is a directory with guildhall.workspace.ts + memory/
- Run `guildhall run` from a workspace dir, or `guildhall run --workspace <path>`
- Run `guildhall init <path> --name <name>` to scaffold a new workspace anywhere
- Multiple workspaces run as separate processes, completely independently
- This workspace (looma-knit) is the default, shipping with the Forge repo

## LM Studio Connection

LM Studio runs on http://localhost:1234/v1 by default.
Set LM_STUDIO_MODEL to the model name loaded in LM Studio.
Set LM_STUDIO_FAST_MODEL for the reviewer/gate-checker agents (can be smaller).
Recommended models: qwen2.5-coder-32b-instruct (primary), qwen2.5-coder-7b (fast).

## Looma Project

Looma is a stack-agnostic UI library at ~/git/oss/looma.
Set LOOMA_PATH env var to override the default path.
Key rules:
- No Knit-specific vocabulary in component APIs
- All components need: contract README, generated API metadata, docs page, Storybook story
- Run `pnpm generate:api && pnpm check:docs-sync` after any component changes
- Hard gates: pnpm typecheck, pnpm build, pnpm test, pnpm check:docs-sync
- Current stage: Stage 1 (Knit primitive replacement wave) + Stage 3 (M6 promotions)

## Knit Project

Knit is a wiki app at ~/git/oss/knit.
Set KNIT_PATH env var to override the default path.
Key rules:
- Knit consumes Looma; it does not duplicate Looma components
- Editor logic lives in @looma/editor; Knit only binds data + listeners
- V1 polish scope only — V2 features must be explicitly deferred
- Hard gates: pnpm typecheck, pnpm build
- Looma migration inventory: knit/docs/looma-migration-inventory.md

## Looma–Knit Coordination

When Knit needs a new Looma component:
1. Knit coordinator files a CrossDomainRequest
2. Looma coordinator reviews against: api-genericity, accessibility, ssr-first, documentation
3. If approved, Looma coordinator creates a Looma task; Knit coordinator creates a consumption task
4. Knit task depends on the Looma task

---
