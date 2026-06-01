# Design System Governance Constitution

Status: active internal constitution
Last reviewed: 2026-06-01
Applies to: Guildhall web surfaces, `packages/ui`, generated design-system
artifacts, and any agent-authored UI implementation plan in this repository.

## Purpose

Guildhall needs fewer visual decisions per task, not more places to put visual
decisions. Design tokens and reusable components reduce cognitive overhead only
when they behave like contracts. A component that technically uses tokens can
still sprawl if every surface chooses its own size, weight, density, radius,
shadow, tone, or variant vocabulary.

This constitution defines the contract. Product surfaces compose named roles.
The design-system layer owns the roles, budgets, and exceptions.

## Core Law

1. The design system is the source of visual authority. Surface code consumes
   roles; it does not create scales.
2. Tokens are semantic contracts, not a bag of numbers. New token values require
   a named role, an owner, a replacement path, and an audit rule.
3. Component variants must have budgets. Adding a new `tone`, `density`,
   `mode`, `padding`, `size`, or `emphasis` value is a design-system change.
4. Package UI is the canonical primitive layer. App-local components may wrap
   package primitives temporarily, but they may not become a second design
   system.
5. Repeated local CSS is a component request. If two surfaces need the same
   card, row, notice, status, empty-state, field, or action treatment, extract
   or extend a primitive before the third copy appears.
6. Dense operational UI still follows the same roles. A crowded surface is not
   permission to invent one-off typography, spacing, or weight.
7. Page IA and component governance are linked. A giant component with governed
   tokens is still wrong if it owns unrelated product jobs.

## Canonical Token Source

`packages/ui/src/token-definitions.js` and generated `packages/ui/src/styles.css`
are the canonical token source. `src/web/tokens.css` may temporarily alias older
app tokens during migration, but it must stop owning independent `--fs-*`,
`--s-*`, `--r-*`, palette, and global heading scales.

| Token area | Canonical roles | Budget | Not allowed in surfaces |
| --- | --- | --- | --- |
| Color | canvas, sunken, raised, elevated, neutral, info, ok, warn, danger, accent | Semantic role only; no local hue families | Hardcoded hex/rgb/hsl, near-duplicate palette names, local semantic colors |
| Type size | caption, meta, body, body-strong, panel-title, section-title, page-title, display-title, code | Role token only | Raw px/rem sizes, `clamp(...)`, viewport-scaled text, old `--fs-*` in new code |
| Type weight | body, medium, strong, emphasis | Four named weights max | Raw `600`, `650`, `700`, `800`; local bolding without a role |
| Line height | tight, body, relaxed, control | Role token only | Raw `1`, `1.2`, `1.5`, `1.72` outside token/component internals |
| Spacing | `--gh-space-*`, component padding tokens, control padding tokens | 4px grid plus named component exceptions | Local `2px`, `3px`, `7px`, arbitrary rem padding/gaps |
| Radius | tight, default, large, full | 4px, 6px, 8px, pill only | Local 10px/12px radii, nested-card radius escalation |
| Elevation | surface/elevated/frame/modal roles | Component-owned only | Bespoke shadows in surfaces |
| Layering | sticky, topbar, banner, drawer, modal, tooltip | Named z-index roles | Raw z-index values |

## Typography Roles

| Role | Use | Max container | Weight |
| --- | --- | --- | --- |
| `page-title` | Top-level project/page title | Page header only | strong |
| `section-title` | Major surface band or route section | Page section, not inside cards | strong |
| `panel-title` | Card, drawer, modal, settings panel, graph detail panel | Framed panel | strong |
| `body` | Default UI copy | Everywhere | body |
| `body-strong` | Short dense label or table key | Operational panels, rows, forms | strong |
| `meta` | Supporting path/date/source/count text | Rows, bylines, captions | body or medium |
| `caption` | Very compact helper text | Chips, legends, dense rows | body |
| `eyebrow` | Short category label | Headers only | strong |
| `code` | Commands, ids, paths | Inline code and command blocks | body |

Rules:

- `page-title` is never used inside a card, drawer body, modal body, or compact
  panel.
- `display-title` is reserved for public docs or deliberate hero surfaces; it is
  not a dashboard heading.
- Letter spacing defaults to `0`. Positive letter spacing is allowed only for
  the `eyebrow` role. Negative letter spacing is not allowed.
- Global `h1`-`h4` styles may provide reset defaults only. Product surfaces must
  choose explicit text roles through primitives or role classes.

## Variant Vocabulary

These are the only shared variant axes unless this constitution is amended.

| Axis | Values | Owner | Notes |
| --- | --- | --- | --- |
| `tone` | neutral, info, ok, warn, danger, accent | Component layer | `attention` aliases to `warn` during migration; `default` aliases to `neutral`. |
| `density` | dense, compact, comfortable | Component layer | Describes vertical information density, not padding alone. |
| `padding` | compact, default, roomy | Frame-like components only | Do not add padding props to every component. |
| `mode` | operator, display | Component layer | `display` is rare and must not turn dashboards into marketing surfaces. |
| `emphasis` | quiet, default, strong | Component layer | Strong is for state or action priority, not decorative contrast. |
| `size` | sm, md, icon | Controls only | Prefer icon buttons for icon-only actions. |

Deprecated vocabulary:

- `regular` density. Use `comfortable`.
- `attention` tone. Use `warn` unless a component contract proves it is distinct.
- `default` tone. Use `neutral`.
- Component-specific `kind`, `state`, `level`, `variant`, or `appearance` axes
  when they duplicate the shared axes above.

## Component Contract Requirements

Every primitive in `packages/ui/src/components` must have an explicit contract
before it gains new variants or new broad usage.

Required fields:

- `name`
- `owns`: the visual/interaction job it owns
- `useFor`
- `doNotUseFor`
- allowed `tone`, `density`, `mode`, `padding`, `emphasis`, and `size` values
- accessibility contract
- replacement targets for duplicate local components/classes
- max variant axes
- tests or deterministic scans that protect the contract

Budget:

- Ordinary primitives may have at most three variant axes.
- Layout primitives may have at most two variant axes.
- Controls may have at most four axes, but one must be `size` or `density`.
- A component with more axes must split into smaller primitives or write a
  constitutional amendment explaining why the combined abstraction is clearer.

## Canonical Component Ownership

| Need | Canonical owner | Delete, wrap, or migrate away from |
| --- | --- | --- |
| Framed panel/card | `FrameCard` | local `.card`, `src/web/lib/Card.svelte`, nested utility-card stacks |
| Inline notice/recovery/status band | `NoticeBand` or `AlertBand` by contract | `src/web/lib/NoticeBand.svelte`, local alert panels |
| Short status label | `StatusPill` | ad hoc pill spans, state-colored metadata chips |
| Section heading | `SectionHeader` | local heading clusters with custom font sizes |
| Action row | `ActionBar`/`Row` plus governed `Button` | local flex rows with arbitrary gaps |
| Field/value data | `DefinitionList` or a governed data-row primitive | local label/value grids with custom weights |
| Empty/loading/error states | `NoticeBand` or a governed empty-state primitive | one-off empty cards |
| Modal/drawer frame | `Modal`/`SideDrawer` after contract review | local overlay geometry |

Package UI may keep internal implementation CSS, but it must also reduce its own
raw values over time. Raw rem padding, raw line heights, raw icon sizes, and
component-specific tone names are migration signals even when they live in
`packages/ui`.

## Surface Ownership

Design-system governance does not stop at component props. It also limits what
large surfaces are allowed to own.

Settings:

- Settings owns readiness, providers, coordinators, identity, operating profile,
  and explicit developer tools.
- Settings must not own facts, learning, re-intake, design intelligence,
  structural-map review, project-graph assignment flows, or raw lever browsing
  as first-class sections.
- Settings may show a compact readiness warning that links to a focused surface.

Project graph and structural map:

- `src/runtime/project-graph.ts`, `src/runtime/structural-map.ts`, and
  `src/runtime/state-machine.ts` are product-core concepts, not chopping-block
  candidates by default.
- Their UI must be focused. Project graph assignment/review belongs in a project
  structure/graph panel, not as another long branch inside `SettingsTab.svelte`.
- Structural-map owner questions route through the owner-input surface when they
  need discussion. The graph panel can show state and actions, but Thread owns
  conversations.

Thread and owner input:

- Thread owns conversation and clarification.
- Needs You owns alerts.
- Components must not duplicate the same owner decision as both a Thread turn,
  Settings card, Inbox item, and overview action.

## Surface Styling Rules

Surface-local CSS may do:

- layout glue specific to the surrounding route;
- component placement;
- responsive grid definition;
- one-off integration with browser APIs or Svelte transitions.

Surface-local CSS may not do:

- choose raw type sizes, weights, line heights, spacing, radii, shadows, z-index,
  or colors;
- define local cards, notices, status pills, headers, fields, tabs, buttons, or
  empty states when a primitive exists;
- add a new component vocabulary because nearby code is messy;
- nest cards inside cards;
- style page sections as floating cards;
- use viewport-scaled font sizes.

## Chopping-Block Criteria

A component, token, prop, style block, or UI surface branch is a deletion or
consolidation candidate when any of these are true:

1. It has the same job as a package primitive.
2. It uses a separate token family for a role the package tokens already name.
3. It exposes variant values that differ only cosmetically from existing values.
4. It exists for one surface but is copied or wanted by another surface.
5. It makes a parent surface own unrelated state, fetches, or business logic.
6. It requires users to understand implementation detail to make a simple
   product decision.
7. It cannot name its accessibility contract.
8. It lacks focused tests or deterministic scans but affects repeated UI.
9. It encodes sample-project vocabulary in a generic runtime or UI path.
10. It increases choices for agents without reducing choices for users.

## Required Agent Workflow

Before UI implementation:

1. Inventory existing package primitives, app-local wrappers, and token roles.
2. Decide whether the need is surface layout, an existing primitive use, a
   primitive extension, or a new primitive.
3. If a primitive extension is needed, update the component contract first.
4. If the need cannot be expressed with existing token roles, propose the new
   semantic role and deletion/migration path before using it.

During implementation:

1. Compose primitives and role tokens.
2. Keep large surfaces as shells that delegate state, fetches, and rendering to
   focused panels.
3. Avoid adding new local CSS classes for repeated treatments.
4. Migrate nearby duplicated treatment when practical inside scope.

Before completion:

1. Run the design-token/component audit once it exists.
2. Run focused UI tests for touched surfaces.
3. For visible changes, verify with the installed app and `stale:false` when the
   flow-audit surface is involved.
4. Record any remaining exception in the relevant audit or plan. Exceptions
   must name their owner and removal condition.

## Agent Harness Transfer

Guildhall should treat its own design-system cleanup as training data for the
agent harness it manages. A rule that catches cognitive overhead in Guildhall is
usually also useful in managed product work, provided it is expressed as a
portable diagnostic instead of a Guildhall-only preference.

Portable learnings:

- Token presence is not enough. Reviewers must check whether tokens have named
  roles, budgets, and replacement paths.
- Component reuse is not enough. Reviewers must check whether component variants
  have bounded vocabulary and documented meaning.
- Surface size is not only a file-size issue. Reviewers must check whether a
  surface owns unrelated state, fetches, routes, and decisions.
- Duplicate local primitives are architectural evidence, not just style drift.
- Domain-specific UI decisions should become project design-system facts or
  explicit local exceptions before workers copy them.

Managed-product reviewers should receive these as a design-governance packet
when a task touches UI, design-system files, component catalogs, or route-level
surfaces. The packet should name:

- existing token/component authorities;
- known duplicate primitive families;
- variant vocabulary already in use;
- raw styling and local-component risks found during refresh;
- review questions that decide whether to extend the design system or keep a
  local exception.

## Deterministic Checks To Maintain

The reduction plan should create and keep these checks:

- token scanner for raw font sizes, font weights, line heights, spacing, radii,
  z-index, shadows, old token families, negative letter spacing, and hardcoded
  colors in surfaces;
- primitive scanner for imports of deprecated local wrappers and duplicated
  local component classes;
- variant-budget scanner for component prop unions and exported variant arrays;
- generic-runtime scanner for sample-project vocabulary in generic runtime
  paths;
- Settings structure test proving `SettingsTab.svelte` is a small shell and does
  not own project graph, learning, re-intake, or design feedback state.

## Amendment Rule

Changing this constitution requires all of the following:

1. Name the user or product pressure that existing roles cannot express.
2. Name the new role, variant, or component contract.
3. Name the duplicate or old shape it replaces.
4. Add or update a deterministic check.
5. Update the cognitive-overhead reduction plan or the active flow-audit item if
   the change affects current reduction work.
