# Guildhall 0.9.0 Evidence-To-Work-Graph Intake

## Problem

Guildhall currently turns rich source evidence into flat tasks too often. In
Looma + Knit, source docs described a system of related deliverables:
component primitives, shared foundations, consuming Knit surfaces, and
migration proof. Guildhall reduced that into vague tasks like "Build
AlertDialog primitive" with no durable spec, no acceptance criteria, no
dependency graph, and no required Knit integration task.

That failure is not specific to UI components. The same class of failure can
happen with API endpoints, data migrations, background workers, docs programs,
SDK modules, compliance rollouts, infrastructure setup, or any source evidence
that describes related deliverables.

Guildhall 0.9.0 must intake structured source evidence as a work graph, not as
a pile of independent text snippets.

## Core Requirement

When source evidence describes multiple related deliverables, Guildhall must
produce a predictable task graph:

- one implementation task per independently deliverable unit
- explicit dependencies for prerequisite units
- explicit related-task links for blockers, shared foundations, and follow-up
  integrations
- separate integration tasks when a reusable unit is needed by a consuming
  product, package, workflow, runtime, or doc surface
- acceptance criteria and proof paths appropriate to each task kind
- reconciliation of duplicate or vague existing tasks into the structured graph
- scheduling that respects dependency readiness

The system should use domain nouns from the source evidence, but the method is
generic. "Component" is just one possible deliverable kind.

## Methodology

### 1. Evidence Extraction

Guildhall reads roadmap, audit, inventory, migration, planning, and checklist
sources and extracts candidate deliverable units. A deliverable unit is work
that can be accepted or deferred independently.

Each unit should carry:

- `name`: source-facing deliverable name
- `targetArea`: repo/package/product/workflow area
- `producedArtifact`: public artifact when known, such as `ui-alert-dialog`,
  `/api/audit/export`, `retention_worker`, or `docs/security/retention.md`
- `need`: why this unit exists
- `sourceRefs`: file paths and evidence snippets
- `statusHint`: missing, shipped, in-progress, blocked, or unknown

### 2. Relationship Extraction

Guildhall extracts relationships before it creates or schedules tasks:

- `buildsOn`: prerequisite deliverables or known foundations
- `sharedFoundations`: reusable primitives/modules/contracts this unit should
  reuse instead of inventing
- `consumerSurfaces`: consuming products/workflows that need the unit
- `blocks`: downstream units that cannot start until this unit is complete
- `integratesWith`: systems that need explicit integration proof

These relationships can be explicit in text, implied by tables, or inferred
from stable repo conventions. Inference must be recorded as lower-confidence
evidence, not hidden inside the agent transcript.

### 3. Work Graph Materialization

Guildhall materializes tasks from the normalized unit graph.

Implementation tasks:

- build or repair one deliverable unit
- reuse named foundations
- expose the public contract
- include automated and review proof

Integration tasks:

- wire an implemented deliverable into a consuming surface
- depend on the implementation task
- prove the real consuming product/workflow works
- include runtime/browser/CLI/API proof depending on the domain

Research or decision tasks:

- are created only when the evidence truly cannot decide a product or technical
  direction
- must be linked as blockers to the implementation tasks they unblock

### 4. Reconciliation

Before creating tasks, Guildhall checks existing tasks for duplicates and vague
fragments. If a vague task matches a structured unit, Guildhall reframes it
instead of creating a competing task.

For example, an existing blocked task titled "Build AlertDialog primitive" must
become the structured AlertDialog implementation task, with acceptance criteria,
proof paths, related tasks, and dependencies filled in from source evidence.

### 5. Scheduling

The coordinator may not dispatch work whose dependencies are incomplete. It
should schedule prerequisite implementation or decision tasks first, then
downstream integrations. If a user opens a downstream task, the UI should show
the blocker chain instead of inviting another vague retry.

## Proof Contracts

Every generated task must have a proof contract. The details vary by domain,
but the shape is stable.

Implementation task criteria:

- source implementation exists in the target area
- public contract/export/entry point is present
- named foundations are reused or deviation is justified
- design/system/policy conventions are followed
- accessibility/security/reliability contract is met when relevant
- automated proof command or deterministic review proof exists

Integration task criteria:

- consuming surface imports or calls only the public contract
- real consumer flow renders or executes the deliverable
- runtime proof exists: browser, CLI, API, worker, migration, or docs build
- look/feel/policy/operational fit is reviewed against consumer conventions
- regression test covers the integration

## 0.9.0 Fixtures

### Fixture A: Looma + Knit UI Primitives

Source evidence:

- Looma component audit lists `Dialog` shipped, `AlertDialog` missing, `Drawer`
  missing.
- `AlertDialog` builds on `Dialog` and `Button`.
- Knit needs `AlertDialog` for destructive confirmation.

Expected graph:

- implementation task: build `ui-alert-dialog`
- dependency: existing or completed `ui-dialog` foundation
- shared foundations: `ui-dialog`, `ui-button`
- integration task: wire AlertDialog into Knit destructive confirmation flow
- proof: Looma component tests, public Vue export, Knit e2e/browser proof,
  token/look-feel review

### Fixture B: Data Retention Compliance Pipeline

Source evidence:

- launch plan lists retention policy schema, retention worker, audit export API,
  and compliance dashboard integration.
- worker depends on policy schema and audit cursor.
- dashboard depends on export API and worker status.

Expected graph:

- implementation task: retention policy schema
- implementation task: retention worker, blocked by schema
- implementation task: audit export API
- integration task: compliance dashboard integration, blocked by worker and API
- proof: migration tests, worker dry-run proof, API contract test, dashboard
  runtime proof, operational runbook review

This fixture proves the behavior is not UI-component-specific.

## Initial Test Plan

Add small behavioral tests around each expectation:

- extracts deliverable units instead of one vague task
- preserves foundation and dependency relationships
- splits reusable deliverables from consuming integration work
- generates implementation proof contracts
- generates integration proof contracts
- applies the same graph rules to a non-UI backend/data fixture
- reconciles duplicate vague tasks into the structured graph
- coordinator refuses to schedule dependency-blocked work

The first red tests live in
`src/runtime/__tests__/evidence-work-graph-intake.test.ts`.

## Implementation Slices

1. Create a pure `planEvidenceWorkGraph` module that accepts source text and
   existing task summaries and returns a normalized work graph. **Done.**
2. Add deterministic parsers for tables, checklists, and dependency phrases.
   **Started for Markdown deliverable tables and dependency phrases.**
3. Add task materialization helpers for implementation and integration tasks.
   **Done for workspace-import approval.**
4. Add duplicate/vague-task reconciliation.
   **Done for import specs that reference structured evidence.**
5. Wire the planner into workspace import/project-understanding repair.
   **Workspace import approval is wired; the live project-understanding repair
   pass still needs Looma + Knit browser/runtime proof.**
6. Add coordinator scheduling checks and UI blocker-chain display for
   dependency-blocked downstream work. **Scheduling is already dependency-aware
   and now has an importer-level regression proving generated graph edges are
   respected. UI blocker-chain display remains future polish.**
7. Run Looma + Knit as live proof and verify the produced backlog matches this
   spec before calling 0.9.0 ready.
