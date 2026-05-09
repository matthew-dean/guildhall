# Guildhall 0.5.0 Project Service Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Guildhall into a macOS-first local service over many projects, with a Projects-first UI, per-project run controls, an attach-existing-folder flow, and a packaged-executable installer story suitable for `0.5.0`.

**Architecture:** Keep the existing Guildhall runtime mostly intact, but pivot the outer shell: CLI/service lifecycle becomes project-aware rather than project-bound, the web app gains a true top-level Projects experience, and project-specific surfaces move under a selected project shell. Packaging work should validate Node-packaged executable viability while leaving a Deno packaging spike as a bounded comparison, not a runtime rewrite.

**Tech Stack:** Node.js CLI/runtime, Hono server, Svelte SPA, existing workspace registry/config files, macOS LaunchAgent plumbing, npm packaging, shell installer script.

---

### Task 1: Add a 0.5.0 service and project-shell architecture note to the live audit trail

**Files:**
- Modify: `docs/web-ui/flow-audit.md`
- Test: none

- [ ] **Step 1: Append the new 0.5.0 implementation themes to the audit log**

Add a new bullet cluster at the bottom of `docs/web-ui/flow-audit.md` that states:

- `0.5.0` is pivoting from single-project-feeling UI to Projects-first service UX
- CLI/service work, Projects shell work, attach flow, and installer/LaunchAgent work are now in scope
- UI component restructuring is part of the release, not separate cleanup

- [ ] **Step 2: Verify the log reads like a continuation, not a replacement**

Run:

```bash
tail -n 40 docs/web-ui/flow-audit.md
```

Expected: the new `0.5.0` bullets are present at the bottom and do not contradict the existing `0.4.0` proof notes.

- [ ] **Step 3: Commit the audit-log seed**

Run:

```bash
git add docs/web-ui/flow-audit.md
git commit -m "docs: seed 0.5.0 service pivot audit trail"
```

### Task 2: Introduce explicit service lifecycle commands and project-aware serve semantics

**Files:**
- Modify: `src/runtime/cli.ts`
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/serve-supervisor.ts`
- Modify: `docs/reference/cli.md`
- Modify: `docs/guide/running.md`
- Test: `src/runtime/__tests__/serve-supervisor.test.ts`
- Test: `src/runtime/__tests__/serve-providers.test.ts`

- [ ] **Step 1: Write the failing CLI/service tests**

Add tests that prove:

- `guildhall serve` can open the service with no selected project
- `guildhall serve <path>` or running from inside a project path preserves project bias rather than hard-binding the whole service to one project
- `guildhall start`, `guildhall stop`, and `guildhall open` are recognized as commands

Target files:

```text
src/runtime/__tests__/serve-supervisor.test.ts
src/runtime/__tests__/serve-providers.test.ts
```

- [ ] **Step 2: Run the focused tests to see the failures**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-supervisor.test.ts src/runtime/__tests__/serve-providers.test.ts
```

Expected: failures or missing-command assertions for the new lifecycle semantics.

- [ ] **Step 3: Implement CLI command parsing for service lifecycle**

In `src/runtime/cli.ts`:

- add `start`, `stop`, and `open` commands to the help text and dispatch table
- keep `serve` as the primary friendly entrypoint
- make `serve` ensure the service is running, then open the UI
- allow `serve` to pass an optional project path bias without redefining the service as single-project

- [ ] **Step 4: Implement the underlying service-control plumbing**

In `src/runtime/serve.ts` and `src/runtime/serve-supervisor.ts`:

- add a small explicit model for:
  - service running state
  - optional preferred/foreground project
- ensure the service can run with no selected project
- ensure project selection is presentation state, not service identity

- [ ] **Step 5: Update user-facing docs for the new CLI shape**

Edit:

```text
docs/reference/cli.md
docs/guide/running.md
```

Make them describe:

- `serve` as the friendly open/start path
- `start` / `stop` / `open` as advanced lifecycle helpers
- service-wide vs project-scoped behavior

- [ ] **Step 6: Re-run the focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-supervisor.test.ts src/runtime/__tests__/serve-providers.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit the CLI/service lifecycle work**

Run:

```bash
git add src/runtime/cli.ts src/runtime/serve.ts src/runtime/serve-supervisor.ts docs/reference/cli.md docs/guide/running.md src/runtime/__tests__/serve-supervisor.test.ts src/runtime/__tests__/serve-providers.test.ts
git commit -m "feat: add project-aware service lifecycle commands"
```

### Task 3: Add a true Projects-first top-level router and shell

**Files:**
- Modify: `src/web/Router.svelte`
- Modify: `src/web/App.svelte`
- Modify: `src/web/surfaces/Header.svelte`
- Modify: `src/web/surfaces/ProjectView.svelte`
- Create: `src/web/surfaces/ProjectsHome.svelte`
- Create: `src/web/lib/project-summary.ts`
- Create: `src/web/lib/ProjectCard.svelte`
- Modify: `src/web/lib/types.ts`
- Test: `src/web/lib/__tests__/inbox-item-key.test.ts`
- Test: add `src/web/lib/__tests__/project-summary.test.ts`

- [ ] **Step 1: Write the failing routing and summary tests**

Add coverage for:

- a root Projects route distinct from the inside-project routes
- project summary shaping staying separate from presentational card rendering

Target files:

```text
src/web/lib/__tests__/project-summary.test.ts
src/web/lib/__tests__/inbox-item-key.test.ts
```

- [ ] **Step 2: Run the focused frontend tests**

Run:

```bash
pnpm vitest run src/web/lib/__tests__/project-summary.test.ts src/web/lib/__tests__/inbox-item-key.test.ts
```

Expected: failures because the Projects-first shell does not exist yet.

- [ ] **Step 3: Introduce new UI types for projects and project summaries**

In `src/web/lib/types.ts`, define the payloads the root Projects view needs, including:

- project identity
- path
- run state
- health summary
- concise work summary
- current status chips

- [ ] **Step 4: Create a dedicated summary-shaping helper**

In `src/web/lib/project-summary.ts`:

- move root-view data shaping out of components
- compute card-friendly state from API payloads

- [ ] **Step 5: Create reusable top-level project cards**

In `src/web/lib/ProjectCard.svelte`:

- render project summary state
- expose `Open`, `Start`, and `Stop` affordances
- keep presentation separate from fetching/transformation logic

- [ ] **Step 6: Add the Projects home surface and route it**

In:

```text
src/web/surfaces/ProjectsHome.svelte
src/web/Router.svelte
src/web/App.svelte
src/web/surfaces/Header.svelte
```

Implement:

- a real top-level Projects screen
- clear navigation between Projects and a selected project
- header behavior that knows whether the user is at the fleet level or inside one project

- [ ] **Step 7: Make ProjectView project-scoped rather than app-global**

In `src/web/surfaces/ProjectView.svelte`:

- remove assumptions that it is the entire app
- require an explicit selected project context
- keep existing tabs working under that selected project

- [ ] **Step 8: Re-run focused tests and then build**

Run:

```bash
pnpm vitest run src/web/lib/__tests__/project-summary.test.ts src/web/lib/__tests__/inbox-item-key.test.ts
pnpm build
```

Expected: PASS

- [ ] **Step 9: Commit the Projects-first shell**

Run:

```bash
git add src/web/Router.svelte src/web/App.svelte src/web/surfaces/Header.svelte src/web/surfaces/ProjectView.svelte src/web/surfaces/ProjectsHome.svelte src/web/lib/project-summary.ts src/web/lib/ProjectCard.svelte src/web/lib/types.ts src/web/lib/__tests__/project-summary.test.ts src/web/lib/__tests__/inbox-item-key.test.ts
git commit -m "feat: add projects-first app shell"
```

### Task 4: Implement project attachment and uninitialized project flow

**Files:**
- Modify: `src/runtime/cli.ts`
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/workspace-loader.ts`
- Modify: `src/runtime/init.ts`
- Modify: `src/web/surfaces/ProjectsHome.svelte`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Create: `src/web/surfaces/project/ProjectAttachFlow.svelte`
- Test: `src/runtime/__tests__/serve-settings.test.ts`
- Test: `src/runtime/__tests__/workspace-importer.test.ts`
- Test: add `src/runtime/__tests__/project-registry.test.ts`

- [ ] **Step 1: Write failing attach-flow tests**

Add tests for:

- selecting an existing folder that already contains Guildhall config registers and opens it
- selecting an existing folder without Guildhall config creates an uninitialized local project entry
- attach flow does not force immediate setup wizard completion before entering the project shell

- [ ] **Step 2: Run the focused attach-flow tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/project-registry.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement attach-existing-folder as the only new-project path**

In the relevant runtime and web files:

- add a pick-folder -> inspect -> register flow
- detect existing Guildhall config/state
- if present, register and open
- if absent, register as uninitialized and open

- [ ] **Step 4: Add explicit uninitialized project presentation**

Create or wire `src/web/surfaces/project/ProjectAttachFlow.svelte` so the selected project can show:

- detected project path
- config/state status
- next obvious initialization action

- [ ] **Step 5: Keep setup inside the project shell**

Ensure the project opens first, then setup happens inside the project shell rather than in a forced pre-shell wizard.

- [ ] **Step 6: Re-run the focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/project-registry.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit the attach/uninitialized flow**

Run:

```bash
git add src/runtime/cli.ts src/runtime/serve.ts src/runtime/workspace-loader.ts src/runtime/init.ts src/web/surfaces/ProjectsHome.svelte src/web/surfaces/project/SettingsTab.svelte src/web/surfaces/project/ProjectAttachFlow.svelte src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/project-registry.test.ts
git commit -m "feat: add project attachment and uninitialized project flow"
```

### Task 5: Restructure UI components around reusable shells, cards, and data boundaries

**Files:**
- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/WorkTab.svelte`
- Modify: `src/web/surfaces/project/CoordinatorsTab.svelte`
- Modify: `src/web/lib/TaskCard.svelte`
- Create: `src/web/lib/layout/AppShell.svelte`
- Create: `src/web/lib/layout/ProjectShell.svelte`
- Create: `src/web/lib/layout/ProjectsShell.svelte`
- Create: `src/web/lib/project-data.ts`
- Test: `src/web/lib/__tests__/spec-render.test.ts`
- Test: add `src/web/lib/__tests__/project-data.test.ts`

- [ ] **Step 1: Write failing component-boundary tests**

Add tests that exercise:

- project data shaping in a pure helper
- presentational shells/cards remaining independent from route/data loading

- [ ] **Step 2: Run the focused tests**

Run:

```bash
pnpm vitest run src/web/lib/__tests__/project-data.test.ts src/web/lib/__tests__/spec-render.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create shared shell/layout primitives**

Add:

```text
src/web/lib/layout/AppShell.svelte
src/web/lib/layout/ProjectsShell.svelte
src/web/lib/layout/ProjectShell.svelte
```

These should own layout/chrome/nav structure rather than bespoke page-local markup.

- [ ] **Step 4: Move project-specific shaping logic out of presentation-heavy components**

Create `src/web/lib/project-data.ts` and pull transformation/composition logic out of `ProjectView` and project tabs where practical.

- [ ] **Step 5: Refactor the heaviest current project surfaces onto the new structure**

Touch at least:

- `ProjectView.svelte`
- `ThreadTab.svelte`
- `WorkTab.svelte`
- `CoordinatorsTab.svelte`
- `TaskCard.svelte`

Goal:

- clearer boundaries
- less bespoke project-only blob logic
- more consistent reusable pieces for the new Projects-first structure

- [ ] **Step 6: Build and visually verify the project shell still works**

Run:

```bash
pnpm build
```

Expected: PASS

- [ ] **Step 7: Commit the UI architecture pass**

Run:

```bash
git add src/web/surfaces/ProjectView.svelte src/web/surfaces/project/ThreadTab.svelte src/web/surfaces/project/WorkTab.svelte src/web/surfaces/project/CoordinatorsTab.svelte src/web/lib/TaskCard.svelte src/web/lib/layout/AppShell.svelte src/web/lib/layout/ProjectShell.svelte src/web/lib/layout/ProjectsShell.svelte src/web/lib/project-data.ts src/web/lib/__tests__/project-data.test.ts src/web/lib/__tests__/spec-render.test.ts
git commit -m "refactor: restructure project UI around reusable shells"
```

### Task 6: Build the macOS packaging and LaunchAgent path

**Files:**
- Modify: `package.json`
- Modify: `scripts/publish.mjs`
- Create: `scripts/build-macos-package.mjs`
- Create: `scripts/install-launch-agent.mjs`
- Create: `scripts/uninstall-launch-agent.mjs`
- Create: `scripts/install.sh`
- Create: `packaging/macos/io.guildhall.agent.plist.tmpl`
- Modify: `README.md`
- Modify: `docs/guide/quick-start.md`
- Modify: `docs/reference/cli.md`
- Test: add `src/runtime/__tests__/launch-agent.test.ts`

- [ ] **Step 1: Write failing packaging/service tests**

Add tests for:

- LaunchAgent plist generation
- install/uninstall script behavior on macOS path layout assumptions
- packaged executable metadata/config references

- [ ] **Step 2: Run the focused packaging tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/launch-agent.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Node-based packaged executable build plumbing**

Create:

```text
scripts/build-macos-package.mjs
```

It should:

- build the app
- package a macOS-first executable artifact
- place outputs in a predictable release artifact directory

- [ ] **Step 4: Implement LaunchAgent install/uninstall plumbing**

Create:

```text
scripts/install-launch-agent.mjs
scripts/uninstall-launch-agent.mjs
packaging/macos/io.guildhall.agent.plist.tmpl
```

These should:

- install a LaunchAgent in the user domain
- point it at the packaged executable
- support idempotent uninstall

- [ ] **Step 5: Implement the recommended curl installer**

Create:

```text
scripts/install.sh
```

It should:

- fetch/install the packaged executable
- install/start the LaunchAgent
- print the follow-up commands for `guildhall serve`, `guildhall open`, `guildhall stop`

- [ ] **Step 6: Keep npm-global supported**

Update `package.json`, `scripts/publish.mjs`, and docs so npm-global remains valid, while clearly secondary to the curl installer.

- [ ] **Step 7: Update install and release docs**

Edit:

```text
README.md
docs/guide/quick-start.md
docs/reference/cli.md
```

Make the recommended install story:

- curl installer first
- npm-global supported second

- [ ] **Step 8: Re-run focused packaging tests and build**

Run:

```bash
pnpm vitest run src/runtime/__tests__/launch-agent.test.ts
pnpm build
```

Expected: PASS

- [ ] **Step 9: Commit the packaging/LaunchAgent work**

Run:

```bash
git add package.json scripts/publish.mjs scripts/build-macos-package.mjs scripts/install-launch-agent.mjs scripts/uninstall-launch-agent.mjs scripts/install.sh packaging/macos/io.guildhall.agent.plist.tmpl README.md docs/guide/quick-start.md docs/reference/cli.md src/runtime/__tests__/launch-agent.test.ts
git commit -m "feat: add macos packaging and launchagent install path"
```

### Task 7: Run the Deno packaging comparison spike and record the decision

**Files:**
- Create: `docs/design/deno-vs-node-packaging.md`
- Test: manual comparison commands only

- [ ] **Step 1: Build a minimal Node-packaged executable artifact and record measurements**

Run the new packaging build and capture:

- artifact size
- startup behavior
- install complexity

Record the results in:

```text
docs/design/deno-vs-node-packaging.md
```

- [ ] **Step 2: Build a minimal Deno-packaged comparison artifact and record measurements**

Use a minimal isolated experiment and record:

- artifact size
- startup behavior
- install complexity
- workflow disruption

- [ ] **Step 3: Write the explicit decision**

In `docs/design/deno-vs-node-packaging.md`, write:

- the measured comparison
- the chosen path for `0.5.0`
- why the loser was rejected for now

- [ ] **Step 4: Commit the packaging decision note**

Run:

```bash
git add docs/design/deno-vs-node-packaging.md
git commit -m "docs: record node vs deno packaging decision"
```

### Task 8: Prove the 0.5.0 service/project flow end to end

**Files:**
- Modify: `src/runtime/__tests__/e2e.test.ts`
- Modify: `src/runtime/__tests__/serve-release-readiness.test.ts`
- Modify: `docs/releases/0.5.0.md`
- Test: targeted e2e + release readiness

- [ ] **Step 1: Write the end-to-end proof tests**

Extend the e2e/release-readiness coverage to prove:

- service starts with no selected project
- attach-existing-folder works
- existing Guildhall config is detected and registered
- uninitialized project opens into project shell setup
- per-project start/stop works
- current narrow task lane still reaches terminal success under the nested project shell

- [ ] **Step 2: Run the focused proof suite**

Run:

```bash
pnpm vitest run src/runtime/__tests__/e2e.test.ts src/runtime/__tests__/serve-release-readiness.test.ts
```

Expected: FAIL before implementation is complete, PASS once all prior tasks are done.

- [ ] **Step 3: Update the 0.5.0 release note**

Create or update:

```text
docs/releases/0.5.0.md
```

Document the actual proof surface:

- project/service pivot
- installer path
- per-project lifecycle
- preserved narrow-lane task automation

- [ ] **Step 4: Run the full pre-release verification set**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: PASS

- [ ] **Step 5: Commit the proof and release note**

Run:

```bash
git add src/runtime/__tests__/e2e.test.ts src/runtime/__tests__/serve-release-readiness.test.ts docs/releases/0.5.0.md
git commit -m "test: prove 0.5.0 project service flow"
```

## Self-Review

- Spec coverage: this plan covers the Projects-first shell, service lifecycle, attach flow, UI architecture cleanup, installer/LaunchAgent work, packaging comparison, and end-to-end proof requirements from the approved `0.5.0` design.
- Placeholder scan: no `TODO`/`TBD` placeholders remain; each task names exact files and verification commands.
- Type consistency: the plan consistently uses `project` for the user-facing surface, keeps `workspace` only in existing file names/runtime references, and keeps the Node-packaged executable + LaunchAgent approach as the implementation default while treating Deno as a comparison spike only.
