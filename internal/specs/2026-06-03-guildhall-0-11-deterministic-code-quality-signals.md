# Guildhall 0.11.0 Deterministic Code Quality Signals

**Status:** Proposed 0.11.0 internal spec
**Date:** 2026-06-03
**Audience:** Guildhall runtime, review, and UI-governance implementation work
**Related:** `internal/constitutions/design-system-governance.md`,
`internal/audits/2026-06-01-ui-component-token-governance.md`,
`internal/plans/archive/2026-06-02-guildhall-0-11-implementation-tracker.md`,
`internal/plans/archive/2026-06-03-guildhall-0-11-deterministic-code-quality-implementation-plan.md`

## Problem

LLM agents keep solving local code problems as if they are the first code ever
written. In UI work this shows up as fresh font sizes, line heights, color
values, weights, card treatments, layout recipes, and copy-pasted component
branches. The same failure exists outside UI: agents create oversized files,
branchy functions, duplicated business logic, unowned abstractions, accidental
cycles, hidden dead code, and local policy forks.

Guildhall should not try to fix this with better scolding. It should collect
deterministic signals before, during, and after work, then use those signals to
shape tasks, review outputs, block clear regressions, and ask for owner judgment
only where software cannot decide the tradeoff.

## Principle

Deterministic tools are evidence, not taste.

They are excellent at answering:

- Did this change add a raw style value?
- Did this file cross a size or complexity budget?
- Did this module import through a forbidden boundary?
- Did duplicated code exceed the configured threshold?
- Did a data-bound surface create UI styling instead of composing primitives?
- Did a new shared abstraction appear with only one caller?

They are weaker at answering:

- Is this abstraction premature or just early?
- Is this duplication intentional because the domains are about to diverge?
- Is this component large because it owns one complex job or because it owns
  five unrelated jobs?
- Is this UI treatment genuinely new semantics or just visual drift?

Guildhall should therefore separate three outcomes:

| Outcome | Meaning | Product behavior |
| --- | --- | --- |
| Hard gate | The finding is almost always wrong in this repo. | Block the run or PR until fixed or explicitly waived. |
| Review signal | The finding may be valid, but needs judgment. | Include it in reviewer packets and task evidence. |
| Trend metric | One finding is not decisive, but drift matters. | Track by project, release, component, and agent. |

## Current Guildhall Baseline

Guildhall already has three useful seeds:

- `pnpm lint:design` runs `scripts/design-token-audit.mjs`, which blocks new or
  increased raw typography, spacing, radius, shadow, z-index, legacy-token, and
  duplicate-primitive signatures against
  `internal/audits/2026-06-01-design-token-baseline.json`.
- `pnpm lint:reductions` runs `scripts/reduction-guardrails.mjs`, which blocks a
  small set of known runtime regression shapes.
- `pnpm lint:deps` runs dependency-cruiser over `src`, catching runtime-value
  cycles and cross-module relative imports.

0.11 should turn these into a broader analyzer registry rather than one more
pile of bespoke scripts.

## Guidelines Before Tools

A tool finding is worthless until Guildhall knows which guideline it is trying
to protect. A copy/paste detector by itself only says "these tokens are
similar." It does not know whether similarity is dangerous shared knowledge,
healthy independent duplication, a fixture, generated code, or a deliberate
local fork that should stay local.

0.11 should therefore encode guideline cards before analyzer cards.

```ts
type QualityGuideline = {
  id: string
  principle: string
  why: string
  goodWhen: string[]
  badWhen: string[]
  deterministicSignals: string[]
  likelyTools: string[]
  defaultOutcome: 'hard-gate' | 'review-signal' | 'trend'
}
```

The guideline decides what the signal means. The tool only supplies evidence.

## Durable Quality Guidelines

### Guideline 1: One Reason To Change Beats One Shape To Share

**Principle:** Code should be grouped by the reason it changes, not merely by
the fact that it currently looks alike.

**Why:** A shared abstraction couples every caller to one future. That is good
when callers represent the same domain rule, policy, or visual role. It is bad
when two features only happen to have the same shape today but will change for
different business, product, platform, or UX reasons.

**Good guideline:** Duplicate code is welcome when the duplicated blocks serve
different reasons to change, are still discovering their shape, are cheaper to
read locally than to route through a weak abstraction, or are separated by a
boundary where coupling would be worse than repetition.

**Bad guideline:** Copy/paste is not welcome when it duplicates business rules,
state transitions, validation policy, design-system roles, security checks,
serialization formats, generated protocol handling, or owner-facing copy that
must stay consistent.

**Signals worth surfacing:**

- duplicated blocks where both copies import the same domain types;
- duplicated conditions over the same state-machine or task fields;
- duplicated CSS declarations that create the same visual role;
- duplicated copy strings in product surfaces;
- duplicated code across unrelated directories where the surrounding imports
  and state fields suggest the same reason to change;
- duplication with divergence: copies that started identical and now differ by
  small branches or magic values.

**Review question:** "Do these copies change for the same reason?" If yes,
extract. If no, leave them duplicated and, if needed, document the divergence.

### Guideline 2: Abstractions Need A Contract, Not Just Callers

**Principle:** An abstraction is justified when it names a stable domain
contract, reduces cognitive load, or protects a boundary. It is not justified
because two snippets are similar.

**Why:** Premature abstractions move complexity into indirection. The first
wrong abstraction often looks tidy, then every new caller adds options,
conditionals, or naming lies until the abstraction becomes harder to change
than the duplication it replaced.

**Good guideline:** Extract when there is a stable name, a clear owner, at least
two callers with the same reason to change, a contract that can be tested, and
no widening of variant/option axes beyond the owned job.

**Bad guideline:** Do not extract into `utils`, `helpers`, `common`, `shared`,
`base`, or broad UI primitives unless the abstraction can say what it owns and
what it refuses to own.

**Signals worth surfacing:**

- new exported helper/component with one production caller;
- shared module names like `utils`, `helpers`, `common`, `shared`, `base`, or
  `misc`;
- helpers whose names describe implementation mechanics instead of domain jobs;
- primitive props named `variant`, `kind`, or `mode` without a governed value
  budget;
- abstractions whose caller count rises alongside branch count;
- abstractions that import from the feature layers they claim to generalize.

**Review question:** "What invariant does this abstraction protect?" If the
answer is "less code," send it back.

### Guideline 3: Namespaces Should Explain Ownership

**Principle:** Packages, modules, files, and components should make ownership
obvious from the import site.

**Why:** Good names reduce the amount of code a reader must load. Go's package
naming guidance is especially useful here: a package name gives context to its
exported names and helps maintainers decide what belongs. Python's "explicit is
better than implicit" and "namespaces are one honking great idea" point in the
same direction: names should reveal responsibility instead of hiding it behind
generic buckets.

**Good guideline:** Prefer domain nouns and product roles over generic buckets.
The import should read like a sentence about the domain: `projectGraph`,
`ownerInput`, `boundedChat`, `FrameCard`, `NoticeBand`.

**Bad guideline:** Avoid generic ownership names when they accumulate unrelated
concepts or force import aliases to become readable.

**Signals worth surfacing:**

- directories or packages named `utils`, `helpers`, `common`, `shared`, `base`,
  `models`, or `types` with many unrelated exports;
- import aliases used to rescue unclear names;
- modules with high fan-in and mixed outgoing dependencies;
- files exporting many unrelated nouns;
- barrel files that create cycles or hide boundary crossings.

**Review question:** "Could a reader predict what belongs here without opening
the file?"

### Guideline 4: Boundaries Should Be Directional

**Principle:** Dependencies should point from specific product surfaces toward
shared contracts, not from shared code back into features.

**Why:** Directional boundaries keep reuse honest. A runtime core that imports a
surface, a shared component that imports a feature store, or a data model that
imports UI copy has stopped being shared infrastructure and become a knot.

**Good guideline:** Use explicit module layers, public entry points, and
state-machine transition helpers. A lower-level package may define contracts; a
higher-level surface may compose them.

**Bad guideline:** Do not let convenience imports, barrel files, or relative
cross-module imports erase ownership.

**Signals worth surfacing:**

- dependency cycles;
- cross-module relative imports;
- shared packages importing feature or surface paths;
- data modules importing UI components or browser-only code;
- runtime modules importing sample-project vocabulary;
- task/state writes that bypass transition helpers.

**Review question:** "Did this dependency make the lower layer know about the
higher layer?"

### Guideline 5: Types And State Should Make Invalid States Hard

**Principle:** Prefer explicit types, schemas, and state-machine transitions to
loose data and convention.

**Why:** Rust's API guidance is crisp here: choose argument types that rule out
bad inputs when practical. TypeScript's `any` guidance says the same thing from
the other direction: `any` is an escape hatch from the type system. Guildhall's
runtime should use schema validation, explicit state transitions, and typed
owner-input contracts so agents cannot invent parallel state.

**Good guideline:** Use schemas at IO boundaries, `unknown` before narrowing
when data shape is unknown, discriminated unions for state, and transition
helpers for lifecycle changes.

**Bad guideline:** Do not use `any`, untyped JSON, stringly typed state,
boolean clusters, or direct status writes to dodge modeling work.

**Signals worth surfacing:**

- explicit `any`;
- unchecked `JSON.parse`;
- object types with broad index signatures in core paths;
- boolean clusters that represent one lifecycle state;
- direct writes to guarded state fields;
- switch/default branches that silently accept unknown state.

**Review question:** "Can this code represent a state Guildhall does not know
how to handle?"

### Guideline 6: UI Surfaces Compose Roles

**Principle:** Product/data-bound components compose design-system roles. They
do not invent visual language.

**Why:** A component-local style may be scoped, but scoped does not mean
governed. Svelte's local style model prevents accidental global leakage; it does
not decide whether a data-bound component should own typography, spacing,
color, density, or layout semantics.

**Good guideline:** Put visual authority in package UI primitives and tokens.
Use surface CSS only for route-level layout glue and integration constraints.

**Bad guideline:** Do not create new font sizes, weights, colors, card
treatments, notices, pills, field/value rows, or action rows inside data-bound
components.

**Signals worth surfacing:**

- raw CSS values in product surfaces;
- component-local style blocks in data-bound components;
- repeated local DOM/CSS signatures for canonical primitive jobs;
- new design-token aliases outside token-definition files;
- component variants outside the governed vocabulary.

**Review question:** "Is this a product fact, a layout fact, or a design-system
fact?"

### Guideline 7: Layout Should Match Geometry

**Principle:** Grid-shaped layout should use CSS grid. Flex is reserved for
flowing/wrapped item groups and small one-dimensional alignment.

**Why:** Grid expresses rows, columns, tracks, and areas directly. Using flex
for a grid-shaped layout hides structure in width hacks, wrapping behavior, and
child-level exceptions. That makes responsive changes harder and encourages
card stacks masquerading as layout.

**Good guideline:** Use grid for dashboards, repeated columns, equal tracks,
form/detail layouts, two-axis placement, and page/surface structure. Use flex
for inline controls, icon/text alignment, chip rows, wrapped tag clouds, and
flowing item groups where row and column gaps matter.

**Bad guideline:** Do not use flex to fake a grid, and do not use nested cards
as page layout.

**Signals worth surfacing:**

- `display: flex` plus fixed/equal child widths;
- `display: flex` plus wrapping and multi-column panel semantics;
- repeated child classes that define column widths;
- nested card-like frames;
- page sections styled as floating cards;
- grid-shaped DOM with no grid parent.

**Review question:** "Is this arranging a line of things or defining a
two-dimensional surface?"

### Guideline 8: Complexity Should Have A Domain Name

**Principle:** Complex code is acceptable when it is localized around a named
domain concept and protected by tests. It is not acceptable when complexity is
spread through view glue or unnamed helpers.

**Why:** Some domain logic is genuinely complex. The problem is not every branch
or every long function; the problem is complexity without ownership. A state
machine, parser, planner, or graph builder can be complex because it owns a
complex job. A surface component reinterpreting readiness, owner input, and task
status locally is complex because ownership leaked.

**Good guideline:** Keep complex logic in runtime utilities, parsers, state
machines, reducers, and tested domain modules with stable names.

**Bad guideline:** Do not hide branching in UI surfaces, command handlers, or
generic helpers with no domain contract.

**Signals worth surfacing:**

- high cyclomatic/cognitive complexity in surface or command files;
- nested conditionals over shared runtime state;
- repeated local derivations of project readiness or next action;
- complex functions with no focused tests;
- complex files that import many unrelated modules.

**Review question:** "Does this complexity live where the product concept is
owned?"

## Ecosystem Lenses

These are not separate constitutions. They are language-specific evidence for
the guidelines above.

| Ecosystem | Best-practice pressure | Why it matters | Guildhall signal direction |
| --- | --- | --- | --- |
| Go | Short, clear package names; avoid uninformative names like `util`, `common`, and `helper`; package names provide context at import sites. | Go imports are read constantly as `pkg.Name`, so weak package names weaken every caller and make ownership fuzzy. | Flag generic package names, import aliases that rescue unclear names, large mixed-purpose packages, and cross-boundary imports. |
| Python | Explicit beats implicit, flat beats nested, readability counts, and namespaces are valuable. | Python code leans on readable names and simple module structure because many guarantees are convention-backed rather than compiler-backed. | Flag deep nesting, magic dynamic access, broad modules with unrelated exports, and implicit control/data flow. |
| Rust | Use types to rule out invalid inputs; use generics to minimize assumptions; decide whether traits are objects or bounds. | Rust's strengths come from contracts made explicit in types. Abstractions are powerful, but the wrong trait/generic shape adds API complexity. | Flag loose primitive/string inputs in core paths, avoidable runtime validation, trait/object abstractions with one implementation, and unnecessary generic bounds. |
| TypeScript | Prefer ES modules for organization; avoid `any`; use `unknown` plus narrowing when shape is not known. | TypeScript is most useful when it preserves type evidence across module boundaries instead of letting escape hatches erase it. | Flag explicit `any`, unchecked JSON, namespace wrappers in module files, direct broad casts, and untyped boundary data. |
| Java | One top-level class per source file, no wildcard imports, package structure is explicit and conventional. | Java favors predictable file/package shape so tooling and readers can find ownership quickly. | Flag wildcard imports, multiple top-level production classes, package cycles, and classes that mix unrelated responsibilities. |
| Svelte/UI | Component-scoped CSS prevents leakage, but scoped styling is not design-system governance. | Scoped styles solve selector collision, not product consistency. Data-bound components can still become local design systems. | Flag raw styles, local primitive duplication, data-bound style blocks, and grid-shaped layout implemented with flex. |

## Duplication Decision Rule

Copy/paste is welcome when all of these are true:

- the copies have different reasons to change;
- the duplicated block is small enough to understand locally;
- no business rule, validation rule, security rule, lifecycle transition,
  design-system role, protocol shape, or owner-facing promise needs to stay
  identical;
- extracting would require weak names, broad options, or caller-specific
  branches;
- the code is still in discovery and the right abstraction has not shown
  itself.

Copy/paste should be challenged when any of these are true:

- the copies encode the same product rule or state transition;
- a bug fix would almost certainly need to land in every copy;
- the same visual role appears in more than two product surfaces;
- the copies are already diverging by flags, magic values, or special cases;
- the duplicated code crosses a boundary where a shared contract should exist;
- the copies appear in generated output and hand-authored code, suggesting a
  missing generator or fixture boundary.

Copy/paste should be blocked when the duplicated code is a known governed
contract: state-machine transitions, schema validation, permission/security
checks, design-system primitives, package UI variant definitions, release
criteria, artifact formats, or public protocol handling.

This gives copy/paste detectors a job: not "find duplicates," but "find
duplicates whose surrounding evidence suggests a shared reason to change."

## Abstraction Decision Rule

An abstraction is welcome when it has:

- a stable domain name;
- two or more production callers with the same reason to change;
- a small public surface;
- a clear owner and replacement target;
- focused tests;
- fewer decisions for future callers than the duplicated code had.

An abstraction should be challenged when it has:

- one production caller;
- generic names;
- caller-specific branches;
- more than three variant axes;
- unclear ownership;
- low fan-in but high dependency reach;
- comments explaining how to use it because the name and types do not.

An abstraction should be blocked in governed UI/runtime areas when it creates a
second design system, bypasses a state-machine boundary, hides owner-input
state, or weakens a typed/schema boundary.

## Signal Families

### 1. Size Budgets

**What this protects:** components, files, functions, generated reviewers, and
surface branches that become too large to reason about.

**Useful tools:**

- ESLint core rules: `max-lines`, `max-lines-per-function`,
  `max-statements`, and `max-depth`.
- Language-native analyzers where the project is not JS/TS.
- Custom Svelte/AST scans for component section budgets: script lines, template
  nodes, style lines, exported props, event handlers, fetches, and stores.

**Guildhall gate shape:**

- Hard gate on new components over budget unless they live in an approved
  migration file or generated fixture path.
- Review signal when an existing component grows past baseline.
- Trend metric for "largest touched components" and "surface branches per
  route."

**Why this matters:** size is crude but reliable. An enormous component is not
always wrong, but it is always more likely to hide unrelated jobs.

### 2. Complexity Budgets

**What this protects:** branching, nested conditionals, huge state reducers,
task-routing logic, and UI components that locally reinterpret runtime state.

**Useful tools:**

- ESLint `complexity`, which caps cyclomatic complexity and supports configured
  thresholds.
- `eslint-plugin-sonarjs` or SonarQube/SonarCloud for cognitive complexity.
- SonarQube metrics for complexity, cognitive complexity, maintainability, and
  quality gates.
- Language equivalents: Radon for Python, PMD for Java/Kotlin-ish ecosystems,
  Clippy for Rust, `go vet` plus staticcheck for Go.

**Guildhall gate shape:**

- Hard gate new functions that exceed a high cyclomatic threshold.
- Review signal for cognitive complexity over threshold, especially inside UI
  state derivation, request routing, graph transitions, and review planning.
- Trend metric by domain: runtime, web surface, package UI, scripts, tests.

**Important nuance:** complexity findings should prefer extracting named
runtime utilities over splitting logic into clever tiny functions with no
domain name. The target is lower cognitive load, not smaller snippets for their
own sake.

### 3. Copy/Paste and Near-Duplicate Detection

**What this protects:** repeated UI treatments, duplicated logic, duplicated
selectors, repeated review text, and parallel implementations that drift.

**Useful tools:**

- `jscpd`, which scans duplicated blocks across many languages and supports
  Svelte, Markdown, TypeScript, and cross-format detection.
- PMD CPD, which is a broader copy/paste detector distributed with PMD and
  supports many languages.
- SonarQube duplication metrics and quality gates.
- Custom component-treatment fingerprints: normalize CSS declarations, class
  names, prop sets, and DOM shapes, then compare repeated local treatments.

**Guildhall gate shape:**

- Hard gate newly duplicated source blocks over a configured size when both
  copies are in production paths.
- Review signal for repeated UI fingerprints: local cards, notices, pills,
  definition rows, empty states, and action bars.
- Trend metric for duplicate percentage on new code and duplicated UI
  treatments per surface.

**Important nuance:** duplication is not always a mandate to extract. Guideline
1 decides whether copy/paste is welcome. If two blocks have different reasons
to change, keep the duplication. If they encode the same business rule,
state-machine transition, validation policy, or visual role, extract or route
through the existing owner.

### 4. Abstraction Fitness

**What this protects:** premature shared components, helpers that hide
intentional differences, "misc" utilities, mega-primitives with too many props,
and design-system variants that multiply choice.

**Useful tools and heuristics:**

- Dependency graph fan-in/fan-out from dependency-cruiser.
- Knip for unused files, unused exports, and unused dependencies.
- Custom "single-use abstraction" scan: new exported helper/component with one
  caller outside tests.
- Custom "variant budget" scan: component props named `variant`, `kind`,
  `mode`, `tone`, `density`, `size`, `padding`, `emphasis`, plus the number of
  allowed values.
- Custom "semantic name" scan: flags `common`, `shared`, `utils`, `helpers`,
  `misc`, and `base` modules without a contract.
- Package-boundary tests: a primitive must have a contract before broad use.

**Guildhall gate shape:**

- Hard gate shared UI primitive variant-axis growth that violates
  `internal/constitutions/design-system-governance.md`.
- Hard gate new exported shared modules with no contract in governed locations.
- Review signal for single-use abstractions, low fan-in shared utilities, and
  new helpers that only wrap one call site.
- Trend metric for abstraction churn: new shared exports, deleted shared
  exports, average callers per shared export, and primitive variant growth.

**Important nuance:** this is the most judgment-heavy family. The scanner can
say "this abstraction has one caller" or "this component now has five variant
axes." It cannot prove the abstraction is wrong. The reviewer should decide
whether the abstraction expresses a stable domain concept, removes real
complexity, protects a boundary, or merely gives the agent a new place to hide
uncertainty.

### 5. Deprecated, Legacy, or Banned Syntax

**What this protects:** obsolete CSS, legacy APIs, weak browser support,
accidental old patterns, and unapproved local escape hatches.

**Useful tools:**

- Stylelint core rules such as `selector-no-deprecated`,
  `at-rule-no-deprecated`, `property-no-unknown`, and
  `declaration-property-value-disallowed-list`.
- `stylelint-no-unsupported-browser-features`, which uses doiuse, caniuse data,
  and Browserslist targets.
- ESLint `no-restricted-syntax`, `no-restricted-properties`,
  `no-restricted-imports`, and project-specific custom rules.
- Semgrep or ast-grep for structural rules that span languages or do not fit
  ordinary lint plugins.

**Guildhall gate shape:**

- Hard gate banned constructs with known replacements: CSS `float` for columns,
  table layout for non-tabular layout, raw z-index, raw type values, unapproved
  inline styles in surfaces, direct task status writes, and local owner-input
  handling.
- Review signal for modern-but-risky browser features when the project support
  target is unclear.
- Trend metric for legacy construct count by touched file and agent.

### 6. Layout Semantics

**What this protects:** layout technique mismatch: flex used for grid-shaped
structure, card stacks used as page layout, and layout decisions embedded
inside data-bound components.

**Useful tools:**

- Custom CSS AST checks for `display: flex`, `display: grid`, `float`, `clear`,
  `position`, `z-index`, and nested card signatures.
- Stylelint custom rules or PostCSS-based scans.
- Svelte AST rules that classify component role: route/surface, layout
  primitive, package UI primitive, data-bound component, generated artifact,
  test fixture.
- Component contract metadata in `packages/ui`.

**Guildhall gate shape:**

- Hard gate `float` and `clear` in product CSS outside explicitly named
  compatibility layers.
- Hard gate raw visual styling inside data-bound components when a package UI
  primitive exists for the role.
- Review signal for `display: flex` used in multi-column panels, dashboard
  grids, repeated rows, equal-track layouts, or any other grid-shaped structure.
- Trend metric for suspicious layout-pattern count by surface, plus local CSS
  count in data-bound components.

**Important nuance:** grid-shaped layout should use CSS grid. Flex is the
exception, not the peer default: it fits wrapped or flowing item groups where
row and column gaps matter, and small one-dimensional control alignment such as
icon/text buttons, chips, and compact toolbars. The signal should be "flex used
for a grid-shaped structure" rather than "flex exists."

### 7. Design-System Separation

**What this protects:** data-bound components becoming mini design systems.

**Useful tools:**

- Existing `lint:design` baseline.
- Custom Svelte classifier that tags each component as `surface`, `layout`,
  `primitive`, `data-bound`, `store`, or `fixture`.
- Import graph rules: data-bound components may import primitives and stores,
  but may not define governed visual treatments.
- CSS/token scans: raw values, local role classes, duplicate primitive
  signatures, and component-local variant vocabularies.
- `packages/ui/src/component-constitution.ts` or equivalent metadata as the
  canonical primitive contract registry.

**Guildhall gate shape:**

- Hard gate new raw token decisions in data-bound components.
- Hard gate local copies of canonical primitive jobs after the third repeated
  signature appears.
- Review signal when a data-bound component adds a style block at all.
- Trend metric for style lines by component role and surface.

## General-Purpose Tool Portfolio

Guildhall should not become dependent on one analyzer. The product should expose
a common finding model and let projects opt into tools by stack.

| Tool family | Best at | Weak at | Guildhall role |
| --- | --- | --- | --- |
| ESLint / TypeScript ESLint | JS/TS syntax, complexity, forbidden APIs, imports | CSS and architecture beyond AST rules | Default JS/TS lint source |
| Stylelint | CSS syntax, deprecated selectors, property/value policy, custom CSS rules | Understanding Svelte component roles by itself | Default CSS/design-policy source |
| dependency-cruiser | Import boundaries, cycles, orphans, reachability, dependency rules | Function-level complexity and UI semantics | Architecture graph source |
| jscpd / PMD CPD | Copy/paste detection across languages | Intentional duplication judgment | Duplication source |
| SonarQube / SonarCloud | Unified metrics, cognitive complexity, duplication, quality gates | Repo-specific design-system semantics | Optional external quality signal |
| Semgrep | Custom structural patterns, policy-as-code, security/correctness scans | Fine UI-token semantics unless rules are precise | Cross-language policy source |
| ast-grep | Fast structural search, lint, rewrites, codemods | Whole-program dependency reasoning | Local custom-rule and autofix source |
| Knip | Dead files, unused exports, unused dependencies | Dynamic project usage and intentional public APIs | Dead-code and abstraction-fitness source |
| ArchUnit-style tests | Architecture as executable tests | Non-JVM stacks without equivalents | Pattern to emulate in Guildhall runtime tests |
| Coverage and mutation tools | Whether behavior is protected | Design quality or abstraction quality | Gate support, not style signal |

## Guildhall Finding Model

0.11 should introduce a shared deterministic finding type:

```ts
type DeterministicFinding = {
  id: string
  guidelineId: string
  tool: string
  family:
    | 'size'
    | 'complexity'
    | 'duplication'
    | 'abstraction'
    | 'legacy-syntax'
    | 'layout'
    | 'design-system'
    | 'dependency-architecture'
    | 'dead-code'
  severity: 'block' | 'review' | 'trend'
  confidence: 'high' | 'medium' | 'low'
  scope: 'new-code' | 'touched-code' | 'repo-baseline'
  path: string
  line?: number
  subject?: string
  message: string
  reviewQuestion?: string
  evidence: Record<string, unknown>
  suggestedAction?: string
  waiver?: {
    reason: string
    expiresAt?: string
    owner?: string
  }
}
```

Every analyzer should emit this shape or an intermediate format that can be
normalized into it. The important fields are `guidelineId` and `scope`:
`guidelineId` ties the finding back to the policy it protects, while `scope`
keeps a repo with historical debt from pretending the whole old codebase is
clean.

## 0.11 Product Behavior

### Task Shaping

When Guildhall creates or scopes a task, it should inspect the relevant project
toolchain profile and attach applicable guardrails:

- "This is a UI surface task. Run design-system and layout scans."
- "This touches runtime transition logic. Run dependency, complexity, and
  forbidden-write scans."
- "This introduces a shared helper. Run abstraction-fitness and fan-in scans."
- "This modifies repeated component treatments. Run duplication and primitive
  opportunity scans."

### Worker Context

Worker packets should include concise, concrete rules derived from the active
signals. Example:

> This task touches `src/web/surfaces/project`. New raw type, spacing, color,
> radius, z-index, shadow, and local card/notice/pill treatments are blocked.
> If a new visual role is needed, extend package UI first.

This is better than generic "use the design system" prose because it names the
checks that will run.

### Review Packets

Review packets should include:

- blockers, with exact paths and commands;
- review signals, grouped by concern;
- unchanged baseline debt, clearly labeled so reviewers do not waste time;
- trend deltas for the touched area;
- any waivers created during the run.

### Gates

Hard gates should be limited to high-confidence regressions:

- new raw design-token violations;
- new forbidden dependency edges;
- new runtime cycles;
- new direct writes to guarded state-machine fields;
- new duplicated blocks above threshold in production paths;
- new banned legacy syntax;
- component contract violations in package UI;
- local styling added to data-bound components where the design-system contract
  already covers the role.

Everything else should start as review signal until the false-positive rate is
known.

## Implementation Plan

### Milestone A: Analyzer Registry

- Add `src/runtime/deterministic-findings.ts`.
- Add a guideline registry for the durable quality guidelines above. Analyzer
  configuration should point at guideline ids, not only tool names.
- Add a config schema for project analyzer capabilities and scopes.
- Normalize existing `lint:design`, `lint:reductions`, and `lint:deps` outputs
  into the shared finding shape.
- Store findings in task/run evidence with baseline-vs-new-code classification.

### Milestone B: Web Design and Layout Signals

- Extend `scripts/design-token-audit.mjs` from token signatures into role-aware
  Svelte/CSS findings.
- Add component-role classification for `surface`, `primitive`, `layout`, and
  `data-bound`.
- Add layout checks for `float`, `clear`, suspicious flex-as-grid usage, nested
  cards, raw z-index, and local style blocks in data-bound components.
- Add primitive-opportunity fingerprints for repeated card, notice, pill,
  field/value, empty-state, and action-row treatments.

### Milestone C: Complexity, Duplication, and Abstraction Fitness

- Add ESLint or equivalent JS/TS complexity checks, scoped to new/touched code.
- Add jscpd or PMD CPD duplication reports, normalized into Guildhall findings
  that ask whether the copies share a reason to change before recommending
  extraction.
- Add Knip or dependency-graph-derived dead-code and low-fan-in abstraction
  signals.
- Add package UI variant-budget checks tied to the design-system constitution.

### Milestone D: Product Integration

- Surface deterministic findings in task evidence and review handoff.
- Teach task shaping to request the right analyzer family by touched path and
  task type.
- Add waiver receipts with owner/reason/expiry.
- Add trend summaries to project health without making them a moral scoreboard.

## Recommended Defaults for Guildhall Itself

Start with these as hard gates:

- No new `lint:design` signatures over baseline.
- No new dependency-cruiser errors.
- No new `lint:reductions` failures.
- No CSS `float` or `clear` outside compatibility paths.
- No raw `font-size`, `font-weight`, `line-height`, `color`, `gap`, `padding`,
  `border-radius`, `box-shadow`, or `z-index` in data-bound components.
- No new package UI primitive variant axis without a contract update.

Start with these as review signals:

- Function cyclomatic complexity over threshold.
- Cognitive complexity over threshold.
- Component line count over threshold.
- Duplicated blocks under the hard-gate threshold.
- `display: flex` in multi-column, dashboard, repeated-row, or equal-track
  layouts where CSS grid should own the structure.
- Shared exports with one caller.
- New helpers under `utils`, `shared`, `common`, `base`, or `misc`.
- New style blocks in data-bound components even when they only use tokens.

Start with these as trend metrics:

- Duplicate percentage on new code.
- Largest touched components.
- Average callers per shared export.
- Local CSS lines by component role.
- Suspicious grid-shaped-flex pattern count by surface.
- Design-system baseline burn-down.
- Waiver count and age.

## Source Notes

- Go's package naming guidance explains that a package name provides context for
  exports and helps maintainers decide what belongs:
  https://go.dev/blog/package-names
- Google's Go style decisions explicitly warn against uninformative package
  names such as `util`, `utility`, `common`, `helper`, and `model`:
  https://google.github.io/styleguide/go/decisions.html
- PEP 20 provides Python's durable readability and organization aphorisms:
  explicit over implicit, simple over complex, flat over nested, readability
  counts, and namespaces are valuable:
  https://peps.python.org/pep-0020/
- Rust API Guidelines emphasize type-level validity, minimizing assumptions with
  generics, and making trait-object decisions deliberately:
  https://rust-lang.github.io/api-guidelines/dependability.html
  https://rust-lang.github.io/api-guidelines/flexibility.html
- TypeScript's handbook recommends modules for new projects and notes that an
  extra namespace layer is unnecessary in module files:
  https://www.typescriptlang.org/docs/handbook/namespaces-and-modules.html
- typescript-eslint documents `any` as a dangerous escape hatch and recommends
  safer alternatives such as `unknown` when the shape is not known:
  https://typescript-eslint.io/rules/no-explicit-any/
- Google's Java Style Guide defines enforceable structure conventions such as
  one top-level class per source file and no wildcard imports:
  https://google.github.io/styleguide/javaguide.html
- Svelte component CSS is scoped by default, which prevents leakage but does not
  decide whether component-local styling is a governed design-system decision:
  https://svelte.dev/docs/svelte/scoped-styles
- Sandi Metz's "The Wrong Abstraction" and Kent C. Dodds' AHA Programming are
  useful framing for preferring duplication while the right abstraction has not
  emerged:
  https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction
  https://kentcdodds.com/blog/aha-programming
- ESLint documents `complexity` as a cyclomatic-complexity threshold rule and
  offers `max` plus classic/modified variants:
  https://eslint.org/docs/latest/rules/complexity
- ESLint also provides restriction rules for syntax and API usage, including
  `no-restricted-syntax` and `no-restricted-properties`:
  https://eslint.org/docs/latest/rules/
  https://eslint.org/docs/latest/rules/no-restricted-properties
- Stylelint provides built-in rules and plugin support for CSS errors and
  conventions, including deprecated selectors and property/value policies:
  https://stylelint.io/
  https://stylelint.io/user-guide/rules/selector-no-deprecated/
  https://stylelint.io/user-guide/rules/declaration-property-value-allowed-list
- `stylelint-no-unsupported-browser-features` uses doiuse, caniuse data, and
  Browserslist targets to flag unsupported CSS:
  https://www.npmjs.com/package/stylelint-no-unsupported-browser-features
- dependency-cruiser supports forbidden, allowed, and required dependency rules,
  plus cycles, orphans, reachability, dependents, and license checks:
  https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- jscpd is a copy/paste detector for many languages and includes Svelte,
  TypeScript, and Markdown support:
  https://jscpd.dev/
- PMD includes CPD, a copy/paste detector across many languages:
  https://pmd.github.io/pmd/index.html
  https://github.com/pmd/pmd/blob/main/docs/pages/pmd/userdocs/cpd/cpd.md
- SonarQube documents complexity, cognitive complexity, duplication metrics, and
  quality gates:
  https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition
  https://docs.sonarsource.com/sonarqube/latest/user-guide/quality-gates
- Semgrep uses custom rules and pattern matching to detect code findings:
  https://semgrep.dev/docs/running-rules/
- ast-grep supports structural search, linting, and rewriting with YAML rules:
  https://ast-grep.github.io/guide/project/lint-rule.html
- Knip finds unused files, dependencies, and exports:
  https://knip.dev/
- ArchUnit is a useful model for executable architecture rules, including
  package, layer, and cycle checks:
  https://www.archunit.org/userguide/html/000_Index.html
