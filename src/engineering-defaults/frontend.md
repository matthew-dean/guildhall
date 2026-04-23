# Frontend standards
Design-system discipline. No one-off visual overrides.

## Type scale
- Define `--fs-0` through `--fs-5` on `:root`. Use these tokens everywhere.
- No inline `style="font-size: ..."`. No hardcoded `px`/`rem` font sizes in components.
- Define one body line-height (`--lh-body`, ~1.5) and one tighter heading line-height (`--lh-tight`, ~1.2).

## Spacing scale
- Define `--s-1` through `--s-6` on `:root`. Margins, paddings, gaps use tokens only.
- No inline `style="margin-top: ..."`. If you need a value twice, it is a token.

## Heading hierarchy
- Exactly one `<h1>` per page. `<h2>` for top-level sections. `<h3>` for sub-sections.
- Never pick a heading level for its visual size. Style via class, structure via tag.
- A card title is an `<h3>` or `<h4>` inside the page's section, not an `<h2>`.

## Color
- Use semantic tokens: `--text`, `--text-muted`, `--bg`, `--bg-raised`, `--border`, `--danger`, `--accent`.
- No raw hex/rgb in components. Add a token if the palette lacks it.
- Never signal state by color alone. Pair with icon, label, or shape.

## Accessibility
- Visible focus state on every interactive element. No `outline: none` without a replacement.
- Icon-only buttons have `aria-label`.
- Body text contrast ratio ≥ 4.5:1. Large text ≥ 3:1.
- Every interaction reachable by keyboard. Tab order matches visual order.
- Hit targets ≥ 32px on a side for pointer, ≥ 44px for touch.

## Components
- A component owns its layout internals. Callers control outer spacing via wrapper, not prop overrides.
- No prop named `style` or `className` passthrough on components that own visual identity.
