# UI Component and Token Governance Audit

## Governing Constitution

This audit implements `internal/constitutions/design-system-governance.md`.
Any exception found here must name the constitutional rule it violates, the
owner, and the removal condition.

## Problem

Guildhall has several overlapping component families and token families. The
visible result is inconsistent density, typography, weight, card treatment,
notice treatment, and status language across project surfaces.

## Current Signals

- `src/web/tokens.css` owns old app-local `--fs-*`, `--s-*`, `--r-*`, and
  `--lh-*` scales while `packages/ui/src/styles.css` owns generated `--gh-*`
  scales.
- Typography needs a hierarchy pass, not only token renaming. Row titles,
  selected/current text, status chips, action labels, history/done states, and
  prose need distinct semantic roles so emphasis is not expressed by making
  every local surface bright and bold.
- App surfaces still use raw font weights such as `600`, `650`, `700`, and
  `800`.
- Some surfaces use viewport-based type sizing with `clamp(...)`.
- `src/web/lib/NoticeBand.svelte` overlaps with
  `packages/ui/src/components/NoticeBand.svelte`.
- `src/web/lib/Card.svelte` overlaps with
  `packages/ui/src/components/FrameCard.svelte`.
- Package UI now exposes named typography role tokens, but surface conversion is
  still open.

## Component Ownership Map

| Need | Canonical component | Non-canonical replacements |
| --- | --- | --- |
| Framed panel | `FrameCard` | `src/web/lib/Card.svelte`, local `.card` classes |
| Notice/status band | `NoticeBand` or `AlertBand` by contract | `src/web/lib/NoticeBand.svelte`, local alert panels |
| Status chip | `StatusPill` | state-colored `Chip`, ad hoc pill spans |
| Section heading | `SectionHeader` | local `.head h2`, raw heading blocks |
| Action row | `ActionBar` or `Row` with `Button` | local flex rows with one-off gaps |
| Field/value data | `DefinitionList` or a governed data-row primitive | local label/value grids with custom weights |
| Empty/loading/error state | `NoticeBand` | one-off empty cards |

## Typography Rules

- Use text roles, not raw font-size values.
- `body` is the default.
- `row-title` is for ordinary unselected object titles in lists. It should scan
  clearly without looking selected.
- `row-title-current` is for selected/current object titles only.
- `body-strong` is for labels inside dense operational UI, not a substitute for
  selected/current state.
- `history` is for completed, archived, stale, unavailable, or past-tense text.
- `eyebrow` is uppercase or compact metadata only.
- `action` is for control labels.
- `state` is for short status words/counts paired with an explicit tone.
- `panel-title` is the largest title allowed inside cards or panels.
- `page-title` is only for top-level pages.
- Strong weight is `--gh-type-weight-strong`.
- Emphasis weight is rare and must be named by a component contract.
- Letter spacing defaults to `0`; negative letter spacing is not allowed.
- Primary text color is reserved for selected/current objects, real headings,
  active focus, and action-priority labels. Ordinary row titles should use the
  secondary text role, not near-white primary.

## Spacing and Radius Rules

- Surface code uses `--gh-space-*`, `--gh-radius-*`, and component padding
  tokens.
- Local `2px`, `7px`, `10px`, `14px`, and arbitrary rem padding are not allowed
  in surface styles.
- Cards are not nested inside cards.
- Radius stays at 8px or below unless a canonical component owns the exception.

## Variant Budget

Every primitive must name its variant axes and keep them bounded. New variants
require updating `packages/ui/src/component-constitution.ts`, tests, and this
audit.

Current shared axes:

| Axis | Values | Budget |
| --- | --- | --- |
| `tone` | `neutral`, `info`, `ok`, `warn`, `danger`, `accent` | Component layer only |
| `density` | `dense`, `compact`, `comfortable` | Three values |
| `padding` | `compact`, `default`, `roomy` | Frame-like components only |
| `mode` | `operator`, `display` | Display mode is rare |
| `emphasis` | `quiet`, `default`, `strong` | Strong is state/action priority |
| `size` | `sm`, `md`, `icon` | Controls only |

Deprecated aliases:

- `regular` density. Use `comfortable`.
- `attention` tone. Use `warn`.
- `default` tone. Use `neutral`.

## Deletion List

- Remove `src/web/lib/NoticeBand.svelte` after callers move to package
  `NoticeBand` or `AlertBand`.
- Remove or wrap `src/web/lib/Card.svelte` after callers move to `FrameCard`.
- Fold local card, notice, status-row, and pill classes into canonical
  primitives as surfaces are touched.
- Replace app-local `--fs-*`, `--s-*`, `--r-*`, and `--lh-*` usage with named
  `--gh-*` roles during surface conversion.

## Deterministic Guardrail

`pnpm lint:design` runs `scripts/design-token-audit.mjs`. The scanner catches:

- unmanaged `font-size`, `font-weight`, `line-height`, spacing, radius, z-index,
  and shadow declarations outside token definition files;
- negative letter spacing;
- legacy app token references such as `--fs-*`, `--s-*`, `--r-*`, and `--lh-*`;
- scale-number type tokens in app surfaces;
- duplicate app-local primitives that overlap with package UI.

This scanner is an advisory hardening gate. It identifies likely entropy; it
does not replace the constitution or the reviewer obligation to decide whether
to extend a primitive, create a temporary wrapper, or delete a duplicate.

The current repo-wide historical debt is recorded in
`internal/audits/2026-06-01-design-token-baseline.json`. The baseline is a
budget, not an approval: existing signatures are allowed only up to their
committed per-file counts, and `pnpm lint:design` fails when a file introduces a
new signature or increases an old signature count. Rebuild the baseline only
when intentionally accepting a reviewed burn-down checkpoint with evidence in
this audit or the Task 7 plan.

## Open Exceptions

| Owner | Violation | Removal condition |
| --- | --- | --- |
| `src/web/tokens.css` | Legacy app-local token families remain as aliases during migration. | Remove after touched surfaces use `--gh-*` role tokens. |
| `src/web/lib/NoticeBand.svelte` | Duplicate notice primitive. | Move callers to package `NoticeBand`/`AlertBand`, then delete or convert to a temporary compat wrapper. |
| `src/web/lib/Card.svelte` | Duplicate framed panel primitive. | Move callers to `FrameCard`, then delete or convert to a temporary compat wrapper. |
| App surfaces named in Task 7 Step 8 | Raw typography, spacing, radius, and local component treatments remain. | Complete the surface conversion step in the cognitive-overhead reduction plan. |
