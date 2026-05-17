# GuildHall Docs + UI System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the GuildHall docs experience around a stronger product story while introducing a reusable `@guildhall/ui` Svelte package that can serve both branded docs surfaces and dense in-product operator views.

**Architecture:** Convert the current flat repo into a lightweight monorepo with a new `packages/ui` package, then drive the docs redesign from a structural audit of existing GuildHall screens. The docs site remains in VitePress, but it should visually and conceptually reflect the shared Svelte component system rather than inventing a docs-only design language.

**Tech Stack:** VitePress, Svelte 5, TypeScript, existing GuildHall build/test tooling, local screenshot capture via browser automation or rendered docs assets.

---

### Task 1: Monorepo Scaffolding and `@guildhall/ui` Package Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/package.json`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/package.json`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/tsconfig.json`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/index.ts`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/tokens.ts`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/styles.css`

- [ ] **Step 1: Add workspace configuration**

```yaml
# pnpm-workspace.yaml
packages:
  - packages/*
```

- [ ] **Step 2: Update root package metadata for monorepo-aware scripts**

```json
{
  "scripts": {
    "build": "node ./build.mjs",
    "build:ui": "pnpm --filter @guildhall/ui build",
    "typecheck:ui": "pnpm --filter @guildhall/ui typecheck",
    "docs:build": "npm run docs:extract-help && vitepress build docs"
  }
}
```

- [ ] **Step 3: Create the new publishable UI package**

```json
{
  "name": "@guildhall/ui",
  "version": "0.0.0-dev",
  "type": "module",
  "svelte": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 4: Seed the package entrypoints**

```ts
// packages/ui/src/index.ts
export * from './tokens'
```

```ts
// packages/ui/src/tokens.ts
export const guildhallDensity = ['comfortable', 'dense'] as const
export const guildhallModes = ['display', 'operator'] as const
export const guildhallEmphasis = ['quiet', 'assertive'] as const
```

```css
/* packages/ui/src/styles.css */
:root {
  --gh-radius-1: 10px;
  --gh-radius-2: 16px;
  --gh-density-comfortable: 1;
  --gh-density-dense: 0.82;
}
```

- [ ] **Step 5: Run workspace install and sanity checks**

Run: `pnpm install`
Expected: workspace lockfile and package graph update cleanly

Run: `pnpm --filter @guildhall/ui typecheck`
Expected: PASS

### Task 2: Audit Existing GuildHall UI Structure and Capture Screenshots

**Files:**
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/design/ui-audit.md`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/assets/ui-audit/`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/ProjectsHome.svelte`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/ProjectView.svelte`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/project/ThreadTab.svelte`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/project/WorkTab.svelte`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/project/ReleaseTab.svelte`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/project/SettingsTab.svelte`
- Inspect: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/TaskDrawer.svelte`

- [ ] **Step 1: Document the audit rubric**

```md
## Structural audit rubric

- What job does this surface do?
- Is the information hierarchy strong?
- Is this a reusable shell or a one-off chunk?
- What should become a primitive?
- What should remain composed?
```

- [ ] **Step 2: Capture the key product screenshots**

Run: `npm run docs:dev -- --host 127.0.0.1 --port 5173`
Expected: docs server is available locally

Run: capture screenshots of:
- Projects page
- project shell
- Thread
- Work
- Release
- Settings
- task drawer

Expected: image files saved under `docs/assets/ui-audit/`

- [ ] **Step 3: Write the audit document**

```md
## Preserve
- shell structure
- left rail information model
- Thread as command surface

## Rework
- section framing
- card anatomy consistency
- typography rhythm
```

- [ ] **Step 4: Verify the audit is evidence-backed**

Run: `test -f docs/design/ui-audit.md`
Expected: file exists

Run: `find docs/assets/ui-audit -type f | wc -l`
Expected: screenshot count > 0

### Task 3: Define Shared Design Tokens and Structural Primitives

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/tokens.ts`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/styles.css`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/SectionHeader.svelte`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/NoticeBand.svelte`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/FrameCard.svelte`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/StatusPill.svelte`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/index.ts`

- [ ] **Step 1: Expand token definitions around structural roles**

```ts
export const guildhallSurfaceRoles = ['canvas', 'panel', 'inset', 'accent'] as const
export const guildhallTypeRoles = ['eyebrow', 'title', 'lede', 'body', 'meta'] as const
export const guildhallShellModes = ['display', 'operator'] as const
```

- [ ] **Step 2: Build the first shared primitives**

```svelte
<!-- packages/ui/src/components/SectionHeader.svelte -->
<script lang="ts">
  export let eyebrow = ''
  export let title = ''
  export let lede = ''
  export let mode: 'display' | 'operator' = 'operator'
</script>
```

```svelte
<!-- packages/ui/src/components/StatusPill.svelte -->
<script lang="ts">
  export let tone: 'quiet' | 'ok' | 'warn' | 'danger' | 'accent' = 'quiet'
  export let dense = false
</script>
```

- [ ] **Step 3: Export the new primitives**

```ts
export { default as SectionHeader } from './components/SectionHeader.svelte'
export { default as NoticeBand } from './components/NoticeBand.svelte'
export { default as FrameCard } from './components/FrameCard.svelte'
export { default as StatusPill } from './components/StatusPill.svelte'
```

- [ ] **Step 4: Verify the package still typechecks**

Run: `pnpm --filter @guildhall/ui typecheck`
Expected: PASS

### Task 4: Add Docs-Showcase Compositions and Brand Assets

**Files:**
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/HeroBand.svelte`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/AnnotatedScreenshot.svelte`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/packages/ui/src/components/GuildDiagram.svelte`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/assets/illustrations/`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/assets/illustrations/guild-overview.svg`
- Create: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/assets/illustrations/reviewer-flow.svg`

- [ ] **Step 1: Build display-mode compositions in Svelte**

```svelte
<!-- packages/ui/src/components/HeroBand.svelte -->
<script lang="ts">
  export let headline = ''
  export let subhead = ''
  export let note = ''
</script>
```

- [ ] **Step 2: Create the guild/reviewer diagrams**

```svg
<svg viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg">
  <rect x="24" y="24" width="752" height="372" rx="24" fill="#12161d"/>
  <text x="60" y="80" fill="#f2f5fb">Guild diagram placeholder</text>
</svg>
```

- [ ] **Step 3: Add screenshot annotations**

```md
- Projects page: attach flow, status scan, open/start/stop
- Project shell: Thread, Work, Release, Settings
- Release: auditable results and guardrails
```

- [ ] **Step 4: Verify asset paths are stable**

Run: `find docs/assets/illustrations -type f`
Expected: SVG files present

### Task 5: Redesign the Homepage and First-Visit Docs Pages

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/index.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/guide/quick-start.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/guide/dashboard.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/web-ui/dashboard.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/web-ui/project-view.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/.vitepress/config.ts`

- [ ] **Step 1: Rewrite the homepage hero and sequence**

```md
hero:
  name: GuildHall
  text: Let the guild carry the work.
  tagline: As unattended as you want. As auditable as you need.
```

- [ ] **Step 2: Add the once-only origin note**

```md
GuildHall was built by an ADHD engineer who got overwhelmed by AI harnesses that demanded too much attention just to stay upright.
```

- [ ] **Step 3: Re-sequence homepage sections**

```md
1. Hero
2. Real product shell
3. Why it works
4. Guild layer
5. Honest limits
```

- [ ] **Step 4: Tighten Quick Start around service-first onboarding**

```md
- install the local service
- run `guildhall serve`
- attach a project
- configure provider
- launch the guild
```

- [ ] **Step 5: Verify docs build**

Run: `npm run docs:build`
Expected: PASS

### Task 6: Harmonize the Remaining Docs Voice and Navigation

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/guide/introduction.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/guide/workspaces.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/cli/index.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/cli/reference.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/web-ui/index.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/design/index.md`

- [ ] **Step 1: Normalize tone and terminology**

```md
- use “project” as the primary user-facing term
- keep “workspace” when technically necessary
- keep jokes aimed at software chaos, not the user
```

- [ ] **Step 2: Remove generic feature-grid tone where it survives**

```md
Replace:
"multi-agent operating system for software projects"

With plainer, stronger product framing when used in user-facing pages.
```

- [ ] **Step 3: Verify internal link integrity**

Run: `npm run docs:build`
Expected: PASS

### Task 7: Wire the First Product Consumers of `@guildhall/ui`

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/ProjectsHome.svelte`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/ProjectView.svelte`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/project/ReleaseTab.svelte`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/src/web/surfaces/project/SettingsTab.svelte`

- [ ] **Step 1: Pick a minimal adoption slice**

```md
Adopt shared primitives first in:
- section headers
- notice/status framing
- shell framing surfaces
```

- [ ] **Step 2: Replace ad hoc framing with shared primitives**

```svelte
<SectionHeader
  mode="operator"
  eyebrow="Projects"
  title="Your local GuildHall service"
  lede="Open a project, keep a few running, and see which ones need you."
/>
```

- [ ] **Step 3: Keep scope structural, not cosmetic-only**

```md
Do not try to solve final color/spacing polish everywhere in this step.
Focus on replacing bespoke structure with shared roles and variants.
```

- [ ] **Step 4: Verify product tests still pass**

Run: `npm test`
Expected: PASS

### Task 8: Final Verification and Delivery Notes

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/design/ui-audit.md`
- Modify: `/Users/matthew/git/oss/guildhall-vitepress-ui-main-path/docs/releases/0.5.0.md` (if messaging needs alignment)

- [ ] **Step 1: Run all key verification commands**

Run: `pnpm install`
Expected: PASS

Run: `pnpm --filter @guildhall/ui typecheck`
Expected: PASS

Run: `npm run docs:build`
Expected: PASS

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Capture before/after evidence**

```md
- before homepage screenshot
- after homepage screenshot
- before product shell screenshot
- after product shell screenshot
```

- [ ] **Step 3: Summarize residual risk**

```md
- docs shell still VitePress/Vue wrapper
- deeper subsystem pages may lag the new visual language initially
- product-wide spacing/type refinement remains a follow-up beyond structural adoption
```

