# Guildhall Project Contract Governance

**Status:** Proposal  
**Date:** 2026-06-05  
**Owner:** Guildhall runtime and project-state architecture  
**Related:** `docs/reference/memory-layout.md`, `docs/cli/reference.md`, `src/runtime/migrations.ts`, `internal/specs/2026-06-05-guildhall-0-10-primitives-and-delivery-spine.md`

## Thesis

Software projects are held together by contracts. Some are formal, such as
schemas, APIs, MCP tools, persisted state, and validation schemas. Some are
practical, such as UI primitives, design tokens, auth guards, runtime startup
behavior, test harnesses, docs promises, and delivery workflows.

Guildhall should model those contracts directly and reason about what work
touches them. A task, spec, diff, agent contract result, or finished-work intake
should be analyzed as:

```text
What contracts does this touch?
What obligations come with those contracts?
What proof satisfies those obligations?
What compatibility or migration decision is needed?
Who reviews or waives the obligation?
```

The rule should be:

> Authoritative work cannot be accepted until Guildhall has identified the
> touched contracts, satisfied their obligations, or recorded an explicit
> waiver/no-touch decision.

Schema migration is one contract type. Primitives, APIs, MCP resources, UI
behavior, data migrations, proof plans, and finished-work intake are other
contract types.

## Scope

This spec covers project contracts Guildhall should infer or require from
multiple triggers:

- spec intake;
- task planning;
- code diffs and finished work;
- tests, screenshots, browser/API proof, and failures;
- owner corrections;
- accepted agent results;
- finished-work intake;
- runtime/migration state;
- MCP/tool/resource changes;
- docs/help/release changes.

Examples:

- persisted project/workspace/machine/runtime/local-history schema changes;
- task, primitive, driver, proof, or validation-evidence state changes;
- UI component or design-system primitive changes;
- API/client/schema/contract changes;
- security/auth/permission changes;
- data migrations and rollback obligations;
- MCP resources and tools;
- docs/help/release note changes;
- tests, Storybook, screenshots, and browser/API proof;
- accepted structured agent contract result shapes.

This spec does not require heavyweight ceremony for every small edit. It does
require Guildhall to know which contracts were touched, and to prove that their
obligations were satisfied, waived, or intentionally not applicable.

## Current System

Guildhall currently has these pieces:

- `src/runtime/migrations.ts` defines migration ids, introduced versions, scope,
  safety, requirement, detect hooks, apply hooks, and ledger records.
- `.guildhall/migrations.json` records applied project migrations.
- `guildhall migrate status|plan|apply` reports pending, blocked, and applied
  migrations.
- Required migrations block project start and project mutation paths.
- Runtime compatibility state can block a runtime that is too old to safely
  read a project.
- review levers and proof expectations for risky domains;
- task readiness/start gates;
- structured agent tools with Zod schemas.

These are good foundations. The gap is that they are not unified as a project
contract model. Schema migrations have some registry support, but UI, API, MCP,
primitive, proof, review, docs, and finished-work contracts can still be missed
unless an agent happens to reason about them.

## Contract Touch Triggers

Work consequence is one trigger, not the model. Guildhall should detect contract
touches from several sources:

| Trigger | What it can reveal |
| --- | --- |
| Spec intake | intended contracts, proof obligations, delivery drivers |
| Task planning | proposed contract touches before work starts |
| Code diff / finished work | actual contract touches produced by implementation |
| Finished-work intake | contracts already established outside Guildhall |
| Test/proof failure | missing or broken contract obligations |
| Owner correction | explicit contract, proof, or priority truth |
| Agent structured result | proposed durable contract state |
| Runtime/migration status | compatibility and persisted-state contracts |
| MCP/tool changes | external agent-facing contracts |
| Docs/help/release changes | user-facing promises and support obligations |

Each trigger feeds the same contract model. The model is not "whatever changed
in the diff"; the model is the set of contracts Guildhall knows about and the
obligations attached to touching them.

## Living Contract Registry

Project contracts should be living project state, not a checklist that runs only
after Guildhall finishes a task.

Guildhall should maintain a contract registry with:

- contract id, label, type, owner/provider, paths, and consumers;
- invariants and obligations;
- proof requirements;
- current validation state;
- evidence references;
- last observed source;
- last validated time;
- stale/invalidated reasons when known;
- links to tasks, primitives, APIs, MCP tools, docs, and finished-work intake
  records.

Contract validation states:

- `proposed`: plausible contract, awaiting owner review or proof;
- `observed`: found in existing or finished external work, but not yet proven;
- `validated`: proof currently satisfies the contract;
- `needs_proof`: contract exists but proof is missing or incomplete;
- `possibly_violated`: evidence suggests the contract may be broken, but
  Guildhall needs targeted proof or owner review before treating it as broken;
- `violated`: failing proof, owner correction, runtime state, or finished-work
  intake shows the contract is currently broken;
- `invalidated`: recent work, failing proof, or owner correction shows the
  contract no longer holds;
- `deprecated`: contract should no longer guide new work, but remains useful for
  migration or compatibility context.

Intake should reason about contracts directly:

- spec intake proposes intended contracts and obligations;
- finished-work intake reconstructs contracts that already exist outside
  Guildhall;
- corpus intake can attach observed proof from tests, docs, Storybook, commits,
  PRs, and release notes;
- runtime/migration intake can mark persisted-state contracts blocked or
  incompatible;
- owner corrections can validate, rename, merge, reject, or invalidate
  contracts.

This means Guildhall can ask, before starting a task:

```text
Which contracts already exist?
Which are validated right now?
Which are observed but unproven?
Which are violated or possibly violated?
Which contracts will this task touch?
Which missing proof or invalidated contract should be handled first?
```

The answer should come from the current contract registry, not from the last
task completion event.

## Contract Pressure

Touching a contract does not automatically mean the work is wrong. Sometimes
the work should change to comply with the contract. Sometimes the contract is
outdated and should change. Sometimes the contract is a rule governed by other
contracts, not a unit of code.

Guildhall should treat this as contract pressure:

```text
Work wants X.
Current contract says Y.
Guildhall decides whether to comply with Y, propose changing Y, prove Y is
missing/stale, or ask the owner.
```

Default decision flow:

1. Try to comply with the existing validated contract.
2. If proof is missing, add or run the smallest proof before changing behavior.
3. If the contract appears wrong or outdated, propose a contract update instead
   of forcing the work to bend around stale rules.
4. If changing the contract touches parent contracts, walk only the necessary
   dependency chain.
5. Ask the owner only when the choice changes product intent, risk, public
   behavior, security posture, or a high-value project rule.

This keeps human input focused on intent/risk decisions. Guildhall should not
ask the owner every time a contract is touched.

Contract pressure states:

- `satisfied`: current work fits the contract;
- `needs_proof`: the contract may be fine, but proof is missing;
- `possibly_violated`: evidence suggests mismatch, targeted proof needed;
- `change_proposed`: Guildhall proposes updating the contract;
- `blocked_for_decision`: owner decision needed because intent/risk changes;
- `violated`: contract is broken and needs repair, update, or waiver.

## Contract Dependencies

Contracts can depend on other contracts. A UI primitive can depend on a focus
rule. An API client can depend on an error-envelope contract. A schema can
depend on a migration/rollback contract. A rule can govern code without being a
unit of code itself.

Dependency rules:

- store contract dependencies explicitly when known;
- derive inverse consumers for review and worker context;
- when a contract change is proposed, inspect direct parent contracts first;
- recurse only when a parent contract would be violated, possibly violated, or
  changed by the proposal;
- stop traversal when proof shows the parent still holds;
- escalate to owner review only when the chain reaches an ambiguous or
  high-risk intent decision.

Example:

```text
ContextMenu behavior
  uses Menu contract
    uses MenuItem contract
      governed by Focus behavior rule
      governed by Interactive reset rule
```

If ContextMenu needs link-style menu items, Guildhall should first check whether
MenuItem already supports and proves link rendering. If not, it can propose
MenuItem proof or a MenuItem contract update. It should not immediately ask the
owner unless the update changes product/design intent or breaks a parent rule.

## Project Contract Types

Guildhall should classify contract touches by type. A task, spec, diff, or
intake result may touch several contracts.

| Contract type | Typical obligations |
| --- | --- |
| Persisted state | Migration decision, compatibility reader, runtime block, old-data fixture |
| UI/component | Storybook states, interaction/e2e proof, design-system/primitive check |
| API/client | Contract tests, client updates, docs, schema compatibility |
| Data/storage | Migration, rollback or validation proof, old-data fixture |
| Security/auth | Threat/risk review, permission tests, audit evidence |
| MCP/tooling | Tool/resource schema update, MCP smoke proof, docs |
| Agent contract | Result schema, validator tool, retry path, apply/revert record |
| Finished-work intake | Corpus evidence, observed proof, missing proof, future tasks |
| Documentation/help | Public docs, help topic, release note, owner-facing wording |
| Release/runtime | start gate, stale-server/runtime proof, rollback/compatibility note |

The contract-touch detector should be conservative. If it is unsure, it should
ask for a short structured decision instead of silently dropping the contract.

## Contract Touch Decision

Every touched contract needs a decision.

Template:

```md
- Work id:
- Touched contracts:
- Possible contracts considered but not touched:
- Required follow-up:
- Proof required:
- Proof provided:
- Waivers:
- Owner-review items:
- Apply/revert behavior:
```

Rules:

- If a contract is touched, either satisfy its obligations or record why they
  are waived.
- If a contract is considered but not touched, record the no-touch reason when
  the detector flagged it.
- If a touched contract creates durable state, use the schema/migration section
  below.
- If an agent creates structured state, validate it before applying.
- If external finished work is ingested, separate observed shipped context from
  future Guildhall tasks.

## Schema Migration Lane

Persisted schema changes are one important contract type. Guildhall already has
a migration registry, so this contract type should plug into that registry rather
than invent a separate path.

### Schema Change Classes

Every durable schema edit must be classified as one of these:

### No Durable Schema Change

The changed type is not persisted, is request-local only, or is a derived
projection that can be recomputed from existing persisted state.

Required evidence:

- reviewer-readable note explaining why no stored data can be affected.

### Backward-Compatible Reader Change

Existing persisted state remains valid. The reader accepts old data and
normalizes it at read time without mutating files.

Examples:

- adding an optional field with a default;
- accepting an old enum value while rendering a new label;
- deriving a new field from existing fields.

Required evidence:

- compatibility test that reads old fixture data;
- schema-change note explaining the normalization behavior;
- no migration definition required unless the project should eventually rewrite
  the stored shape.

### Automatic Migration

Guildhall can safely rewrite state without owner judgment.

Examples:

- deterministic field rename with no data loss;
- moving internal evidence from a legacy local path into persistence;
- adding a missing ledger file.

Required evidence:

- migration definition in the registry;
- dry-run/status test;
- apply test;
- idempotence test;
- before/after fixture or inline fixture.

### Prompt-Required Migration

Guildhall can rewrite state, but the change touches project-facing files or may
surprise the owner.

Examples:

- rewriting `.guildhall/TASKS.json`;
- changing tracked config;
- deleting or moving legacy project files.

Required evidence:

- migration definition with `safety: 'prompt'`;
- plan text that names exact affected paths;
- apply test;
- idempotence test;
- UI/API proof that start is blocked when the migration is required.

### Manual Migration

Guildhall cannot or should not apply the change automatically.

Examples:

- runtime-backed project adoption;
- migrations requiring external service setup;
- data moves that need owner verification outside the checkout.

Required evidence:

- migration definition with `safety: 'manual'`;
- status/plan text that explains the manual steps;
- start/readiness behavior that routes the owner to the correct surface when
  the migration is required.

### Breaking Schema Change

New code cannot safely read old data until a migration or compatibility reader
has run.

Required behavior:

- the new runtime must block start/mutation on old state;
- `guildhall migrate status` must explain the required migration;
- the migration must be marked required, or runtime compatibility must declare
  the required feature/schema version.

## Required Migration Decision

Every durable schema change must include a `Schema Migration Decision` block in
the implementation plan, PR description, or internal spec.

Template:

```md
## Schema Migration Decision

- Persisted schema touched:
- Scope: project | workspace | machine | database | local_history | none
- Change class:
- Existing data impact:
- Migration id:
- Safety: automatic | prompt | manual | required | none
- Required before run: yes | no
- Compatibility reader:
- Fixtures added:
- Tests added:
- Owner-facing plan text:
- Rollback/revert behavior:
```

Rules:

- If scope is `none`, explain why the schema is not durable.
- If change class is backward-compatible, add old-data reader tests.
- If change class is automatic, prompt, manual, or breaking, add or update a
  migration definition.
- If no migration is needed, record the no-migration decision explicitly.
- If persisted data can be written by agents or accepted contract results, the
  validation/apply path must be part of the decision.

## Migration Definition Requirements

Each migration definition should include:

- stable id: `<introduced-version>/<short-slug>`;
- title;
- introduced version;
- scope;
- safety;
- requirement when required before run;
- summary;
- detect hook;
- apply hook unless manual;
- affected paths;
- test fixtures;
- idempotence behavior.

Migration ids are durable API. Do not rename them after release. If a migration
needs correction after release, add a new migration id.

## Enforcement Strategy

Guildhall should enforce this at three layers.

### Review Gate

Any review that sees a spec, task plan, code diff, finished-work intake, owner
correction, runtime change, or accepted agent result should ask which contracts
were touched. Durable schema changes should additionally ask for the `Schema
Migration Decision`.

Review should reject the change when:

- touched contracts have no Contract Touch Decision;
- intake produced or changed contracts without registry updates and validation
  state;
- touched contracts are `violated` without a repair task, waiver, or explicit
  owner decision;
- touched contracts are `possibly_violated` without targeted proof or an
  owner-review question;
- schema changed and no Schema Migration Decision exists;
- a migration id is listed but no migration definition exists;
- a required migration has no start/mutation blocking proof;
- a compatibility reader has no old-data fixture test;
- a prompt/manual migration has no owner-facing plan text;
- a migration has no idempotence test;
- UI/API/MCP/security/docs/proof contracts were touched but have no proof,
  waiver, or owner-review item.

### Deterministic Check

Add a repository check that compares changed files against known contract
detector paths and requires a matching Contract Touch Decision. Persisted
schema paths also require a Schema Migration Decision.

Initial detector paths:

- `src/core/**`;
- `src/config/schemas.ts`;
- `src/levers/schema.ts`;
- `src/hooks/schemas.ts`;
- `src/protocol/rich-artifacts.ts`;
- `src/runtime/*state*`;
- `src/runtime/*store*`;
- `src/runtime/*migration*`;
- `src/runtime/migrations.ts`;
- `src/tools/task-queue.ts`;
- MCP resource builders that expose persisted project state;
- UI component and surface files when shared primitives or project navigation
  change;
- docs/help/release files when user-facing behavior changes;
- `internal/specs/**` when they introduce accepted durable schema.

The check should pass when it finds one of:

- a `Contract Touch Decision` block that names touched contracts and proof;
- a migration definition changed in `src/runtime/migrations.ts`;
- a new migration script under `scripts/migrations/`;
- a `Schema Migration Decision` block that declares `Scope: none`;
- a `Schema Migration Decision` block that names a migration id and tests.

The check should be advisory at first, then become required once false positives
are understood.

### Runtime Gate

Runtime gates should remain the last line of defense:

- required migrations appear in blocked migration status;
- project start and project mutations return `required_migration_pending`;
- runtimes that cannot read the declared state schema return `runtime_too_old`;
- migration apply endpoints refuse to run when the runtime is too old to safely
  inspect or mutate project state.

## Agent Contract Interaction

Agent-produced structured state follows the same rule. If an agent result
creates authoritative project state, the change needs a Contract Touch Decision.
If that result shape becomes durable project state, it also needs a Schema
Migration Decision.

Examples:

- adding `delivery.usesPrimitives` to persisted tasks requires a decision;
- adding a primitive registry requires a decision;
- adding validation evidence ledgers requires a decision;
- adding finished-work intake records requires a decision.

The validator tool can normalize contract output, but it does not replace a
storage migration. Normalization handles incoming agent payloads. Migrations
handle already-persisted project data.

## Owner-Facing Behavior

The user should not need to know the schema internals. When migration work is
pending, Guildhall should explain:

- what old state was found;
- why the current runtime cannot safely proceed;
- what files or local-history stores will change;
- whether the migration is automatic, prompt-required, or manual;
- whether the project can be started before the migration;
- how to review the plan before applying it.

Use existing `guildhall migrate status`, `guildhall migrate plan`, and
`guildhall migrate apply` language wherever possible.

## Implementation Plan

### Task 1: Add Contract Touch Decision Template

Files:

- this spec;
- internal planning template or review checklist;
- PR/review docs if present.

Steps:

- [ ] Add the `Contract Touch Decision` template to the internal planning path
  agents use before specs, task plans, code diffs, finished-work intake, owner
  corrections, runtime changes, MCP/tool changes, and accepted agent results.
- [ ] Add the `Schema Migration Decision` template to the internal planning
  path agents use before persisted schema work.
- [ ] Add review wording that touched contracts without a decision are
  incomplete.

### Task 2: Add Living Contract Registry

Files:

- contract registry model;
- contract registry reader/writer;
- contract validation-state tests;
- intake apply paths.

Steps:

- [ ] Define contract records with id, type, owner/provider, paths, consumers,
  invariants, obligations, proof requirements, validation state, evidence, last
  observed source, and last validated time.
- [ ] Define validation states: proposed, observed, validated, needs_proof,
  possibly_violated, violated, invalidated, and deprecated.
- [ ] Add merge/reject/rename/invalidate behavior for owner corrections and
  intake review.
- [ ] Ensure spec intake, finished-work intake, runtime/migration intake, and
  proof results can update the registry.
- [ ] Add tests proving intake can observe an existing contract, attach proof,
  mark missing proof, flag possible violation, confirm violation, invalidate
  stale proof, and feed queue/context decisions.

### Task 3: Add Contract Touch Detector

Files:

- new script under `scripts/`;
- test fixtures for changed-file lists;
- package script.

Steps:

- [ ] Detect changed files and intake sources in contract-owning paths.
- [ ] Infer likely contracts: persisted state, UI/component, API/client,
  data/storage, security/auth, MCP/tooling, agent contract, finished-work
  intake, documentation/help, and release/runtime.
- [ ] Detect a `Contract Touch Decision` block in touched internal specs or
  plans.
- [ ] Detect migration definitions or migration scripts changed in the same
  diff.
- [ ] Detect a `Schema Migration Decision` block in touched internal specs or
  plans.
- [ ] Report missing contract or migration decisions with concrete file paths,
  trigger source, and likely contract types.
- [ ] Start advisory; document how to run it locally.

### Task 4: Add Migration Definition Quality Checks

Files:

- `src/runtime/migrations.ts`;
- migration tests.

Steps:

- [ ] Assert every built-in migration id is stable and unique.
- [ ] Assert required migrations include owner-facing summary and affected
  paths.
- [ ] Assert prompt/manual migrations are not applied by default.
- [ ] Assert each automatic/prompt migration has an idempotence test.

### Task 5: Add Old-Data Fixture Tests For Compatible Readers

Files:

- persisted schema readers;
- fixture directories.

Steps:

- [ ] Add fixtures for old task/config/project-state shapes that should remain
  readable without migration.
- [ ] Test read-time normalization for optional additions and renamed labels.
- [ ] Document when compatibility readers are temporary versus permanent.

### Task 6: Wire Runtime Blocking Proof Into Schema Reviews

Files:

- start/readiness tests;
- migration API tests;
- project mutation tests.

Steps:

- [ ] Require tests for `required_migration_pending` when a required migration
  is pending.
- [ ] Require tests for `runtime_too_old` when runtime compatibility state
  declares a future schema.
- [ ] Ensure migration apply endpoints refuse unsafe runtimes.

### Task 7: Apply To 0.10 Primitive/Delivery Work

Files:

- primitive/delivery schema changes;
- task queue and project summary tests;
- primitive setup/intake validation tests.

Steps:

- [ ] Add a schema migration decision before persisting primitive registries,
  delivery metadata, validation evidence, or finished-work intake records.
- [ ] Decide which additions are backward-compatible optional fields and which
  require registered migrations.
- [ ] Add old-data fixtures proving existing task/project state still loads.
- [ ] Add required migrations only for persisted shapes that old readers cannot
  safely understand.

## Open Questions

- Should the schema change detector become required in CI immediately, or start
  advisory for one release?
- Should schema decisions live only in implementation specs, or should accepted
  decisions also be copied into a machine-readable changelog?
- Should migration definitions carry a `schemaChangeId` field that links back
  to the decision block?
- Which MCP resources should be treated as persisted-schema surfaces versus
  derived presentation surfaces?

## Decision Recommendation

Adopt a simple but strict rule: persisted schema changes require a migration
decision in the same change. Enforce it first in review and with an advisory
deterministic check, then graduate the check to a required gate once the
schema-owning path list is stable.
