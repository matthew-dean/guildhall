# Project Overview And Navigation IA

Date: 2026-05-24
Status: Draft for 0.8.0 implementation

## Goal

Add a project-level Overview surface and tighten the project left rail so each
top-level view answers a distinct question.

The Overview should feel like a more detailed, project-specific version of the
Projects home card: alive, current, and useful at a glance. It should orient the
user before they decide whether to answer something, inspect the queue, debug a
run, or judge release readiness.

## Product Shape

### Left Rail

Proposed project rail:

1. **Overview**
   - Default project landing.
   - No sub-nav for 0.8.0.
   - Answers: "Where is this project right now?"

2. **Thread**
   - Current and Archive stay inside Thread, not rail sub-nav for 0.8.0.
   - Answers: "What can I say, approve, close, or correct?"

3. **Work**
   - Queue: current Work list.
   - Board: current Planner board.
   - Dependencies: MVP summary appears in Overview; a richer Work sub-view can
     follow after 0.8.0.
   - Milestones: future follow-up unless very cheap.
   - Answers: "What work exists, what state is it in, and what is blocked by
     what?"

4. **Timeline**
   - Summary: default curated feed.
   - Events / Agent trace: future split if needed.
   - Answers: "What happened, and why did state change?"

5. **Release**
   - Verdict.
   - Criteria.
   - Git story: future sub-view if Release needs more breathing room.
   - Evidence: future sub-view if artifact browsing lands.
   - Answers: "Can this ship, and what proves it?"

6. **Settings**
   - Existing Settings sub-nav remains.
   - Answers: "How does this project behave?"

### Needs You

Keep fleet-level **Needs you** as a primary top-level product surface. Demote
project-level Needs you from the left rail.

Inside a project, owner attention should appear as:

- topbar `Needs you` badge;
- Overview attention section;
- Thread filter/section behavior later, if needed.

This avoids making project-level Needs you a second Thread.

## Overview Surface

The Overview is a live project dashboard. It should not become another task
table. Its job is orientation, not management.

### Required 0.8.0 Widgets

1. **Live status band**
   - Project name/path context.
   - Run state and the same kind of current ticker message used in the footer.
   - Primary next action: start/stop remains in chrome; Overview links to the
     correct deeper surface.

2. **Work mix**
   - A larger, labeled version of the Projects home color bar.
   - Segments for active/paused, draft/spec review, blocked, done, shelved.
   - Mobile: stack labels below the bar; keep the bar horizontal and readable.

3. **Needs you**
   - Top actionable project inbox items, capped to 3.
   - Link to Thread or the exact action target.
   - If there is no owner input, say so plainly.

4. **Moving now**
   - Live/paused/recent work cards derived from active tasks and recent events.
   - Show the task title, state, and last meaningful activity when available.
   - If the project is running but no task is active, show coordinator state.

5. **Project health**
   - Provider status, git story, dirty checkout/release blockers if available.
   - Not a full Release replacement; it should say whether Guildhall can operate
     confidently.

6. **Recent meaningful changes**
   - Curated latest events, not raw logs.
   - Use the same event summarization style as Timeline/ticker where possible.

7. **Blocked / depends on**
   - Show blocked tasks and the prerequisite Guildhall can identify.
   - Prefer explicit `dependsOn` task links.
   - Fall back to conservative inference from blocker text, inbox items,
     bootstrap/readiness state, or matching task titles.
   - If the dependency is unclear, say `Needs triage` instead of pretending
     Guildhall has a clean graph.
   - This would have made the FLL DB bootstrap stall visible as a project-level
     blocker instead of hiding it in a single task row.

8. **Next run**
   - Before pressing Start, show the next few tasks Guildhall is likely to try.
   - Explain hard start blockers first: readiness, provider, bootstrap, or
     owner action.
   - Treat the list as a preview (`Likely next`), not an exact promise.
   - Order should match the current coordinator posture: finish active/review
     work, then ready work, then show draft/spec-review items that need owner
     attention.

### Future Useful Additions

- **Full dependency graph:** draw edges and grouped prerequisites once the task
  substrate has richer dependency metadata.
- **Run-plan simulator:** explain coordinator policy choices and concurrency
  limits in detail.
- **Artifacts / evidence browser:** specs, gate outputs, screenshots, PRs, and
  task evidence.
- **Milestones / release slices:** 0.8.0 MVP, deferred, 0.9.0, done this
  release.
- **Decisions log:** durable assumptions and owner choices pulled out of Thread.

## Implementation Plan

1. Add `overview` to the project route/view type and router.
   - `/projects/:id` should land on Overview.
   - `/projects/:id/overview` should also work.
   - Legacy `/project` should land on Overview.
   - Task drawer fallback background can stay Thread unless that becomes
     confusing in testing.

2. Add `ProjectOverviewTab.svelte`.
   - Inputs: `detail`, `inboxItems`, `inboxLoaded`, `inboxError`,
     `projectTicker`, `activeProjectId`.
   - Use existing components: `Card`, `Chip`, `Button`, `StatusDot`, `Icon`.
   - Use existing helpers where possible: `buildWorkSurface`,
     `buildProjectTicker`, `friendlyStatus`, `friendlyDomain`,
     `currentProjectHref`.

3. Update `ProjectView.svelte`.
   - Default `currentView` to `overview`.
   - Add Overview as the first rail item.
   - Remove project-level `Needs you` from the rail.
   - Keep topbar `Needs you` badge.
   - Do not show `DoThisNext` above Overview; Overview owns that job.
   - Render `ProjectOverviewTab` when current view is `overview`.

4. Keep mobile first.
   - Overview grids collapse to one column below tablet width.
   - Work mix labels wrap, never overflow.
   - Action cards have full-width buttons on narrow screens.
   - Avoid table-like layout in Overview.

5. Tests.
   - Router tests for `/projects/:id`, `/projects/:id/overview`, legacy
     `/project`, and fallback unknown route behavior.
   - ProjectView test for Overview rendering and rail shape.
   - Focused Overview component test if the component logic grows beyond simple
     rendering.

6. Verification.
   - `pnpm test` focused router/project-view tests.
   - `pnpm typecheck`.
   - `pnpm build`.
   - Browser smoke on FLL and one busier project:
     - Overview loads as default.
     - Rail is understandable.
     - Mobile viewport has no overlap or horizontal spill.
