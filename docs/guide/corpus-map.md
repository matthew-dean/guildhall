---
title: Corpus Map
---

# Corpus Map

The Corpus Map is Guildhall’s compact index of a project. It helps agents
reuse the right code, component, helper, package, test pattern, and convention
without dumping the entire repo into every prompt.

It is Guildhall’s answer to a common agent failure: the worker sees one local
file, invents a local solution, and misses the shared abstraction that already
exists somewhere else.

## What it stores

Guildhall writes the shared map under `./.guildhall/` and keeps bulky refresh
history local:

| File | Purpose |
|---|---|
| `./.guildhall/codebase-map.yaml` | Current compact map. |
| `~/.guildhall/data/projects/<project-hash>/codebase-map/codebase-map.full.yaml` | Full local map snapshot when the committed map is compacted. |
| `~/.guildhall/data/projects/<project-hash>/codebase-map.history.jsonl` | Refresh history and why each refresh ran. |
| `~/.guildhall/data/projects/<project-hash>/codebase-map.stale.json` | Last refresh failure, if the map could not be rebuilt. |
| `./.guildhall/codebase-map.overrides.yaml` | Human or learned corrections layered over automatic discovery. |
| `./.guildhall/design-system.yaml` | Optional project design-system source summarized into the map. |

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

It does **not** store full source contents. Helpers still open source files when
they need evidence.

## How Guildhall builds it

The builder starts with a Git-aware file list:

1. Prefer `git ls-files --cached --others --exclude-standard`.
2. Fall back to a recursive walk when Git is not available.
3. Skip generated, binary, dependency, and noisy memory paths.
4. Skip command-shaped path fragments that may appear in agent notes or
   checkpoint metadata.
5. Fingerprint text files and classify them by path and extension.
6. Extract lightweight symbols and imports.
7. Group files into areas.
8. Detect reusable abstractions.
9. Summarize the project design system when `./.guildhall/design-system.yaml`
   exists.
10. Apply any overrides.
11. Save the map and append a history event.

The first refresh is a full build. Later refreshes can be partial.

Semantic enrichment is optional and explicit. A normal refresh builds the
deterministic map without spending model tokens. When you run a semantic
refresh, Guildhall first builds the deterministic map, then asks the
`contextIndexer` model to add purpose, current-truth notes, architecture areas,
canonical abstractions, risks, read-next guidance, and worker guidance. The
model output is validated as structured JSON and stored under the map's
`semantic` section.

Semantic refresh has a repair ladder. Guildhall first attempts strict parsing,
then deterministic cleanup for obvious JSON issues such as fenced output and
trailing commas. If the response still cannot parse, or if it parses but does
not match the required schema, Guildhall performs one repair pass with a fast
OpenAI-compatible model and asks it to preserve the substance while returning
valid schema-shaped JSON.

Guildhall also wires this into the normal agent lifecycle. If no map exists
when an agent context is being built, the context builder creates one lazily
from the task project or active worktree before rendering the prompt. After a
worker changes files and hands work forward, the orchestrator refreshes the map
from dirty files and checkpoint-touched files it can prove.

Manual refresh remains available for debugging, repair, or explicit control,
but normal projects do not need a "remember to build the map" chore. If refresh
fails, Guildhall keeps running and records stale status instead of blocking the
task.

## Partial refresh

Guildhall refreshes individual touched files when the project shape is stable.
A worker completion can pass the files it changed; Guildhall updates those
entries, recomputes affected areas and abstractions, and leaves unrelated
entries alone.

Some changes force a full rebuild because they can change how the whole project
fits together:

- `package.json`
- lockfiles
- workspace config
- TypeScript, Vite, Svelte, Vue, React, ESLint, or Prettier config
- `.gitignore`
- `AGENTS.md`
- `./guildhall.yaml`
- `./.guildhall/design-system.yaml`
- schema/version changes
- very large touched-file sets
- missing or corrupt previous maps

This keeps refreshes cheap during normal work while still avoiding stale
architecture guidance after project-wide changes.

## How Agents Use It

Before a worker edits, Guildhall can give it a small orientation note from the
map. A UI task, for example, might include this kind of nudge:

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
- Command buttons (./src/web/lib/Button.svelte)
  - Use when: a user triggers an action from a toolbar, form, panel, drawer, or wizard.
  - Avoid: local button padding, radius, neutral backgrounds, or one-off action styles.

Read next:
- ./src/web/lib/Button.svelte: Reuse Command buttons

Before editing, name the existing primitive, helper, package, design token,
component, or area you are extending.
```

That note is intentionally small. It points the worker toward the right
starting files and abstractions; it does not ask the model to trust the map
blindly.

## Evaluation ladder

Guildhall tests context-indexer models against a ladder rather than a single
repository. Each rung checks a different kind of project:

| Rung | Corpus shape | What it checks |
|---|---|---|
| 1 | Documentation-heavy planning | Can it summarize specs, decisions, and future architecture without inventing implementation details? |
| 2 | Small-to-medium codebase | Can it map real source structure, canonical modules, and verification entrypoints at practical cost? |
| 3 | Design-system reuse slice | Can it steer UI work toward shared primitives instead of another one-off button? |
| 4 | Hard architecture slice | Can it stay accurate in a deeper compiler/parser-style codebase? |

The first two rungs are deliberately different. One is mostly documentation,
so it is a product-intent test. The next is a real code-corpus test.

## CLI and Settings

You can rebuild the map manually:

```sh
guildhall corpus-map refresh [path]
```

You can also run the model-assisted semantic pass:

```sh
guildhall corpus-map refresh --semantic [path]
```

This uses the OpenAI-compatible provider configured in Guildhall and the
`contextIndexer` model assignment when present. If no explicit context-indexer
model is configured for that provider, Guildhall uses the current live-ladder
fallback for semantic enrichment.

The semantic pass is intentionally allowed to spend tokens. Guildhall derives a
generous completion budget from the compact Corpus Map prompt size, gives repair
passes their own larger budget because they include both raw output and map
context, and relies on schema plus usefulness checks to keep the saved map
compact. The goal is not to starve the context indexer. The goal is to avoid
runaway output while giving the model enough room to produce read-next guidance,
worker guidance, and risks that agents can actually use.

The project Settings screen also has a compact Codebase Map panel showing file,
area, abstraction, and design-system maturity counts plus the last build time.
The panel is deliberately quiet: useful when you need it, invisible when you
do not.

## Design-system guidance

The Corpus Map treats the design system as part of codebase orientation, not as
a separate aesthetic checklist. When `./.guildhall/design-system.yaml` exists,
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

- Specs can name the abstraction a task is expected to reuse.
- Workers can start from mapped files before broad exploration.
- Reviewers can reject parallel implementations when a mapped abstraction was
  ignored.
- UI workers can see whether a project already has tokens and primitives before
  adding local styles.
- Future runs can query the map instead of relearning the repo from scratch.

The goal is not a perfect static analysis database. The goal is a durable,
inspectable orientation layer that makes the right code easier to reuse than
the wrong code is to invent.
