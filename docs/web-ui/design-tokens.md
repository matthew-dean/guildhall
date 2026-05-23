---
title: Design tokens
help_topic: web.design_tokens
help_summary: |
  The UI uses CSS custom properties exclusively — colors, spacing, type
  scale, control sizes, radii, status stripes. Defined in ./src/web/tokens.css
  and mirrored in ./src/engineering-defaults/frontend.md.
---

# Design tokens

All UI styling uses CSS custom properties declared in `./src/web/tokens.css`. No component file contains hardcoded hex values, raw px sizes, or one-off radii — everything references a token.

## Token groups

### Colors (semantic)

| Token | Role |
|---|---|
| `--bg`, `--bg-base` | Page background |
| `--bg-raised` | Rails, sections, inset surfaces |
| `--bg-raised-2` | Hover / secondary button fill |
| `--bg-elevated` | Cards (one step brighter than raised) |
| `--border` | Default 1px separators |
| `--border-strong` | Card outline / stronger edge |
| `--accent` | Primary accent (#7c6df0) |
| `--accent-2` | Secondary accent (#4ecca3) |
| `--text-strong`, `--text`, `--text-readable`, `--text-soft`, `--text-muted` | Foreground intensity ladder |
| `--danger`, `--warn` | Status hues |

### Status stripes

`--stripe-danger`, `--stripe-warn`, `--stripe-ok`, `--stripe-accent`, `--stripe-neutral` — saturated colors for 3 px left borders on cards. Bodies stay neutral; stripe + chip do the work.

### Guild glass

`--glass-bg`, `--glass-bg-strong`, `--glass-border`, `--glass-blur`, `--glass-shadow`, and the `--glass-reflect-*` tokens define the glass panel treatment. Glass should be transparent over the dark app structure, with subtle etched edges and small reflected highlights. It should not change the component's size, padding, or border radius.

Use `--glass-inset-*` tokens for a section within a section: questions inside cards, source inspectors inside task drawers, and compact nested panes. Inset glass should feel quieter than the parent surface, use less white text, and rely on etched borders plus reflected highlights instead of a flat black box.

Strong controls emit light. Primary and agent actions use `--light-emitted-accent` or `--light-emitted-agent` so buttons feel active without turning cards into bright gradient blocks.

Use `--signal-warn-strong` for compact activity bars and high-signal warning marks where the older `--warn` amber reads too muted.

### Type scale

| Token | Size |
|---|---|
| `--fs-0` | 11 px |
| `--fs-1` | 12 px |
| `--fs-2` | 13 px |
| `--fs-3` | 14 px |
| `--fs-4` | 16 px |
| `--fs-5` | 20 px |

### Font stack

The product UI uses a dependable system UI stack: `system-ui`, Apple system fonts, Segoe UI, Helvetica Neue, Arial, then generic sans-serif. Do not put `ui-rounded` or rounded display fonts ahead of the stack; their punctuation metrics can make CSS ellipses look vertically misaligned in compact rows and buttons.

### Spacing

`--s-1` 4 px · `--s-2` 8 px · `--s-3` 12 px · `--s-4` 16 px · `--s-5` 24 px · `--s-6` 32 px.

### Controls & radii

- `--control-h` 26 px, `--control-pad-y` 4 px, `--control-pad-x` 10 px.
- `--r-1` 4 px, `--r-2` 6 px, `--r-3` 8 px.

## Authoring rules

- No raw hex/rgb in component styles.
- No raw px for font sizes or spacings.
- If you need a new color or size, add a token first and use it everywhere; don't one-off.

These rules are enforced culturally, not mechanically — but `./src/engineering-defaults/frontend.md` ships the guidelines into every agent's system prompt so workers know the conventions.
