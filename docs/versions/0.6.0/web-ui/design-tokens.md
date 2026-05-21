---
title: Design tokens
help_topic: web.design_tokens
help_summary: |
  The UI uses CSS custom properties exclusively — colors, spacing, type
  scale, control sizes, radii, status stripes. Defined in src/web/tokens.css
  and mirrored in src/engineering-defaults/frontend.md.
---

# Design tokens

All UI styling uses CSS custom properties declared in `src/web/tokens.css`. No component file contains hardcoded hex values, raw px sizes, or one-off radii — everything references a token.

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
| `--text`, `--text-muted` | Foreground, secondary |
| `--danger`, `--warn` | Status hues |

### Status stripes

`--stripe-danger`, `--stripe-warn`, `--stripe-ok`, `--stripe-accent`, `--stripe-neutral` — saturated colors for 3 px left borders on cards. Bodies stay neutral; stripe + chip do the work.

### Type scale

| Token | Size |
|---|---|
| `--fs-0` | 11 px |
| `--fs-1` | 12 px |
| `--fs-2` | 13 px |
| `--fs-3` | 14 px |
| `--fs-4` | 16 px |
| `--fs-5` | 20 px |

### Spacing

`--s-1` 4 px · `--s-2` 8 px · `--s-3` 12 px · `--s-4` 16 px · `--s-5` 24 px · `--s-6` 32 px.

### Controls & radii

- `--control-h` 26 px, `--control-pad-y` 4 px, `--control-pad-x` 10 px.
- `--r-1` 4 px, `--r-2` 6 px, `--r-3` 8 px.

## Authoring rules

- No raw hex/rgb in component styles.
- No raw px for font sizes or spacings.
- If you need a new color or size, add a token first and use it everywhere; don't one-off.

These rules are enforced culturally, not mechanically — but `src/engineering-defaults/frontend.md` ships the guidelines into every agent's system prompt so workers know the conventions.
