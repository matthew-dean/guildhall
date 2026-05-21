---
title: Corpus Map
---

# Corpus Map

The Corpus Map is Guildhall’s compact index of a project. It helps agents reuse
the right code, component, helper, package, test pattern, and convention without
dumping the entire repo into every prompt.

It is Guildhall’s answer to a common agent failure: the worker sees one local
file, invents a local solution, and misses the shared abstraction that already
exists somewhere else.

## What it stores

Guildhall writes the map under `memory/`:

| File | Purpose |
|---|---|
| `memory/codebase-map.yaml` | Current compact map. |
| `memory/codebase-map.history.jsonl` | Refresh history and why each refresh ran. |
| `memory/codebase-map.stale.json` | Last refresh failure, if the map could not be rebuilt. |
| `memory/codebase-map.overrides.yaml` | Human or learned corrections layered over automatic discovery. |
| `memory/design-system.yaml` | Optional project design-system source summarized into the map. |

The map contains:

- file fingerprints: path, size, modified time, SHA-256
- language and file kind
- exported symbols and imports
- short file summaries
- owned areas such as runtime, web UI, agents, tools, docs, and config
- canonical files for each area
- known abstractions such as shared UI controls or runtime helpers
- design-system token counts, primitives, component files, maturity, and reuse
  recommendations when a project design system exists
- suggested verification commands

It does **not** store full source contents. Agents still open source files when
they need evidence.

## How Guildhall builds it

The builder starts with a Git-aware file list:

1. Prefer `git ls-files --cached --others --exclude-standard`.
2. Fall back to a recursive walk when Git is not available.
3. Skip generated, binary, dependency, and noisy memory paths.
4. Fingerprint text files and classify them by path and extension.
5. Extract lightweight symbols and imports.
6. Group files into areas.
7. Detect reusable abstractions.
8. Summarize the project design system when `memory/design-system.yaml`
   exists.
9. Apply any overrides.
10. Save the map and append a history event.

The first refresh is a full build. Later refreshes can be partial.

## Partial refresh

Guildhall refreshes individual touched files when the project shape is stable.
A worker completion can pass the files it changed; Guildhall updates those
entries, recomputes affected areas and abstractions, and leaves unrelated
entries alone.

Some changes force a full rebuild because they can change how the whole project
should be interpreted:

- `package.json`
- lockfiles
- workspace config
- TypeScript, Vite, Svelte, Vue, React, ESLint, or Prettier config
- `.gitignore`
- `AGENTS.md`
- `guildhall.yaml`
- `memory/design-system.yaml`
- schema/version changes
- very large touched-file sets
- missing or corrupt previous maps

This keeps refreshes cheap during normal work while still avoiding stale
architecture guidance after project-wide changes.

## How agents use it

The context builder turns the map into a small prompt block:

```md
## Corpus Map

Project: Local project with indexed files across TypeScript and Svelte.

Design system:
- Maturity: thin, approved
- Tokens: color 8, spacing 6, typography 4, radius 3, shadow 2
- Primitives: Button, Select, FrameCard
- UI surface area is larger than the captured token/primitive set; prefer extending the design system when a second repeated treatment appears.

Mapped area:
- Web UI: shared controls, surfaces, and UI conventions.

Reuse / Extend:
- Command buttons (src/web/lib/Button.svelte)
  - Use when: a user triggers an action from a toolbar, form, panel, drawer, or wizard.
  - Avoid: local button padding, radius, neutral backgrounds, or one-off action styles.

Read next:
- src/web/lib/Button.svelte: Reuse Command buttons

Corpus fit required: before editing, name the existing primitive, helper,
package, design token, component, or area you are extending.
```

That block is intentionally small. It points the agent toward the right
starting files and abstractions; it does not ask the model to trust the map
blindly.

## CLI and Settings

You can rebuild the map manually:

```sh
guildhall corpus-map refresh [path]
```

The project Settings screen also has a compact Codebase Map panel showing file,
area, abstraction, and design-system maturity counts plus the last build time.
The panel is meant to be quiet. It is there when you need it, not another
dashboard you must babysit.

## Design-system guidance

The Corpus Map treats the design system as part of codebase orientation, not as
a separate aesthetic checklist. When `memory/design-system.yaml` exists,
Guildhall records:

- counts for color, spacing, typography, radius, and shadow tokens
- documented primitives and their intended usage
- nearby component files that look like UI primitives
- whether the design system has been approved
- a maturity rating: `absent`, `thin`, `emerging`, or `established`
- recommendations for reuse or just-in-time systemization

This helps agents avoid the pattern where every screen invents its own button,
card, badge, spacing, or color treatment. It also keeps the system from
becoming ceremony for small projects. A thin or absent design system is not an
automatic mandate to pause all work; it is a prompt to ask whether repetition
has become stable enough that a shared token or primitive would now reduce
future maintenance.

## Why this matters

Corpus Map support lets Guildhall steer workers away from one-off
solutionizing:

- Specs can name the abstraction a task should reuse.
- Workers can start from mapped files before broad exploration.
- Reviewers can reject parallel implementations when a mapped abstraction was
  ignored.
- UI workers can see whether a project already has tokens and primitives before
  adding local styles.
- Future agents can query the map instead of relearning the repo from scratch.

The goal is not a perfect static analysis database. The goal is a durable,
inspectable orientation layer that makes the right code easier to reuse than
the wrong code is to invent.
