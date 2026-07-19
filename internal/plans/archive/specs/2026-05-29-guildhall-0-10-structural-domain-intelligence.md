# Guildhall 0.11.0 Structural and Domain Intelligence

**Status:** Deferred to 0.11.0

**Deferral note, 2026-06-06:** This is no longer a 0.10 target. Structural and
domain intelligence should be reframed through the implemented 0.10 delivery
spine and project contract governance before it becomes an owner-facing product
lane in 0.11.

This lane is about how Guildhall understands the shape of a repo before it
routes tasks, builds context, starts worktrees, or records memory. It is not
project registration. It must not create `guildhall.yaml` in target repos as a
side effect of discovery. Intake can propose a structure, explain the evidence,
and ask the owner to accept or correct it.

Jess is the concrete fixture for this spec, but the feature must work for more
than pnpm package monorepos. Many real projects have packages, domains,
runtime units, docs corpora, nested Git roots, generated vendors, and folders
that are meaningful domains without being separately buildable packages.

## Problem Statement

Guildhall can already carry task domain, project path, worktree path, memory,
Corpus Map, and context-debug state. The gap is that it does not yet have a
first-class, owner-reviewable model of a repo's structural shape. That makes
several things harder than they should be:

- A task can target a package, source area, or cross-cutting concern without
  Guildhall knowing which context is local, global, dependency-related, or
  distracting.
- Workspaces and monorepos can be conflated. A buildable package, a feature
  domain, and a Git authority root are different things, but current language
  often collapses them.
- Context packets can be either too thin or too broad. The agent needs the
  right domain and dependency context, not every package README and old
  planning note.
- Memory needs scoping. A repo-wide habit, a package-specific runtime rule, a
  cross-cutting parser concern, and a task-specific lesson should not all
  compete as flat "project memory."
- UI intake needs an owner review step. Guildhall should show the proposed
  domains and cross-cutting concerns before accepting them into routing or
  memory.

The 0.11.0 product goal is: **Guildhall can inspect a repo, propose a
structural map with confidence and evidence, let the owner accept/correct it,
and use that map to route tasks, shape context, scope memory, choose Git
authority, and verify cross-domain work without flooding prompts.**

## Product Goal

For 0.11.0, structural intelligence should deliver three user-visible
improvements:

1. **Better task routing:** tasks land in the package, domain group,
   executable unit, or cross-cutting concern they actually touch.
2. **Better context packets:** agents receive the context they need, with clear
   prioritization, summaries, handles for on-demand retrieval, and audited
   omissions when the prompt budget is tight.
3. **Better memory reuse:** learned facts attach to the scope where they are
   true, with confidence, freshness, risk, and evidence so stale or
   over-generalized memory does not quietly steer future work.

Non-goals for the first 0.11.0 slice:

- automatic project registration or config writes in target repos;
- a universal build-system graph engine;
- replacing language-specific tooling such as `cargo metadata`,
  `dotnet sln list`, Composer, Poetry, or package-manager lock parsers;
- treating every folder as a domain;
- treating every package as a task boundary;
- forcing the public product to explain "workspace" to users when "project" or
  "folder group" is clearer.

## Taxonomy

The terms below should be explicit in code and UI copy. The same directory may
play several roles, and those roles should remain separable.

### Project

The public-facing unit the owner adds to Guildhall. It is the thing they think
they are working on. For a simple app, a project may be one repo. For a
coordination folder, a project may contain multiple child projects.

Use "project" as the default public concept. "Workspace" is probably the wrong
first-run word for most users.

### Workspace

An advanced coordination container. It is useful when one Guildhall entry
coordinates multiple buildable child projects with separate setup, gates, Git
authority, or release paths.

Workspace should remain a config/runtime concept, not the primary public name
for every repo. In owner-facing copy, prefer "related projects" or "project
group" unless the user is looking at configuration.

### Monorepo

A single Git authority root containing multiple packages, apps, crates,
libraries, docs sites, plugins, or domain folders. A monorepo may be a
workspace, but it does not have to be. Jess is a monorepo with one top-level
Git root and many pnpm packages.

### Package Graph

The dependency and script graph derived from package-manager manifests and
lockfiles. In JS/TS, this is pnpm/npm/yarn/bun workspaces and package
dependencies. In Python, it may come from `pyproject.toml`, `uv.lock`, Poetry,
or src-layout packages. In Rust, from Cargo workspaces and crate dependencies.
In PHP, from Composer packages and framework modules. In .NET, from solution
and project references.

Package graph is not the same as domain graph. `@jesscss/core` is a package,
while "parser behavior across CSS/Less/SCSS/Jess" is a cross-cutting domain.

### Domain Group

A durable conceptual area of the project. It may align with a package, a set of
packages, a folder, a docs corpus, a product surface, or a business capability.
Examples: "core eval/render runtime," "parser family," "language service,"
"docs publishing," "billing," "inventory," "tenant security."

Domain groups route tasks and memory. They should be owner-reviewable because
automated discovery can only infer intent.

### Cross-Cutting Domain

A concern that spans packages or folders and needs special context whenever it
is touched. Examples: Jess node-copy reduction, parser parity, design-system
reuse, auth/session security, database migrations, accessibility, observability,
or release packaging.

Cross-cutting domains are not "misc." They are first-class because task
quality often depends on knowing constraints that live outside the immediate
file path.

### Executable Unit

Something Guildhall can build, test, run, or prove independently enough to be
useful: a package script, app server, test target, docs site, CLI, worker,
container, service, or benchmark.

An executable unit may be smaller than a package (`pnpm --filter
@jesscss/core test`) or broader than one package (`pnpm run verify:baseline`).

### Memory Scope

Where a memory record is true and safe to apply:

- repo global;
- domain group;
- package or executable unit;
- cross-cutting concern;
- task or work item;
- user-global preference;
- Guildhall-product learning.

Memory scope should include confidence, freshness, risk, evidence refs, and
the structural-map version or evidence snapshot that made the memory true.

### Git Authority Root

The Git root that owns branch state, worktree creation, ignored local state,
history refresh, commit, push, PR, and release closure for a unit of work.

Git authority root is not always the same as package root or domain root. A
repo can have one top-level Git root, nested child Git roots, submodules,
vendored dependency checkouts, generated worktrees, or folders that are domains
but not Git repos. Guildhall should detect these shapes and keep Git policy
separate from domain routing.

## Intake Algorithm

Discovery should produce a `StructuralMapDraft`, not mutate repo configuration.
The draft is evidence-backed, confidence-scored, and owner-reviewable.

### 1. Establish File and Git Boundaries

Start from the target folder and gather cheap deterministic evidence:

- `git rev-parse --show-toplevel`;
- `git status --short --branch`;
- `git worktree list --porcelain`;
- nested `.git` directories or files;
- `.gitmodules`;
- ignored/generated/dependency folders;
- checked-in `.guildhall/` and optional `guildhall.yaml`, without assuming a
  full registered project unless config exists or the owner says so.

Classify each Git shape:

- **top-level authority:** normal single repo authority;
- **child authority:** nested repo or submodule that should own its own worktree
  and branch policy;
- **vendored/generated root:** nested Git metadata under dependency or build
  output paths such as `node_modules`, usually ignored for task routing;
- **domain folder only:** meaningful source area with no Git authority;
- **mixed worktree:** sibling or nested linked repo that should be coordinated
  but not treated as ordinary source.

The map should record both detected roots and ignored roots, with reasons.

### 2. Read Manifests and Package Managers

Parse manifests with structured parsers where practical:

- JS/TS: `package.json`, `pnpm-workspace.yaml`, npm/yarn/bun workspaces,
  lockfiles, scripts, package dependencies, TS project references;
- Python: `pyproject.toml`, `uv.lock`, `poetry.lock`, `setup.cfg`, `setup.py`,
  src-layout hints, test config, package import names;
- Rust: `Cargo.toml`, `Cargo.lock`, `cargo metadata`, crates, features,
  examples, benches;
- PHP: `composer.json`, `composer.lock`, Symfony/Laravel config, modules,
  console commands, PHPUnit/Pest config;
- .NET: `.sln`, `.csproj`, `.fsproj`, project references, test projects,
  target frameworks;
- Rails/Django/framework apps: framework entrypoints, app modules, migrations,
  tests, background jobs, settings, routes;
- docs/planning: Docusaurus/VitePress/MkDocs/Sphinx manifests, docs folders,
  internal plans, ADRs, release notes.

Each manifest contributes possible packages, executable units, verification
commands, and domain hints. It does not automatically define the domain model.

### 3. Infer Source Modules, Classes, and Runtime Areas

Use Corpus Map style deterministic indexing first:

- file kinds, path patterns, exported symbols, imports;
- test-to-source adjacency;
- framework conventions such as `app/`, `domain/`, `services/`, `controllers/`,
  `migrations/`, `workers/`, `commands/`, `packages/`, `crates/`, `src/`;
- class/module namespaces and import roots;
- generated or vendored path exclusions.

Then identify likely domain clusters:

- packages with heavy internal coupling;
- source folders with stable conceptual names;
- classes/modules that share a business capability;
- test suites that prove the same behavior across packages;
- docs/plans that name an active architecture concern;
- repeated scripts or gates that span several packages.

For class/module architectures, package boundaries may be absent. A Rails app,
Django app, Symfony bundle, or .NET solution can have domain modules expressed
as namespaces, folders, service classes, migrations, routes, tests, and docs
rather than separately buildable packages.

### 4. Inspect Docs, Plans, Tests, and Handoffs

Docs often reveal the real domain graph. Intake should search:

- `AGENTS.md`, `CLAUDE.md`, repo-specific agent guidance;
- READMEs and package READMEs;
- architecture docs, handoffs, ADRs, release plans, internal specs;
- test names and fixture folders;
- scripts with names like `verify`, `baseline`, `smoke`, `bench`, `release`;
- existing `.guildhall/artifacts.yaml`, tasks, decisions, and memory when
  available through the MCP bridge or local files.

Docs are evidence, not instructions to copy blindly. The map should mark stale
or volatile docs as lower freshness unless current code/scripts corroborate
them.

### 5. Combine Evidence Into a Draft Map

The draft should include:

- package graph;
- executable units and candidate commands;
- domain groups;
- cross-cutting domains;
- dependency edges;
- Git authority roots;
- memory scopes;
- confidence and evidence for every proposed unit;
- conflicts, unknowns, and owner questions.

Confidence should be conservative:

- **high:** manifest, source, test, and docs agree;
- **medium:** two evidence types agree, or one authoritative manifest is clear;
- **low:** path-name or docs-only inference;
- **conflict:** sources disagree, owner review required.

### 6. Ask Only What Inspection Cannot Answer

Follow the pressure-test rule: inspect first, ask one focused question only
when a decision changes behavior. Examples:

- "These folders look like domains but share one build path. Should Guildhall
  route tasks by domain group or by package?"
- "This nested Git root appears under a dependency folder. Should it be ignored
  as vendored state?"
- "Parser parity spans CSS, Less, SCSS, and Jess packages. Should Guildhall
  treat it as a cross-cutting domain?"

## Context Forwarding and Budget Behavior

Context shaping must balance relevance against context volume. More context is
not automatically better. Structural intelligence should make context smaller,
more truthful, and easier to retrieve on demand.

Every context packet should have a budget plan:

- target maximum chars/tokens for the role and model;
- reserved budget for current task and accepted spec;
- reserved budget for hard constraints and safety rules;
- flexible budget for domain, global, dependency, cross-cutting, and memory
  context;
- omitted-context ledger with auditable reasons.

### Context Priority

Always include:

- current task id, title, status, domain, project path, worktree path when
  present;
- accepted spec or current intake question;
- active blocker/revision/checkpoint needed to act;
- hard owner/repo rules that directly apply, including docs boundaries,
  Git-history safety, runtime/capability constraints, and verification
  requirements;
- the structural-map slice naming the task's domain, Git authority root,
  executable unit, and direct dependencies;
- handles for the full structural map, relevant domain map, and context-debug
  record.

Include as compact summaries:

- repo-global project summary;
- domain charter and current facts;
- dependency-context summary for upstream or downstream packages;
- cross-cutting concern summary when task text, files, or tests match it;
- relevant memory records, with confidence/freshness/risk;
- recent decisions and progress tails;
- Corpus Map read-next guidance.

Reference by handle for deferred retrieval:

- full source files not yet needed;
- full package manifests and lockfile sections;
- complete docs or long handoffs;
- full dependency graph;
- full memory records and evidence transcripts;
- generated reports, benchmark history, and corpus snapshots.

Omit by default, with a logged reason:

- unrelated packages or domains;
- stale docs contradicted by current manifests or code;
- generated, vendored, dependency, and build-output paths;
- low-confidence memory when prompt budget is tight;
- high-risk memory not approved for active use;
- repeated historical transcripts when a sealed summary exists;
- broad global guidance that does not apply to the task kind.

### Budget Tiers

The context builder should assign each candidate context block a tier:

1. **Required:** cannot proceed safely without it. If required context does not
   fit, block or ask for a smaller task.
2. **High relevance:** include in full if small, otherwise summarize.
3. **Medium relevance:** summarize and attach a handle.
4. **Low relevance:** handle only.
5. **Excluded:** omit with reason.

Example omitted-context ledger:

```yaml
omitted:
  - handle: structural-map://jess/package/docs-less/full
    reason: unrelated_to_task_domain
    confidence: high
  - handle: memory://jess/less-hotpath-history/full
    reason: summarized_due_to_context_budget
    includedSummary: memory://jess/less-hotpath-history/summary
  - handle: git-root://jess/node_modules
    reason: vendored_dependency_git_metadata
```

### On-Demand Retrieval

Context packets should teach the agent what to retrieve next:

- `structural-map://<project>/domains/<domain-id>`;
- `package://<project>/<package-id>`;
- `executable-unit://<project>/<unit-id>`;
- `cross-cutting://<project>/<concern-id>`;
- `memory://<scope>/<id>`;
- `evidence://<task>/<record-id>`;
- `source://<project>/<path>`;
- `git-root://<project>/<root-id>`.

The handle should resolve through MCP/CLI/UI to bounded content with the same
redaction and capability rules as ordinary context. A handle is not a license
to read every file. It is a traceable pointer that preserves context budget
until the agent has a reason to open it.

### Role-Specific Forwarding

Spec agents need goal, owner answers, domain map, relevant unknowns, and enough
project shape to ask good questions. They should not get a full dependency
graph unless the task is explicitly structural.

Workers need accepted spec, target files, domain context, executable-unit
commands, direct dependency context, and cross-cutting constraints. They should
get read-next handles for broader packages.

Reviewers need spec, diff/changed files, domain and cross-cutting constraints,
proof expectations, and dependency impact summary. They should get enough
context to reject architectural drift without being buried in unrelated code.

Gate checkers need commands, working directories, proof paths, and recorded
evidence. They rarely need broad source context.

## Memory Model

Structural intelligence should upgrade memory from "matching snippets" to
scope-aware records.

### Repo-Global Memory

Facts true across the whole repo:

- preferred verification policy;
- Git authority rules;
- public docs vs internal docs boundary;
- root package manager and top-level gates;
- repo-wide operating rules from `AGENTS.md`.

Repo-global memory should be included only when it changes the current task.
Otherwise it should be summarized or referenced by handle.

### Domain and Package Memory

Facts true for a domain group or package:

- `packages/core` runtime invariants;
- parser package compatibility rules;
- docs package publishing constraints;
- package-local test commands;
- known setup or build quirks.

Domain memory should win over repo-global memory when the task is clearly
inside that domain, unless a higher-risk global rule applies.

### Cross-Cutting Concern Memory

Facts true when a concern is touched, regardless of package:

- Jess node-copy reduction constraints;
- Less/SCSS/CSS parser parity;
- import/reference semantics;
- release packaging;
- design-system reuse;
- security/privacy/a11y/review lanes.

Cross-cutting memory should be activated by files, symbols, tests, task text,
or owner selection. It should not be injected into unrelated tasks just because
it is important.

### Task-Specific Memory

Facts learned during one task:

- what was tried;
- current blocker;
- accepted design choice;
- exact verification proof;
- handoff and next step.

Task memory should be included for that task and close descendants. It should
be proposed, not automatically promoted, when it looks reusable.

### Confidence, Freshness, and Risk

Every memory record should carry:

- scope;
- evidence refs;
- confidence: low, medium, high;
- freshness: fresh, recent, stale;
- risk: low, medium, high;
- last verified at;
- structural-map version or evidence fingerprint;
- promotion status: observed, proposed, active, used, retired.

High-risk or stale memory should be withheld from automatic injection unless
the task is explicitly about that memory. The context-debug record should log
which memory was included, withheld, summarized, or omitted.

## Jess Fixture

Jess should be used as a concrete 0.11.0 fixture because it exposes several
important distinctions.

### What Guildhall Should Infer

Git shape:

- `/Users/matthew/git/oss/jess` is the authoritative top-level Git root on
  `dev`.
- Current working tree evidence shows active edits in `packages/core` tests and
  runtime files, so a live task in that area should prefer core context and
  avoid treating unrelated package docs as current truth.
- `git worktree list` shows multiple older or side worktrees, including
  prunable temp worktrees and feature worktrees. Guildhall should record them
  as Git context, not as package/domain structure.
- A nested `.git` under `node_modules` should be ignored as dependency state,
  not proposed as a child project authority.
- No submodules were reported by `git submodule status --recursive`.

Package graph:

- Root `package.json` is private `@jesscss/root` and declares pnpm as the
  package manager.
- `pnpm-workspace.yaml` includes `packages/*` and
  `packages/awaitable-pipe`.
- Packages include core/runtime, CSS/Less/SCSS/Jess parsers, Jess CLI,
  plugins, Less compatibility, functions, config/style resolver, rollup plugin,
  docs sites, docs content, language service, VS Code extension, patch-css,
  shared private support, and awaitable-pipe.
- Many packages are publishable, but not all are equal task-routing domains.
  Private docs and extension packages still matter as executable units or
  product surfaces.

Root gates and executable units:

- Root scripts include `test`, `lint`, `test:less:*`,
  `verify:public-packages`, `verify:package-exports`,
  `verify:node-copy-frontier`, `verify:render-buffer-frontier`,
  `audit:node-creation`, `measure:less:hotpath`, `verify:baseline`,
  docs build scripts, and release-alpha scripts.
- `verify:baseline` is a broad cross-package gate. It should be an executable
  unit and a root verification option, not the default first check for every
  tiny package task.
- Package-local scripts such as `pnpm --filter @jesscss/core build` and
  focused Vitest runs should be executable units with lower context and runtime
  cost.

Domain groups:

- **Core eval/render runtime:** `packages/core`, especially tree nodes,
  context, rules, render buffer, clone/copy/materialization, import/reference,
  selector, mixin, and runtime state.
- **Parser family:** `packages/css-parser`, `packages/less-parser`,
  `packages/scss-parser`, `packages/jess-parser`, plus parser fixtures and
  cross-parser plans.
- **Less compatibility and plugin bridge:** `packages/jess-plugin-less`,
  `packages/jess-plugin-less-compat`, Less test-data fixtures, Less function
  support in `packages/fns`.
- **Plugin architecture:** plugin packages, node-modules plugin, JS plugin,
  rollup plugin, config/style resolver, extension points in core.
- **Jess CLI and public package surface:** `packages/jess`, package exports,
  public package consumer checks, release scripts.
- **Language service/editor:** `packages/language-service`,
  `packages/extension`, `packages/vscode`, editor API docs.
- **Docs/content:** `packages/docs`, `packages/docs-less`,
  `packages/docs-content`, root docs.
- **Task-loop/transient agent state:** historical `state/agent-loop` memory is
  referenced in prior context but not present in the current checkout; current
  discovery should mark that as stale unless files reappear.

Cross-cutting concerns:

- **Node-copy reduction:** active architecture constraint from
  `docs/future/node-copy-reduction/README.md` and `HANDOFF.md`. It spans core
  runtime code, frontier scripts, Less hotpath measurements, and baseline
  verification. It should activate for tasks touching eval/render, `copy`,
  clone, materialization, `Rules.resolve`, `AtRule.render`, selector placement,
  mixin output slots, or related frontier scripts.
- **Parser parity:** CSS, Less, SCSS, and Jess parsers share behavior and
  fixtures. A parser change may need cross-package tests even if only one
  package file changes.
- **Less/SCSS/CSS semantics:** compatibility with Less and Sass-like behavior
  appears in package names, docs, fixtures, and function families. Guildhall
  should treat language-specific compatibility as domain context, not just
  package-local implementation detail.
- **Cross-package verification:** some changes require building upstream
  packages before downstream fixtures. The existing repo guidance says if
  package B depends on package A, build A first when workspace layout requires
  built outputs.
- **Docs and language-service boundaries:** docs packages and language service
  are distinct surfaces. Editor behavior should not be routed as ordinary docs
  work, and docs migrations should not inherit core runtime constraints unless
  they cite them.

Owner-review proposal for Jess:

- Use a single Guildhall project for the Jess repo by default, not a workspace
  with every package as a child project.
- Treat pnpm packages as package graph nodes and executable units.
- Treat the domain groups above as routing/memory scopes.
- Treat node-copy reduction and parser parity as cross-cutting domains.
- Treat the top-level Git root as the Git authority root unless a task is
  explicitly assigned to a separate worktree.
- Ignore nested Git metadata under dependency folders.

This avoids overfitting "domain" to `packages/*`. For example, node-copy
reduction is not a package. It is a cross-cutting architecture lane centered
in core but proved by scripts, benchmarks, and Less fixture behavior.

## Non-Jess Examples

### Python

A Python repo may have `pyproject.toml`, `uv.lock`, Poetry metadata, `src/`
layout packages, Django apps, CLI entrypoints, and pytest suites. The package
graph might say there is one installable distribution, while domain groups are
`billing`, `accounts`, `inventory`, and `reports`. Guildhall should route a
task touching `src/acme/billing/`, migrations, and tests as billing-domain work
even if the executable unit is `uv run pytest tests/billing`.

For a docs-heavy research repo with no package manager, the domain map may come
from folders like `research/`, `specs/`, `datasets/`, and `reports/`, with no
buildable package graph at all.

### Rust

A Rust repo may have a Cargo workspace with crates such as `core`, `cli`,
`server`, `bench`, and `integration-tests`. Crates are package graph nodes, but
cross-cutting concerns may include serialization compatibility, async runtime
behavior, unsafe boundaries, feature flags, or benchmark regressions. A task in
one crate may need dependency context from a trait crate and downstream context
from the CLI crate.

### PHP

A Composer project may be a Laravel app, Symfony app, package library, or
modular monolith. Domains may be service folders, bundles, modules, migrations,
routes, jobs, commands, and tests rather than Composer packages. Composer
scripts and PHPUnit/Pest commands provide executable units; framework
configuration and service container bindings provide domain evidence.

### .NET

A .NET repo may have one solution with many projects. `.sln` membership and
`.csproj` references form the package/project graph, but task domains may be
bounded contexts expressed as namespaces, controllers, services, EF migrations,
workers, and test projects. Git authority is usually the repo root, while
executable units are `dotnet test <project>`, `dotnet build <solution>`, or
service-specific run profiles.

### Class or Module Architectures

Rails, Django, Symfony, Laravel, and many enterprise apps express domains as
folders, namespaces, modules, or bounded contexts rather than separately
buildable packages. Guildhall should use routes, models, services, migrations,
jobs, tests, and docs to infer domain groups. It should not require a package
manifest to consider a folder an important domain.

### Plugin Architectures

Plugin-based repos often have a host runtime, plugin API, built-in plugins,
adapter packages, compatibility layers, and fixture suites. A plugin task
needs host API context, plugin package context, and compatibility concern
context. It should not receive every plugin's source unless the task is
explicitly about plugin registry or cross-plugin behavior.

## UI and Product Behavior

Structural intake should be visible and correctable before it becomes
authority.

### Proposed Structure Review

The owner should see a review surface with:

- detected Git roots and ignored nested roots;
- package graph summary;
- proposed domain groups;
- proposed cross-cutting concerns;
- executable units and likely commands;
- memory scopes to be created or updated;
- confidence and evidence per item;
- conflicts and questions;
- what Guildhall will use each accepted item for.

The UI should avoid asking the owner to review a giant manifest. Default view:

- "Guildhall found these work areas";
- "These concerns seem to cut across packages";
- "These commands look like proof paths";
- "These Git roots appear to own history";
- "These findings are uncertain."

Each row should support:

- accept;
- rename;
- merge;
- split;
- mark as cross-cutting;
- mark as package-only, not domain;
- ignore with reason;
- defer decision.

### Language

Use "project" publicly by default. Use "workspace" only when the folder truly
coordinates multiple child projects with separate setup and gates, or when the
user is editing configuration. In the Jess fixture, the owner should see "Jess
project" and "packages/domains/concerns," not "workspace" as the main concept.

### Auditability

Accepting a structure should record:

- who accepted it;
- timestamp;
- evidence snapshot;
- confidence;
- owner corrections;
- omitted/ignored items and reasons;
- current structural-map version.

The map should be refreshable. A manifest or Git-root change should mark the
map partially stale and ask for review only where the diff changes routing,
memory, commands, or Git authority.

## Open Questions

- Should accepted structural maps live in committed `.guildhall/` shared state,
  local state, or both with separate owner-approved and machine-observed
  layers?
- How much of the structure review belongs in first-run setup versus a quiet
  "Project map needs review" card after initial indexing?
- What is the minimum structural map needed before a task can start?
- Should cross-cutting concerns be manually accepted before they influence
  prompts, or can high-confidence concerns be included as proposed context with
  visible caveats?
- How should stale package graph evidence interact with fresh source-file
  evidence when manifests are old but code movement is obvious?
- What is the right model-specific context budget: fixed character caps,
  token-estimated caps, or role/model profiles?
- Should on-demand context handles be exposed only to agents, or also as UI
  drill-ins for owners?

## Risks

- **Over-structuring:** Guildhall may turn a normal repo into a bureaucracy of
  domains. Mitigation: keep package graph, domain graph, and executable units
  separate; require owner review for authority.
- **Under-scoping:** Guildhall may route a cross-cutting task as package-local
  work and miss downstream proof. Mitigation: activate cross-cutting concerns
  from files, tests, docs, and scripts.
- **Prompt flooding:** domain/global/cross-cutting context can overwhelm the
  worker. Mitigation: required/high/medium/low/excluded tiers, summaries,
  handles, and auditable omissions.
- **Stale memory:** old handoffs may override current code. Mitigation:
  confidence/freshness/risk and structural-map evidence fingerprints.
- **Git mistakes:** nested child Git roots or vendored roots may be mishandled.
  Mitigation: detect Git authority separately and show ignored roots with
  reasons.
- **Language bias:** first implementation may overfit JS/TS workspaces.
  Mitigation: acceptance fixtures must cover Python, Rust, PHP, .NET, docs-only,
  and class/module architectures.
- **False confidence from docs:** docs can describe desired architecture rather
  than current behavior. Mitigation: mark docs-only inference as low or medium
  unless corroborated by manifests, source, tests, or scripts.

## Acceptance Criteria

1. Given a repo with no `guildhall.yaml`, structural discovery can produce a
   draft map without creating registration/config files in the target repo.
2. Given Jess, discovery proposes one top-level Git authority root, ignores
   dependency Git metadata, identifies pnpm packages, records root and
   package-local executable units, and proposes domain groups plus node-copy
   reduction/parser parity cross-cutting concerns.
3. Given Jess core runtime work, context includes the task/spec, core domain
   summary, node-copy reduction concern summary, direct dependency/verification
   summary, and handles for full docs/package graph instead of dumping all
   package docs.
4. Given a Python src-layout project, discovery can distinguish installable
   package, framework domains, tests, and executable units without requiring a
   monorepo.
5. Given a Rust Cargo workspace, discovery can distinguish crates, workspace
   root gates, crate-local tests, and cross-cutting concerns such as feature
   flags or serialization compatibility.
6. Given a PHP Composer/Symfony or Laravel project, discovery can infer
   framework modules/domains and commands even when Composer defines only one
   root package.
7. Given a .NET solution, discovery can infer solution/project references,
   test projects, namespaces, and executable units.
8. Given a docs-only or planning corpus, discovery can propose document-domain
   groups and proof paths without inventing package/build structure.
9. Given nested Git roots, discovery classifies them as child authority,
   vendored/generated, or ignored with evidence and owner-reviewable reasons.
10. Context packets record included, summarized, handle-only, and omitted
    context blocks, with auditable reasons for omissions.
11. Memory records created or selected by the feature carry scope, confidence,
    freshness, risk, evidence refs, and structural-map version/fingerprint.
12. The UI review surface lets the owner accept, rename, merge, split, ignore,
    or defer proposed domains and cross-cutting concerns before they become
    routing authority.
13. Refreshing the map after manifest, Git, or major source changes marks only
    affected items stale and does not force the owner to re-review unchanged
    structure.
14. Context-debug or equivalent audit output can explain why a task received a
    domain context, a global context, a cross-cutting concern, a dependency
    summary, or none of the above.

## Implementation Notes for Later Planning

The first implementation plan should likely split this into:

1. deterministic structural inventory and Git authority classification;
2. manifest/package graph adapters for JS/TS plus fixture interfaces for other
   ecosystems;
3. domain/cross-cutting inference and owner review model;
4. context-budget planner with summary/handle/omission ledger;
5. memory scope integration;
6. Jess fixture tests plus non-Jess synthetic fixtures.

The implementation should reuse existing Corpus Map, effective memory,
context-debug, workspace-config, and pressure-test intake concepts where they
fit, but it should not pretend those current surfaces already provide the full
0.11.0 structural map.
