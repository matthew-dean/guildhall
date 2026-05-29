---
title: Guildhall 0.9.0 trust and completeness proposal
---

# Guildhall 0.9.0 trust and completeness proposal

Date: 2026-05-27

## Proposal

Guildhall 0.9.0 should make trust and completeness a first-class product lane.
Runtime isolation makes the work safer to run; this proposal makes the work
safer to believe.

Guildhall's role is to turn rough owner intent into high-quality, inspectable
project work with the minimum useful owner supervision. The owner supervises
judgment, not process. Guildhall owns the pressure: it decides how much
inspection, verification, review, memory, and owner input are needed to make the
work trustworthy.

## Scope

This proposal adds the missing product layer across intake, specs, review,
memory, MCP, UI, and docs:

- durable owner-vision fit;
- durable completeness packets;
- explicit human-supervision budget;
- visible raw-ask-to-proof transformation;
- memory quality gates;
- review pressure-adequacy checks;
- public docs that explain the right value for different users instead of
  leading with machinery.

## Proposed fixes

### 1. Owner-vision fit

Add a durable `visionFit` section to each meaningful task or phase.

Fields:

- inferred owner goal;
- request/source snippets that shaped the interpretation;
- "this would be a miss if..." statements;
- taste, judgment, and risk notes;
- confidence level;
- whether owner confirmation is needed.

Usage:

- Spec Agent writes it during intake/spec shaping.
- Reviewer checks implementation drift against it.
- Completion handoff includes the final vision-fit result.
- MCP exposes it as part of task/context state.

Acceptance criteria:

- A task created from New Request has a `visionFit` record before spec review.
- Review prompts include owner-vision drift checks.
- Completion handoff says whether the final work still matches the inferred
  owner goal.

### 2. Completeness packet

Promote `pressureTestSummary` into a durable `completenessPacket`.

Fields:

- intent;
- owner-vision fit;
- task boundary;
- assumptions;
- deferrals;
- acceptance-criteria readiness;
- verification/TDD plan;
- reviewer lenses;
- evidence consulted;
- owner-only calls;
- risk and release boundary.

Usage:

- Request intake seeds the packet.
- Spec Agent refreshes it as repo evidence and user answers arrive.
- Worker and reviewer context includes a compact packet summary.
- MCP can answer "why is this ready?" from structured state.

Acceptance criteria:

- Existing pressure-test summary data migrates or normalizes into the packet.
- Every build-changing task has a packet before implementation.
- Approval to leave spec review fails or warns when required packet sections are
  missing.

### 3. Human-supervision budget

Every owner question and owner-facing blocker should explain why Guildhall needs
the owner instead of deciding automatically.

Fields:

- decision type: product intent, quality bar, risk, release, taste, external
  setup, policy, credential, or unknown;
- what Guildhall inferred;
- why Guildhall cannot safely decide;
- what happens after the answer;
- whether a safe default exists.

Acceptance criteria:

- `post-user-question` records decision type and "why owner needed" metadata.
- Thread and Needs You render that explanation in plain language.
- Review checks flag owner questions that are really routine system decisions.

### 4. Visible alchemy loop

Add a task/phase surface that shows how Guildhall transformed messy input into
trusted work:

`raw ask -> pressure/completeness packet -> spec -> implementation proof -> review verdict -> memory candidates`

Usage:

- UI: task drawer or Thread detail gets "Why this is ready / blocked / done."
- MCP: expose the same chain for external agents.
- Completion handoff: include a concise owner-facing version.

Acceptance criteria:

- For a completed task, the owner can see the raw ask, spec, proof, review, and
  memory candidates without reading the transcript.
- For a blocked task, the owner can see exactly which link in the chain is
  missing.

### 5. Memory quality gates

Memory should be curated learning, not transcript residue.

Add memory candidate records with:

- source/provenance;
- scope: user, project, repo, task, release;
- confidence;
- staleness/expiry rule;
- surfacing rule;
- status: pending, accepted, rejected, superseded;
- reason it should affect future agents.

Acceptance criteria:

- Agents propose memory candidates instead of silently writing broad lessons.
- Accepted memory appears in future task context with provenance.
- MCP can explain what memory exists, where it came from, and when it should
  surface.

### 6. Pressure adequacy in review

Review should check whether enough pressure was applied, not only whether the
output looks correct.

Reviewer checks:

- Was the pressure degree right for the work?
- Were reviewer lanes sufficient?
- Was verification strong enough?
- Did implementation drift from owner vision?
- Are assumptions and deferrals still valid?
- Did the agent guess something that needed owner judgment?

Acceptance criteria:

- Review planner includes pressure-adequacy criteria.
- Reviewer prompts include missing-pressure checks.
- Calibration corpus includes cases where the implementation is plausible but
  the applied pressure was insufficient.

### 7. Public value story

Public docs should explain what each reader can get from Guildhall, not just how
subsystems work. Trust matters, but it is not the only reason someone uses the
product. Different readers care about different outcomes:

- casual vibe coders may care most about flow, speed, and not getting stuck;
- serious full-time developers may care about completeness, tests, review, and
  finishability;
- CTOs or small-company technical leaders may care about quality, security,
  governance, auditability, and whether agentic work can be trusted around a
  real codebase.

Docs checklist:

- Does the page make clear which reader need it serves: flow, quality,
  finishability, trust, security, governance, or auditability?
- Does it say what the owner can rely on for that need?
- Does it avoid leading with internal process?
- Does it connect runtime, memory, MCP, proof, and review back to finishability?
- Does it avoid flattening every feature into a trust claim when speed,
  ergonomics, or developer focus is the stronger reader value?

Acceptance criteria:

- 0.9 release docs include value paths for at least casual project work,
  serious developer work, and technical-leader quality/governance concerns.
- Runtime, memory, MCP, proof, and review docs point back to the relevant value
  path instead of reading like separate internal systems.
- Public docs pass copy checks and include screenshots for changed owner-facing
  UI.

## Milestones

1. **Schema and migration:** add `visionFit`, `completenessPacket`, owner
   decision metadata, and memory candidate schema.
2. **Intake/spec integration:** seed and refresh packets from request intake,
   pressure-test intake, and Spec Agent work.
3. **Review integration:** add pressure-adequacy review planning, prompts, and
   calibration cases.
4. **Memory integration:** add memory candidates, acceptance flow, effective
   memory packet, and MCP visibility.
5. **UI/MCP proof chain:** expose "why this is ready / blocked / done" in owner
   UI and MCP resources.
6. **Public docs pass:** update docs and screenshots around the reader-value
   paths.

## Non-goals

- Do not make every small task visibly ceremonial.
- Do not ask the owner to choose pressure level.
- Do not store full transcripts as memory just because they exist.
- Do not block implementation on perfect certainty when a safe default is
  available.
- Do not claim autonomous trust without proof paths and review evidence.

## Open questions

- Should `completenessPacket` live directly on `Task`, inside `requestIntake`,
  or as a linked artifact under `.guildhall/artifacts`?
- Should owner-vision fit be required for every task, or only every
  build-changing task?
- Which packet fields should block spec approval versus warn and record a
  deferral?
- How much of the proof chain belongs in the primary task drawer versus a
  drill-in artifact?
