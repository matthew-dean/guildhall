# Frontend standards
Design-system discipline. No one-off visual overrides.

For Guildhall product surfaces, pair these baseline rules with
`src/engineering-defaults/guildhall-ui.md`. That document covers the
user-facing hierarchy for headings, chips, counts, card anatomy, and guided
journey screens.

## Typography roles
- Use the shared text-role classes and `--gh-type-*` tokens from
  `packages/ui/src/text-role-definitions.js` and `src/web/tokens.css`.
- Do not define new `--fs-*` or `--lh-*` scales. Do not hardcode `px`/`rem`
  font sizes, raw line heights, or numeric font weights in product surfaces.
- Choose typography by semantic role before CSS: `display-title`, `page-title`,
  `section-title`, `panel-title`, `body`, `body-strong`, `row-title`,
  `row-title-current`, `meta`, `caption`, `eyebrow`, `history`, `action`,
  `state`, or `code`.
- `row-title` is for ordinary scan targets. `row-title-current` is for selected,
  current, or focused rows. Do not make every row title primary just because it
  is clickable.
- Weights have jobs: body for prose, medium for structured labels and ordinary
  row titles, strong for selected/current titles and controls, and emphasis only
  for rare urgent states or important numeric/status callouts.
- If a surface needs a new text role, token, or component variant, record the
  token or variant budget first: distinct communication need, reuse boundary,
  and what existing role or variant it replaces.
- Use the product system UI font stack from `src/web/tokens.css`. Do not
  introduce `ui-rounded` or rounded display fonts; they have caused visually
  off-center CSS ellipses in compact Guildhall controls.

## Spacing scale
- Define `--s-1` through `--s-6` on `:root`. Margins, paddings, gaps use tokens only.
- No inline `style="margin-top: ..."`. If you need a value twice, it is a token.

## Heading hierarchy
- Exactly one `<h1>` per page. `<h2>` for top-level sections. `<h3>` for sub-sections.
- Never pick a heading level for its visual size. Style via class, structure via tag.
- A card title is an `<h3>` or `<h4>` inside the page's section, not an `<h2>`.

## Color
- Use semantic tokens: `--text-strong`, `--text`, `--text-readable`,
  `--text-soft`, `--text-muted`, `--bg`, `--bg-raised`, `--border`,
  `--danger`, `--accent`.
- No raw hex/rgb in components. Add a token if the palette lacks it.
- Never signal state by color alone. Pair with icon, label, or shape.
- Do not make every primary line `--text-strong` or heavy bold. Reserve the
  brightest text for page/section titles, selected/current values, focused rows,
  primary actions, and important confirmations; use body/secondary/muted roles
  for ordinary rows, explanatory copy, helper labels, and nested surfaces.
- Glass is a surface treatment, not a layout change. Use `--glass-bg`,
  `--glass-border`, and `--glass-reflect-*` over existing radii, padding, and
  control sizes instead of inventing larger "glass" cards.
- Live `backdrop-filter` blur is opt-in. Use it for chrome and true overlays:
  sticky headers, rails, slide-over panels, drawers, popovers, tooltips, and
  modal shells. Do not put live blur on repeated content cards, dashboard
  panels, list items, avatar pips, question cards, or choice rows; those should
  keep glass color/border/shadow without a compositor-heavy backdrop layer.
- Use `--glass-inset-*` for "section within section" panes such as questions
  inside task cards or source inspectors inside drawers.
- Strong controls emit light with `--light-emitted-accent` or
  `--light-emitted-agent`; panels only catch subtle reflected light.
- Use `--signal-warn-strong` for compact activity bars or high-signal warning
  marks when standard `--warn` is too muted for the surrounding surface.

## Accessibility
- Visible focus state on every interactive element. No `outline: none` without a replacement.
- Icon-only buttons have `aria-label`.
- Body text contrast ratio ≥ 4.5:1. Large text ≥ 3:1.
- Every interaction reachable by keyboard. Tab order matches visual order.
- Hit targets ≥ 32px on a side for pointer, ≥ 44px for touch.

## Components
- A component owns its layout internals. Callers control outer spacing via wrapper, not prop overrides.
- No prop named `style` or `className` passthrough on components that own visual identity.
