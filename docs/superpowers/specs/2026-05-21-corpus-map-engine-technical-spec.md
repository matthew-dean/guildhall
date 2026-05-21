# Corpus Map Engine Technical Specification

## Status

Implementation specification for the Guildhall 0.7.0 Corpus Map MVP.

## Purpose

Guildhall workers need Cody-style context retrieval without inheriting Cody as a
runtime dependency. The Corpus Map engine packages that philosophy as a
Guildhall-native module: index the repo locally, summarize the architecture,
name canonical abstractions, retrieve the smallest useful context slice, and
make workers/reviewers accountable for reuse before edits happen.

The first implementation is an internal module exposed as `@guildhall/corpus-map`.
It should be shaped like a future npm package, but it may live under `src/` for
0.7.0 so it is bundled with the current CLI.

## Design Thesis

Sourcegraph/Cody asks: "What code context is relevant to this prompt?"

Guildhall asks a stricter construction question:

> What existing abstractions, files, conventions, tests, and constraints must
> this worker respect before editing?

That means the map is not only a search index. It is an agent safety and reuse
contract.

## Non-Goals

- no vector database in the MVP
- no full Sourcegraph/Cody dependency
- no CodeQL/Kythe daemon
- no full language-server process
- no raw source-content dumping into worker prompts
- no user-required map curation before Guildhall can run

## Artifacts

All artifacts are project-local and live in the project `memory/` directory.

- `memory/codebase-map.yaml`: current generated map plus applied overrides.
- `memory/codebase-map.history.jsonl`: append-only refresh history.
- `memory/codebase-map.stale.json`: optional stale/error marker.
- `memory/codebase-map.overrides.yaml`: optional human/reviewer corrections.
- `memory/design-system.yaml`: project-scoped design-system source summarized
  into the map when present.

Human overrides always win. Refresh must never overwrite the overrides file.

## Module Boundary

Internal module path:

- `src/corpus-map/index.ts`

Future package name:

- `@guildhall/corpus-map`

The module owns:

- file discovery
- file fingerprinting
- lightweight source classification
- symbol/component extraction
- area and abstraction summarization
- durable map read/write
- partial refresh
- query/ranking
- worker context packet rendering
- history/stale-state persistence

Guildhall runtime owns:

- when to refresh
- when to inject a context packet
- how to present status in Settings
- how reviewers enforce the corpus-fit contract

## Public API

```ts
buildCodebaseMap(input: BuildCodebaseMapInput): Promise<CodebaseMap>
refreshCodebaseMap(input: RefreshCodebaseMapInput): Promise<RefreshCodebaseMapResult>
loadCodebaseMap(memoryDir: string): Promise<CodebaseMap | null>
saveCodebaseMap(memoryDir: string, map: CodebaseMap): Promise<void>
queryCodebaseMap(map: CodebaseMap, query: CodebaseMapQuery): CodebaseMapQueryResult
findExistingAbstraction(map: CodebaseMap, intent: string): CorpusAbstractionMatch[]
buildWorkerCorpusContext(map: CodebaseMap, task: CorpusTaskContext, opts?: ContextBudgetOptions): string
recordCorpusOverride(memoryDir: string, note: CorpusOverrideNote): Promise<void>
```

The MVP may implement `recordCorpusOverride` as structured append/merge without a
rich UI. The important contract is that generated refreshes preserve user and
reviewer corrections.

## Data Model

```ts
interface CodebaseMap {
  version: 1
  generatedAt: string
  project: {
    root: string
    summary: string
    languages: string[]
    packageManagers: string[]
    primaryFrameworks: string[]
  }
  files: Record<string, CorpusFileEntry>
  entrypoints: CorpusEntrypoint[]
  areas: CorpusArea[]
  abstractions: CorpusAbstraction[]
  designSystem?: CorpusDesignSystemSummary
  verification: { commands: string[] }
  overrides?: CorpusOverrides
}

interface CorpusFileEntry {
  path: string
  mtimeMs: number
  size: number
  sha256: string
  language: string
  kind: 'source' | 'test' | 'doc' | 'config' | 'manifest' | 'style' | 'unknown'
  areaIds: string[]
  symbols: string[]
  imports: string[]
  summary: string
}

interface CorpusDesignSystemSummary {
  sourcePath?: string
  revision?: number
  approved: boolean
  tokenCounts: {
    color: number
    spacing: number
    typography: number
    radius: number
    shadow: number
  }
  tokenSamples: string[]
  primitives: Array<{ name: string; usage: string }>
  componentFiles: string[]
  maturity: 'absent' | 'thin' | 'emerging' | 'established'
  recommendations: string[]
}
```

The map intentionally stores summaries and references, not full file contents.

## Design-system summary

The Corpus Map treats design-system knowledge as codebase orientation. UI
workers need to know whether a project already has approved tokens and
component language before they invent local controls.

When `memory/design-system.yaml` exists, refresh reads it through the
`DesignSystem` schema and stores a compact summary:

- token counts by category: color, spacing, typography, radius, shadow
- a small sample of named token values for orientation
- documented primitives with usage summaries
- candidate component files under common UI locations such as `lib`,
  `components`, and `ui`
- approval state and revision
- maturity: `absent`, `thin`, `emerging`, or `established`
- recommendations for reuse and just-in-time systemization

If the design-system file is missing but the repo has several UI component
files, the map should still record an `absent` design-system summary. That lets
workers and reviewers see the risk without requiring every small project to
author design-system documents up front.

Maturity is intentionally heuristic:

- `absent`: no token/primitives source is available
- `thin`: the UI surface is larger than the captured token/primitive set
- `emerging`: some tokens or primitives exist, but not enough to be binding for
  most UI work
- `established`: enough tokens and primitives exist that UI work should strongly
  prefer extension over local invention

Recommendations are advisory, not automatic blockers. The agent contract is
just-in-time systemization: when the same button, card, color, radius, spacing,
interaction, or component idea appears a second time, the agent should consider
a shared token or primitive. It should not expand the design system for a
one-off detail that has not proven stable.

## Discovery Strategy

Use cheap deterministic discovery first:

1. `git ls-files --cached --others --exclude-standard`
2. fallback recursive walk if the project is not a git repo
3. exclude `.git`, `node_modules`, `dist`, `build`, `coverage`, generated
   snapshots, logs, and `.guildhall`
4. filter command-shaped path fragments such as package-manager invocations so
   agent notes and checkpoint commands cannot become fake indexed files

The MVP indexes:

- package manifests and workspace files
- `README*`, `AGENTS.md`, architecture docs
- source files in common app/runtime directories
- Svelte/Vue/React component filenames and obvious props/exports
- TypeScript/JavaScript exports and imports via regex heuristics
- tests and common verification scripts
- shared UI primitives and tokens
- schemas, routes, CLI/runtime entrypoints, persistence modules

Later versions may plug in tree-sitter, ctags, SCIP/LSP, Zoekt, or Sourcegraph
as stronger backends behind the same API.

## Partial Refresh

The map behaves like a small build system. Every file entry has a fingerprint:

- `mtimeMs`
- `size`
- `sha256`

Refresh inputs:

```ts
interface RefreshCodebaseMapInput {
  projectRoot: string
  memoryDir: string
  touchedFiles?: string[]
  reason: 'manual' | 'worker-completion' | 'setup' | 'workspace-import' | 'watcher' | 'fallback'
  now?: Date
}
```

Refresh levels:

| Level | Trigger | Work |
| --- | --- | --- |
| file | touched files changed | re-fingerprint, classify, summarize changed files |
| area | changed file belongs to an area | recompute area summaries/conventions |
| abstraction | changed file is canonical/related | recompute abstraction guidance |
| full | manifests/config/root shape changed or too many changes | rebuild from file census |

Force full refresh when touched files include:

- `package.json`, lockfiles, workspace config
- `tsconfig`, Vite/Svelte/Vue/React config
- `.gitignore`
- `AGENTS.md`
- `guildhall.yaml`
- `memory/design-system.yaml`
- codebase-map schema version change
- more than 100 touched files
- missing/corrupt prior map

Partial refresh algorithm:

1. Load existing map.
2. Normalize touched paths relative to `projectRoot`.
3. If full refresh is required, rebuild.
4. Otherwise, remove deleted touched files.
5. Re-index changed touched files.
6. Preserve untouched file entries.
7. Recompute `areas`, `abstractions`, `entrypoints`, design-system summary, and
   verification commands from current file entries.
8. Apply overrides.
9. Save map.
10. Append a history event listing changed files, refresh mode, and affected
    areas/abstractions.

## Relevance Ranking

Query ranking is deterministic and explainable.

Signals:

- exact path match
- path segment match
- symbol match
- area match
- abstraction title/use/avoid match
- language/kind match
- token overlap with title, description, acceptance criteria, and likely files

The result returns:

- matched files
- matched areas
- matched abstractions
- read-next files
- explanation lines

The query API should prefer canonical abstractions before leaf implementation
files. Example: `Button.svelte`, `StatusButton.svelte`, and tokens before a
surface-specific toolbar component.

## Worker Context Packet

`buildWorkerCorpusContext` renders a markdown block capped by budget.

Default budget:

- target: 1,500 to 4,000 characters
- hard cap: 8,000 characters
- read-next files: 3 to 8

Required sections:

```markdown
## Corpus Map

Project: <summary>

Design system:
- Maturity: <absent/thin/emerging/established>, <approved/not approved>
- Tokens: color <n>, spacing <n>, typography <n>, radius <n>, shadow <n>
- Primitives: <top primitive names, when any>
- <top reuse/systemization recommendation>

Mapped area: <area or "no known area">

Reuse / Extend:
- <canonical abstraction guidance or explicit "no known abstraction found">

Likely files:
- <path> — <summary>

Read next:
- <path> — <reason>

Corpus fit required:
- Name the area you used.
- Name the abstraction, design token, or component you reused, extended, or
  intentionally did not use.
- Name supporting files read before editing.
```

If no map exists, context builder should create it lazily from the task project
or active worktree, then render the block from that freshly built map. If that
setup refresh fails, context builder should fail closed: omit the block or
include a short "Corpus map missing" note when the task is likely to need repo
structure.

## Agent Contracts

Spec Agent:

- include a `Reuse / Extend` section when the map has relevant guidance
- explicitly say when the map is absent/stale

Worker Agent:

- before editing, identify mapped area, likely files, reused abstraction, and
  supporting context read
- for UI work, identify the existing token/component/primitive path, or explain
  why a just-in-time design-system addition is now justified
- avoid broad repo spelunking when the map gives focused read-next files
- treat second similar concept as an abstraction decision

Reviewer Agent:

- check whether the worker used the map slice
- reject local one-off helpers/components/styles when a canonical abstraction
  exists
- reject ad hoc UI treatment when approved design-system tokens/primitives
  cover the need
- accept a new primitive only when the worker explains the repeated concept and
  why the maintenance benefit now outweighs the overhead
- record a correction when the map is wrong or stale

Worker self-critique must include:

```text
Corpus fit:
- Area: <mapped area>
- Reused abstraction: <file/symbol or "none found">
- Design-system fit: <token/primitive reused, new shared primitive, local-only because...>
- Supporting context read: <file(s)>
- New abstraction decision: <reuse / extend / add shared primitive / keep local because...>
```

## Runtime Integration

MVP integration points:

- `buildContext` loads `memory/codebase-map.yaml`; when the map is missing, it
  runs a setup refresh from the task project or active worktree before injecting
  the compact packet.
- Orchestrator refreshes after worker completion using dirty files and
  checkpoint-touched files where available.
- `guildhall corpus-map refresh [path]` refreshes the current or supplied
  project.
- `GET /api/project/codebase-map/status` returns map status for Settings.
- `POST /api/project/codebase-map/refresh` triggers manual refresh.
- Settings -> Advanced shows a read-only Codebase Map panel with last refresh,
  file/area/abstraction counts, design-system maturity, stale state, and a
  refresh action.

## Failure Handling

Index failures must not block normal Guildhall work.

On failure:

- keep the previous map
- write `codebase-map.stale.json`
- append a failed history event
- inject a quiet stale warning only when context would have used the map
- surface status in Settings

## Acceptance Criteria

1. A project can generate `memory/codebase-map.yaml`.
2. Refresh preserves human overrides.
3. Partial refresh re-indexes touched files without rescanning unchanged file
   contents.
4. Manifest/config changes force a full refresh.
5. Design-system changes force a full refresh and update the design-system
   summary.
6. Querying for "button", "provider settings", or a path returns canonical
   files before leaf files in Guildhall itself.
7. `buildContext` creates a missing map lazily and injects a compact Corpus Map
   block in the same context pass.
8. Worker completion refreshes the map from touched-file evidence and records a
   `worker-completion` history event.
9. Worker/spec/reviewer prompts include corpus-fit requirements.
10. Settings shows map status and supports manual refresh.
11. Unit tests cover discovery, command-shaped path filtering, partial refresh,
    design-system summarization, query ranking, context budget, missing-map
    setup, and worker-completion refresh behavior.
