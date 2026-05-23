# UI structural audit

This audit is based on the live Guildhall shell in this worktree as of
2026-05-22. The screenshot set was refreshed from the `0.7.0` build so the
captured chrome shows the release-candidate version.

Captured routes and screenshots:

- `docs/assets/ui-audit/0-7-0/projects.png`
  - `docs/assets/ui-audit/0-7-0/projects.avif` is the preferred rendered
    source in docs pages; the PNG stays as the fallback.
- `docs/assets/ui-audit/0-7-0/thread.png`
- `docs/assets/ui-audit/0-7-0/work.png`
- `docs/assets/ui-audit/0-7-0/release.png`
- `docs/assets/ui-audit/0-7-0/settings.png`
- `docs/assets/ui-audit/0-7-0/task-drawer.png`

Older exploratory captures remain under `docs/assets/ui-audit/`, but published
0.7 docs should use the versioned `0-7-0` folder so browser and Codex image
caches cannot accidentally show stale UI.

## Structural audit rubric

- What job does this surface do?
- Is the information hierarchy strong?
- Is this a reusable shell or a one-off chunk?
- What should become a primitive?
- What should remain composed?

## First finding: the live app is not the docs IA

The current shell is a service-level Projects home plus project-scoped routes:

- `/projects`
- `/projects/:projectId/thread`
- `/projects/:projectId/work`
- `/projects/:projectId/coordinators`
- `/projects/:projectId/timeline`
- `/projects/:projectId/release`
- `/projects/:projectId/settings/*`
- `/providers`
- `/projects/:projectId/task/:taskId`

This matters because older audit notes described a single-project app. The
current product is now a local service over many registered projects, with a
project shell that opens only after you choose a project.

## Preserve

### 1. The app shell has a real information model

`src/web/surfaces/ProjectView.svelte`
already gives us the right broad structure:

- left rail for persistent navigation
- compact top status bar
- active surface in the main pane
- modal inspector drawer over the shell

This is strong operator UI DNA. It feels like a tool, not a landing page.

### 2. "Do this next" is the right behavioral pattern

The banner that appears across Work, Settings, Coordinators, and other views is
one of the clearest product ideas in the UI. It turns setup friction into one
explicit next move instead of making the user remember hidden prerequisites.

That should become a first-class shared primitive, not a one-off helper.

### 3. Task inspection belongs in a drawer

`src/web/surfaces/TaskDrawer.svelte`
is the right interaction model for auditability:

- the work list stays visible
- the user can inspect spec/transcript/history without losing context
- action buttons stay anchored

This is very aligned with "as unattended as you want, as auditable as you need."

### 4. Work tab has the right broad split

`src/web/surfaces/project/WorkTab.svelte`
has a useful structure:

- primary pane: tasks
- secondary pane: live activity
- overflow pane: collapsed recent progress

That is a good operator pattern. It just needs better compositional discipline.

## Rework

### 1. The home surface is framed too passively

The default route is Inbox/Needs you:

- `src/web/surfaces/project/InboxTab.svelte`

It is clear, but it undersells the product. Guildhall is supposed to feel like
"set the work in motion, then inspect when needed." Starting on a queue of
interruptions makes the product feel more like a triage tool than a command
surface.

Recommendation:

- preserve the inbox concept
- do not preserve its role as the primary emotional first impression
- redesign the default surface around command, status, and audit trail, with
  inbox items as one module inside it

### 2. Card anatomy is inconsistent across the product

The current system has useful raw material, but the anatomy varies too much:

- `src/web/lib/Card.svelte`
- `src/web/lib/TaskCard.svelte`

Examples:

- cards mix left-border severity stripes, tone stripes, chip-only status, and
  plain text emphasis
- header spacing and text hierarchy vary by surface
- some cards feel like framed sections, others like dense work items

Recommendation:

- split these into distinct primitives instead of one vague "card" family
- likely families:
  - `FrameCard` for section surfaces
  - `TaskTile` for queue items
  - `NoticeBand` for urgent guidance
  - `ChecklistRow` for status rows

### 3. Too much layout logic is hand-rolled per surface

The user asked for layout primitives instead of margin-led component sprawl.
The current UI partly does this, but not far enough.

There is already:

- `src/web/lib/Stack.svelte`
- `src/web/lib/Row.svelte`

But the major surfaces still define their own local layout systems:

- Work tab two-column shell + task grid
- Planner five-column board
- Coordinators auto-fill board
- Settings left-rail subsection layout

Recommendation:

- keep `Stack`
- rename or evolve `Row` into a clearer `Cluster` role
- add structural primitives in `@guildhall/ui`:
  - `Cluster`
  - `Grid`
  - `Sidebar`
  - `SplitPane`
  - `RailLayout`
  - `InspectorLayout`

Components should not need their own little layout dialect unless they are
genuinely novel.

### 4. Container-query thinking is not in the app yet

Current surfaces rely on viewport breakpoints:

- Work tab: `@media (max-width: 900px)`
- Planner tab: `@media (max-width: 1100px)` and `600px`

That is workable, but it is not ideal for a shell with nested panes and rails.
These layouts want to respond to the width of the content region they live in,
not the whole viewport.

Recommendation:

- move the design system toward container-aware section layouts
- treat boards, rails, drawers, and inspector panes as containers
- let task grids and secondary panels respond to their actual available width

### 5. Typography rhythm is serviceable, but flat

The UI is readable, but the rhythm is blunt:

- lots of all-caps micro-labels
- many headings sit at roughly the same apparent visual weight
- mono is used effectively for IDs, but the app leans on it enough that some
  surfaces feel more debug-panel than product surface

You can see this in Work, Coordinators, and Release especially.

Recommendation:

- define real type roles in `@guildhall/ui`:
  - eyebrow
  - title
  - lede
  - body
  - meta
- use mono narrowly for IDs, commands, and timestamps
- reduce the number of surfaces that solve hierarchy with uppercase alone

### 6. The color system has useful bones but needs a more intentional palette

The current dark palette is not bad. It is restrained and tool-like. But it
does not yet feel authored enough to carry the more expressive docs direction.

The stronger issue is not "make it colorful"; it is:

- status hues need clearer role separation
- neutral surfaces are too close together in some states
- emphasis currently comes more from borders and chips than from a fully
  coherent token system

Recommendation:

- keep the dark operator baseline
- build a real semantic palette in `@guildhall/ui`
- define surfaces, borders, text, action, success, warning, danger, and
  specialty accent roles from the start

### 7. Accessibility is present, but not yet first-class

There are good instincts here:

- keyboardable task cards
- explicit labels in several controls
- visible navigation affordances

But there are still places that should be tightened as the UI system forms:

- clickable `div`/panel patterns should become real links or buttons where possible
- drawer/backdrop interactions should be reviewed carefully for keyboard and
  screen-reader behavior
- color/status combinations should not carry meaning alone
- heading structure across section cards and drawers should be normalized

This is exactly where an explicit design-system accessibility pass should pay off.

## Best candidates for `@guildhall/ui`

### Convert into shared primitives

- app shell / rail nav from `ProjectView.svelte`
- notice / "do this next" treatment
- section framing from `Card.svelte`
- task item anatomy from `TaskCard.svelte`
- inspector drawer shell from `TaskDrawer.svelte`
- tab rail from `TaskDrawer.svelte`
- status/checklist rows from `SettingsTab.svelte`

### Keep composed at the surface level

- inbox orchestration logic
- release-readiness policy logic
- provider configuration workflows
- coordinator domain summaries

Those are product features, not reusable atoms.

## Concrete component critiques

### `TaskCard.svelte`

Good:

- compact
- scan-friendly
- status + id + priority all visible

Needs work:

- title density is good, but the component has no display/operator variants
- status chip, left border, and background tint all compete for the same job
- metadata line is visually faint enough to disappear

Recommendation:

- keep the structure
- simplify emphasis to one primary status signal plus one secondary signal
- add `dense` and `comfortable` variants

### `Card.svelte`

Good:

- clear generic framing primitive

Needs work:

- too generic for how many jobs it is doing
- tone stripe logic makes it feel like both section frame and alert frame
- internal header spacing hard-codes one visual rhythm for many different use cases

Recommendation:

- split it into `Panel`, `NoticeBand`, and possibly `FrameCard`

### `PlannerTab.svelte`

Good:

- the kanban structure is obvious immediately

Needs work:

- columns feel like raw lanes rather than a polished planning surface
- empty states are functional but visually dead
- stage labels are clear but emotionally inert

Recommendation:

- keep the board structure
- rebuild it with a more intentional lane component and container-aware behavior

### `CoordinatorsTab.svelte`

Good:

- domain grouping is strong
- this view helps explain the product model

Needs work:

- textual sparkline looks more debuggy than product-grade
- mandate excerpt and task list compete inside the same frame
- the column wants a clearer header/body/footer anatomy

Recommendation:

- keep coordinator columns
- replace the sparkline treatment with a clearer status summary block

## Design-system implications

The live app already points toward a useful split:

- `operator mode`: dense shell, queue views, settings, providers, drawers
- `display mode`: docs hero, annotated screenshots, diagrams, comparison rows

That is exactly why `@guildhall/ui` should be one system with structural modes,
not a docs skin stapled onto a separate product UI.

## Immediate next steps

1. Build the audit-informed first primitive set in `@guildhall/ui`:
   `FrameCard`, `NoticeBand`, `SectionHeader`, `StatusPill`, `Cluster`,
   `Grid`, `RailLayout`, `InspectorLayout`.
2. Use this audit in the docs redesign instead of pretending the current UI is
   already visually resolved.
3. Update docs copy to acknowledge the live shell truth: current app surfaces
   are project-shell-first, with setup/providers/task inspection already real.
