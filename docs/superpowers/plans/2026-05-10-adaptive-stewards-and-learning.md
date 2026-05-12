# Adaptive Stewards and Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Guildhall learn from user corrections and product failures in a structured way, improve future behavior for that user/project, and surface steward-gap recommendations and product suggestions without adding interface clutter.

**Architecture:** Start with structured learning records and a small policy application layer, not a giant new UI. Phase 1 should quietly capture durable user/project preferences and apply them to relevant flows. Later phases add steward-gap suggestions and a builder-facing promotion path for future Guildhall defaults.

**Tech Stack:** Guildhall runtime state in `src/runtime`, serve-layer APIs in `src/runtime/serve.ts`, Svelte settings/product surfaces in `src/web`, repo-local product docs/specs in `docs/superpowers`.

**0.5.0 Scope:** Complete Tasks 1-4 for the first release target. Task 5 is stretch only if it stays tiny and confidence-based. Tasks 6-7 are future-facing follow-through and should not block `0.5.0` unless the user explicitly expands scope.

---

### Task 1: Define the structured learning model

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/core/`
- Modify: `/Users/matthew/git/oss/guildhall/src/config/`
- Create: `/Users/matthew/git/oss/guildhall/src/runtime/learning/`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/`

- [x] Define core types for:
  - learned preferences
  - steward recommendations
  - product suggestions
- [x] Define scope rules for:
  - local user preference
  - project policy
  - future product-level evidence
- [x] Choose on-disk storage locations in Guildhall state that keep these
  records inspectable and easy to evolve
- [x] Add focused tests for parse/load/save behavior

### Task 2: Capture corrections as structured signals

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/thread.ts`
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/serve.ts`
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/` flows that handle approvals, revisions, and user corrections
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/`

- [x] Identify the first small set of correction events worth capturing, such as:
  - repeated “too verbose” style corrections
  - repeated compact-vs-detailed choices
  - repeated source-by-source review preference
  - repeated clarity-related draft rejections
- [x] Convert those events into structured learning records instead of leaving
  them as transcript-only history
- [x] Keep capture conservative: prefer clear repeated patterns over noisy
  one-off guesses
- [x] Add regression tests for the first captured correction signals

### Task 3: Apply learned preferences without adding UI clutter

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/`
- Modify: `/Users/matthew/git/oss/guildhall/src/web/surfaces/`
- Modify: `/Users/matthew/git/oss/guildhall/src/web/lib/`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/`
- Test: `/Users/matthew/git/oss/guildhall/src/web/`

- [x] Build a small preference-application layer that can answer questions like:
  - should this flow default to compact mode?
  - should this review be source-by-source?
  - should the UI suppress internal terms here?
- [x] Apply the first preferences to one or two high-value flows only
  (workspace import and similar guided approvals)
- [x] Make the result feel like better defaults, not new user work
- [x] Add tests proving the same flow renders/applies differently when a
  learned preference exists

### Task 4: Add lightweight inspection and approval of learned behavior

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/web/surfaces/project/SettingsTab.svelte`
- Create/Modify: `/Users/matthew/git/oss/guildhall/src/web/surfaces/project/` settings sub-surface as needed
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/serve.ts`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/`

- [x] Add a minimal inspection surface under settings for:
  - learned user preferences
  - project-level operating preferences
  - suggested adjustments awaiting confirmation
- [x] Keep it secondary and calm; no giant dashboard
- [x] Add simple actions like:
  - keep using this
  - reset
  - make this project-wide
- [x] Add endpoint coverage for reading and updating these records

### Task 5: Add steward-gap suggestion mechanics

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/`
- Modify: `/Users/matthew/git/oss/guildhall/src/web/`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/`

- [x] Define the first steward-gap heuristics, such as:
  - repeated clarity corrections
  - repeated onboarding confusion
  - repeated “too much at once” approval failures
- [x] Turn those into suggested steward recommendations rather than automatic
  persona mutations
- [x] Surface suggestions lightly, only when confidence is high enough
- [x] Add tests for recommendation creation and lightweight reset flow

### Task 6: Add builder-facing product-suggestion records for future Guildhall defaults

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/learning/`
- Modify: `/Users/matthew/git/oss/guildhall/docs/superpowers/`
- Create/Modify: diagnostics/admin surface only if needed

- [x] Define how repeated local/project learnings become structured product suggestions
- [x] Keep this separate from user-facing preference memory
- [x] Record:
  - repeated failure pattern
  - affected surfaces
  - steward gap if any
  - proposed default change
- [x] Define the submission path into real product work, likely as draftable
  GitHub UX/product issues rather than an abstract upstream flag
- [x] Document how Guildhall builders should use those records when shaping
  future product versions

### Task 7: Prove the loop on one real user-journey family

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/docs/web-ui/flow-audit.md`
- Modify: flow files touched during proof
- Test/live-check against Looma + Knit or the current active project

- [x] Use one real guided journey family, likely workspace import / approval,
  as the first proof target
- [x] Show that:
  - a correction is captured
  - a future run gets a better default
  - the user can inspect or reset the learned behavior
  - the interface did not get noisier
- [x] Record the proof and remaining rough edges in the audit log
