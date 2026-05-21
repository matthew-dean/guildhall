---
title: In-UI help system
help_topic: web.help_system
help_summary: |
  The `<Help topic="...">` Svelte component shows a `?` icon with a tooltip
  and click-through modal. Content comes from the YAML frontmatter of
  matching docs pages — no duplicate source of truth.
---

# In-UI help system

The UI surfaces inline help via `<Help>`, a Svelte component that pairs each helpable concept in the UI with exactly one page in these docs.

## How it works

1. Each helpable page under `docs/` declares `help_topic: <id>` in its YAML frontmatter and a `help_summary:` multiline string with the short prose surfaced in the UI.
2. `scripts/extract-help-topics.mjs` walks `docs/**/*.md`, reads frontmatter, and writes `src/web/generated/help-topics.json` — a map `{ [topicId]: { title, summary, href } }`.
3. The UI imports that JSON bundle and `<Help topic="lever.reviewer_mode" />` looks up the topic and renders a `?` icon.
4. Clicking `?` opens a modal with the summary and an "Open full docs ↗" link pointing to the same page on this site.
5. `scripts/check-help-sync.mjs` runs in CI; it grep-scans `src/web/**` for `topic="..."` references and fails the build if any id is missing from the generated map.

## Using it

```svelte
<Help topic="lever.reviewer_mode" />

<!-- Inline variant with a visible label -->
<Help topic="lever.reviewer_mode" variant="inline" label="Reviewer mode" />
```

A missing topic renders a `?` in warning color and surfaces the missing-id message in the modal — you see it at dev time, and CI fails before merge.

## Naming conventions

| Prefix | Meaning |
|---|---|
| `lever.<name>` | A named lever. |
| `subsystem.<name>` | One of the `src/*` subsystems. |
| `web.<page>` | A web UI surface. |
| `guide.<topic>` | A concept introduced in the guide section. |

See the [`scripts/extract-help-topics.mjs`](https://github.com/anthropics/guildhall/blob/main/scripts/extract-help-topics.mjs) source for validation rules.
