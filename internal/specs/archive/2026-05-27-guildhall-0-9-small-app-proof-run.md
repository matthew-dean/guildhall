# Small app proof run

**Status:** 0.9.0 implementation spec

**Purpose:** Define one app-sized fixture that lets us watch Guildhall push real
work through its whole lifecycle: intake, pressure testing, hierarchy shaping,
runtime execution, implementation, review, gate, proof path, completion
handoff, memory, and MCP/context audit.

This is not a marketing demo. It is a release proving lane. The app must be
small enough to finish, but broad enough to expose whether Guildhall's
hierarchy, work list, runtime evidence, proof, memory, and handoff story
actually works.

## Why This Exists

0.9.0 has many moving pieces. Unit tests can prove the pieces individually, but
they do not prove that Guildhall can take a compact product idea and turn it
into trustworthy completed project work with minimal useful supervision.

The proof run should answer:

- Did Guildhall shape the user's rough intent into the right hierarchy?
- If the directory had zero information, did Guildhall guide the user into a
  clear product direction instead of stalling on missing repo evidence?
- Did it ask useful questions and avoid unnecessary ones?
- Did it run commands inside the runtime and preserve evidence?
- Did it create a useful proof path before claiming completion?
- Did review/gate catch real quality issues?
- Did the final handoff explain the result without transcript archaeology?
- Did accepted memory or memory proposals capture what should improve next
  time?
- Could MCP answer what happened without shell fallback?
- Did the work list make current/done/blocked/nested work understandable?

## Fixture App

Use a deliberately tiny app called **Pantry Pulse**.

Product idea:

> Build a small local web app that tracks pantry items, highlights what expires
> soon, and lets the user mark an item as used.

Why this shape:

- It has visible UI.
- It has a small data model.
- It has one meaningful interaction flow.
- It needs runtime-backed dev-server proof.
- It can be implemented without external services.
- It can fit in a throwaway fixture project.

## Required Product Behavior

Pantry Pulse must include:

- A page titled `Pantry Pulse`.
- A seeded list of at least five pantry items.
- Each item shows name, category, quantity, and expiration date.
- Items expiring within seven days are visually distinguished.
- A filter lets the user switch between all items and expiring-soon items.
- A `Mark used` action removes or marks an item as used.
- A visible count updates after marking an item used.

Out of scope:

- User accounts.
- Remote persistence.
- Barcode scanning.
- Notifications.
- Multi-page navigation.
- Real database setup.
- Deployment.

## Fixture Project

Create fixture files under:

- `internal/fixtures/app-spec-smoke/spec.md`
- `internal/fixtures/app-spec-smoke/completion-boundary.md`
- `internal/fixtures/app-spec-smoke/expected-hierarchy.md`
- `internal/fixtures/app-spec-smoke/proof-checklist.md`
- `internal/fixtures/app-spec-smoke/run-report-template.md`
- `internal/fixtures/app-spec-smoke/recorded-run.md`

The implementation project can be generated in a temp/worktree fixture during
the run. It should be a minimal app stack that 0.9 runtime images can run
without external setup. Prefer a tiny Vite/Svelte or plain Vite app if the repo
already has compatible tooling; otherwise use the smallest Node static server
fixture that still exercises UI and browser proof.

## Separate Zero-Information Directory Scenario

This is a separate test lane from Pantry Pulse. Pantry Pulse tests whether
Guildhall can complete a fixed app spec into a working app. The blank-folder
scenario tests whether Guildhall can create a reviewed initial spec and
hierarchy from scratch when the directory has no information.

Fixture file:

- `internal/fixtures/zero-info-spec-intake/scenario.md`

Scenario:

1. Create a brand-new directory with no source files, no README, no
   `package.json`, no `guildhall.yaml`, and no meaningful project history.
2. Register/open that directory in Guildhall.
3. Give Guildhall only a rough user idea, for example:

   > I want to build a tiny pantry tracker app, but I have not chosen a stack
   > or written anything down yet.

4. Observe whether Guildhall can guide the owner from zero repo evidence to a
   clear app direction, completion boundary, first hierarchy, and first runnable
   setup/implementation path.

This scenario should test project-definition quality, not just implementation.
The key question is: when the folder knows nothing, does Guildhall help the user
shape the idea, or does it expose internal setup gaps and make the user invent
the process?

Expected behavior:

- Guildhall orients the user that the folder is empty without treating that as
  a failure.
- Guildhall asks a small number of high-value questions about product intent,
  target user, platform/stack preference if genuinely needed, non-goals, and
  completion boundary.
- Guildhall proposes reasonable defaults when the user has no preference,
  instead of blocking on choices like framework/tooling unless those choices
  affect the product or runtime proof.
- Guildhall creates an app-level containing work item and a first feature-level
  containing work item from the idea.
- Guildhall creates setup/implementation/proof work underneath that hierarchy.
- Guildhall identifies the first safe next action, such as scaffold minimal app
  shell, choose default local web stack, or ask one remaining product question.
- The Thread explains what Guildhall inferred, what it still needs, and what it
  will do next in owner language.
- The Work list shows the blank-project idea as shaped work, not as a confusing
  special meta-intake state.
- If stack choice is delegated to Guildhall, the final handoff records the
  rationale and any tradeoffs.

Acceptance criteria:

- Starting from an empty directory, the user can reach a reviewed initial app
  spec and hierarchy without editing files manually.
- The run records every owner question and classifies it as necessary,
  avoidable, or non-delegable.
- No question asks the user to choose a Guildhall process path such as parent
  task versus task path.
- The final shaped plan names:
  - the app goal;
  - the first feature;
  - the stack/tooling assumption or chosen default;
  - non-goals;
  - completion boundary;
  - proof path;
  - first runnable work item.
- Any failure to infer a reasonable default becomes a tracker follow-up.

## Expected Hierarchy

Before the run, define the expected work hierarchy. Guildhall may improve it,
but deviations should be recorded and judged.

Expected shape:

```text
Pantry Pulse app spec
  Pantry item list feature
    Build seeded pantry data model
    Build item list and expiring-soon visual state
    Build all / expiring-soon filter
    Build Mark used interaction and count update
  Runtime proof and completion
    Run automated unit/component checks
    Start runtime dev server
    Browser-proof expiring-soon filter and Mark used flow
    Produce completion handoff
```

This hierarchy intentionally includes:

- an app-level containing item;
- a feature-level containing item;
- implementation work;
- verification/proof work;
- a completion handoff item or completion boundary.

The hierarchy is not a rigid answer key. It is a pressure-test artifact: if
Guildhall chooses a different hierarchy, the run report should explain whether
that was better, worse, or merely different.

## Completion Boundary

The app-level work item can be marked complete only when:

- all required child work is done or explicitly deferred with rationale;
- the app can be launched inside the runtime;
- runtime command evidence exists for install/build/test or the fixture's
  equivalent checks;
- runtime dev-server evidence exists with host port mapping;
- browser proof exists for:
  - opening the app;
  - seeing seeded items;
  - switching to expiring-soon filter;
  - marking one item used;
  - seeing the count update;
- review/gate records exist and approve completion;
- completion handoff includes:
  - what was built;
  - how to launch it;
  - what was verified;
  - what remains out of scope;
  - known risks or residual uncertainty;
  - links/refs to runtime evidence and proof path;
- memory candidate(s) are generated for any repeated lesson or workflow miss;
- MCP/context audit can summarize the run without direct shell reads.

## Run Phases

1. **Seed fixture:** Create/register the fixture project and record the initial
   app spec.
2. **Intake and pressure test:** Let Guildhall ask only questions that affect
   vision, completion boundary, quality, or non-delegable judgment.
3. **Hierarchy shaping:** Guildhall creates or updates the work hierarchy.
4. **Runtime preparation:** Runtime is stopped by default, then starts on
   command/dev-server/proof work.
5. **Implementation:** Agents build the app in scoped work items.
6. **Review:** Reviewer checks product behavior, code quality, test adequacy,
   and proof path.
7. **Gate:** Gate checker verifies required commands and proof records.
8. **Runtime proof:** Start dev server, expose host URL, run browser proof.
9. **Completion handoff:** Produce owner-readable summary with evidence refs.
10. **Memory and MCP audit:** Record memory candidates and verify MCP can
    explain context, runtime evidence, hierarchy, and completion.
11. **Run report:** Classify misses and feed them back into the tracker.

## Owner Intervention Classification

Every owner/human intervention should be classified:

- **Necessary:** Product judgment, non-delegable permission, external account
  setup, or real ambiguity.
- **Avoidable:** Guildhall asked because it lacked a heuristic, failed to use
  context, or punted system responsibility to the user.
- **Non-delegable:** Security, credential, payment, external legal/business
  decision, or host permission.

The release goal is not zero questions. The goal is the minimum useful
supervision.

## Evidence To Capture

The run report must include:

- initial spec path/ref;
- final hierarchy;
- zero-information intake transcript summary when running the blank-folder
  scenario;
- each work item status and completion boundary;
- runtime command evidence refs;
- dev-server and host-port evidence;
- browser proof refs/screenshots if available;
- review verdicts;
- gate results;
- completion handoff;
- memory candidates and accepted/rejected status;
- MCP resources/tool outputs used for audit;
- owner interventions and classification;
- misses added back to implementation tracker.

## Work List Checks

During the run, verify the work list:

- shows active/current work by default;
- hides done work by default;
- makes done work easy to reveal;
- shows nested work without requiring every ancestor to be opened;
- distinguishes hierarchy from dependencies;
- makes owner-needed action obvious;
- does not use "parent task" as the primary user-facing category.

## MCP/Context Audit Checks

MCP should be able to answer:

- What project is this?
- What work hierarchy exists?
- Which work items are active, blocked, ready, done, or hidden by default?
- What runtime evidence exists?
- What proof path proves the app?
- What memory did Guildhall use or propose?
- What is the final completion handoff?

If MCP cannot answer without shell fallback, the miss belongs in the MCP
milestone.

## Failure Handling

If the run fails, it is still useful. The report should identify whether the
failure was:

- runtime setup;
- hierarchy shaping;
- over/under-questioning;
- implementation quality;
- review miss;
- gate/proof gap;
- UI/work-list confusion;
- blank-project orientation or setup confusion;
- memory recording/retrieval;
- MCP visibility;
- completion overclaim.

Each failure should map to an existing milestone or create a new follow-up.

## Release Acceptance

This spec is satisfied when one Pantry Pulse run creates the app and reaches
its defined completion boundary, one separate zero-information directory run
reaches a reviewed initial app spec and hierarchy, and a reviewer can
understand both results through Guildhall's UI/API/MCP evidence without reading
the raw transcript.
