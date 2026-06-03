# Guildhall 0.11.0 Deterministic Code Quality Signals

**Status:** Proposed 0.11.0 internal spec
**Date:** 2026-06-03
**Audience:** Guildhall runtime, review, and UI-governance implementation work
**Related:** `internal/constitutions/design-system-governance.md`,
`internal/audits/2026-06-01-ui-component-token-governance.md`,
`internal/plans/2026-06-02-guildhall-0-11-implementation-tracker.md`

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

**Important nuance:** duplication is not always a mandate to extract. If two
domains have the same shape today but separate reasons to change tomorrow, the
right answer may be to keep them separate and document the divergence. The
review packet should ask that question directly instead of yelling "DRY" like a
broken smoke alarm.

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
complexity, or merely gives the agent a new place to hide uncertainty.

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

**What this protects:** flex everywhere, grid nowhere, card stacks used as page
layout, and layout decisions embedded inside data-bound components.

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
- Review signal for `display: flex` used with wrapping, equal-width children,
  multi-column panels, dashboard grids, or repeated rows where grid is likely
  the clearer layout primitive.
- Trend metric for flex/grid ratio by surface, plus local CSS count in
  data-bound components.

**Important nuance:** flex is not bad. Flex is good for one-dimensional control
alignment, inline action rows, icon/text buttons, chips, and compact toolbars.
The signal should be "flex used for a columnar or two-dimensional layout" rather
than "flex exists."

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
normalized into it. The important field is `scope`: a repo with historical debt
should block new drift without pretending the whole old codebase is clean.

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
- Add jscpd or PMD CPD duplication reports, normalized into Guildhall findings.
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
- `display: flex` in multi-column or wrapping layouts.
- Shared exports with one caller.
- New helpers under `utils`, `shared`, `common`, `base`, or `misc`.
- New style blocks in data-bound components even when they only use tokens.

Start with these as trend metrics:

- Duplicate percentage on new code.
- Largest touched components.
- Average callers per shared export.
- Local CSS lines by component role.
- Flex/grid ratio by surface.
- Design-system baseline burn-down.
- Waiver count and age.

## Source Notes

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
