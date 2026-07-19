# Guildhall 0.11.0 External Task Authority

**Status:** Deferred to 0.11.0

**Deferral note, 2026-06-06:** This is no longer a 0.10 target. The first
runtime slice listed below remains useful prior work, but full external task
authority belongs in 0.11 after the 0.10 delivery spine and contract-governance
model are the stable local truth layer.

**First runtime slice status, 2026-06-02:**

- [x] Add provider-neutral `ExternalIssueRef` identity and `ExternalTaskMirror`
  records for local execution truth.
- [x] Add inspectable stale/conflict sync state for changed provider fields and
  stale proposed writes.
- [x] Shape execution packets from external issue truth plus repo-local context.
- [x] Record evidence-backed proposed writes and approval/rejection decisions
  before any connector execution.

Guildhall should be able to work inside a project whose real planning and
status authority already lives somewhere else. Jira is the concrete fixture
for this spec through `/Users/matthew/git/work/linkcore`, but the model must
also fit Linear, GitHub Issues, Azure DevOps, Asana, and similar systems.

This is not project registration. LinkCore should not receive a
`guildhall.yaml` as part of this planning lane. The fixture is evidence for
how a serious repo already routes work through external issues, local context,
PRs, review threads, operational dashboards, and work logs.

## Problem

Guildhall's local task model is useful for execution, proof, recovery, memory,
and owner handoff. It is not always the source of planning truth. Mature repos
often already have:

- external issue hierarchy, status, sprint, assignee, and reporting rules;
- branch, commit, and PR policies tied to issue keys;
- local context docs that translate issue domains into files and references;
- work logs that preserve resume-critical evidence without becoming startup
  context;
- operational triage expectations across Jira, GitHub, Grafana, logs, and CI.

If Guildhall imports that work as ordinary local tasks without preserving the
external authority boundary, it can create duplicate planning systems, stale
status, noisy context, and unsafe automation. The 0.11.0 goal is to make
Guildhall a trustworthy local execution mirror for externally-owned work:
strong enough to run, prove, remember, and hand off work locally, but humble
about what it does not own.

## Product Goal

For a repo like LinkCore, a user should be able to point Guildhall at a set of
external tasks, choose which ones to mirror locally, and then let Guildhall:

1. build a bounded execution packet from the external issue plus repo-local
   context;
2. keep a local task mirror linked to the external issue identity;
3. record local proof, branch/PR/evidence, blockers, review outcomes, and
   memory candidates;
4. propose or perform allowed external updates without making Guildhall the
   planning source of truth;
5. show stale or conflicting state clearly when the external issue, PR, branch,
   or local mirror drifts.

Success means Guildhall reduces context-reconstruction work for external
ticket execution without hiding the fact that Jira, Linear, GitHub Issues, or
another system remains authoritative for planning/status.

## Authority Model

The external task system owns planning truth:

- issue identity and canonical URL;
- title, description, issue type, labels, priority, sprint/milestone,
  assignee, reporter, status, resolution, parent, children, dependencies, and
  links;
- team reporting, sprint board state, status transitions, and assignment;
- external comments and status notes that must be visible to stakeholders.

Guildhall owns local execution truth:

- local task mirror id and link to external issue id;
- project path, worktree/branch state, files changed, commands run, proof
  paths, verification records, and completion handoff;
- repo-context packet, context-budget decisions, omitted-context audit, and
  deferred retrieval handles;
- local blocker classification, recovery attempts, task readiness, review
  plans, reviewer verdicts, and gate outcomes;
- local memory candidates derived from repeated project facts or habits;
- proposed external updates and the evidence supporting them.

Guildhall must not own:

- the canonical external issue status unless explicitly authorized by policy
  and connector permissions;
- sprint, assignee, reporter, parent/epic, or priority changes unless the user
  approved that class of write;
- external issue creation as the default import path;
- external comments that claim completion before proof is recorded;
- branch history rewrites, PR edits, or review-thread resolution when repo
  policy requires explicit commands or review-state inspection;
- full raw external transcripts, logs, or comment history as automatic worker
  context.

The local mirror is a cache plus execution ledger, not a forked backlog.

## Data Model

### ExternalIssueRef

Provider-neutral identity for the external authority:

- `provider`: `jira`, `linear`, `github_issues`, `azure_devops`, `asana`, or
  `custom`;
- `cloudOrWorkspaceId`;
- `projectKey` or repository/project namespace;
- `issueKey` and stable provider id;
- canonical `url`;
- `issueType`;
- `title`;
- `status` and provider-specific status category;
- `priority`;
- `sprint` or iteration/milestone;
- `assignee`;
- `reporter` or creator;
- `parentRef`;
- `childRefs`;
- `linkedRefs` with relationship type;
- `labels` and components/areas;
- `updatedAt`, `version`, and optional provider ETag/hash.

### ExternalTaskMirror

The local Guildhall representation:

- `id`;
- `projectPath`;
- `externalRef`;
- `localTaskId`;
- `domain` and `contextRoute`;
- `mirrorStatus`: `candidate`, `mirrored`, `active`, `blocked`, `done`,
  `stale`, `conflict`, `archived`;
- `authorityPolicy`: allowed read/write operations for this provider/project;
- `lastSyncAt`;
- `lastExternalVersion`;
- `lastLocalVersion`;
- `sourceSnapshot`: compact issue summary used to form the task;
- `contextBudget`;
- `contextManifest`;
- `staleState`;
- `conflictState`;
- `evidenceRefs`;
- `commentRefs`;
- `prRefs`;
- `proofPathRefs`;
- `memoryCandidateRefs`.

### SyncState

Sync is explicit and inspectable:

- `direction`: `external_to_local`, `local_to_external`, or `bidirectional`
  for the specific field;
- `field`;
- `sourceVersion`;
- `targetVersion`;
- `status`: `clean`, `pending`, `stale`, `conflict`, `write_failed`,
  `manual_required`;
- `reason`;
- `lastAttemptAt`;
- `lastSuccessAt`;
- `proposedWrite`.

### Evidence And Comment Records

Evidence should be queryable without pasting the world into the task:

- external comment id, author, created/updated time, compact summary, permalink;
- local note id, author/agent, role, compact summary, evidence refs;
- command proof: command, cwd, exit code, duration, abbreviated output, redaction;
- file proof: paths changed, diff stats, commit ids;
- PR proof: PR URL, title, branch, state, checks summary, review-thread summary;
- operational proof: Grafana dashboard/query link, Loki/Prometheus query handle,
  sampled result summary, timestamp;
- stale proof: which source changed after the local mirror was shaped;
- memory candidate: proposed memory text, scope, evidence refs, risk, status.

## Context Shaping And Budget

External issue work can be huge. Jira comments, PR history, work logs, repo
docs, Grafana findings, and CI logs can easily exceed a useful worker brief.
Guildhall must balance relevance against context volume and leave an audit
trail for that balance.

Each mirrored task should carry a `contextManifest` with four buckets:

### Always Included

These go into the active execution packet unless unavailable:

- external issue key/id, canonical URL, title, issue type, current status,
  parent, sprint/milestone, assignee, priority, and last external update time;
- local mirror id, local task id, project path, active branch/worktree, and
  current local status;
- the current accepted outcome, Definition of Done, proof path, and blocker
  state;
- repo-required startup/context routing handles, such as LinkCore's
  `START_HERE.md`, `IMPLEMENTATION_STATE.yaml`, `TASK_BOARD.yaml`, resolved
  `TASK_CONTEXT.yaml` epic refs, and `FOLDER_CONTEXT.yaml` path refs;
- current PR URL/title/state/check summary when a PR exists;
- open review-thread summary when the task is in review-fix mode;
- explicit policy constraints that can invalidate work, such as branch naming,
  commit message, PR metadata, no force-push, public-doc boundary, or external
  write restrictions.

### Summarized

These are condensed with source handles:

- external issue description and acceptance criteria when long;
- most recent relevant external comments, grouped into decisions, blockers,
  requested changes, and status notes;
- PR body, check failures, and review history;
- `WORK_LOG.md` hits for the issue key, branch, file path, error text, command,
  or test name;
- operational triage evidence from Grafana/Loki/Prometheus;
- older local progress notes, checkpoints, and completion handoffs;
- broad repo planning docs after the resolved route identifies which sections
  matter.

### Referenced By Handle

These are not included verbatim but remain one click or one tool call away:

- full external issue URL and comment ids;
- PR URL, review thread ids, commit SHAs, workflow run URLs, and CI log URLs;
- Grafana dashboard URLs, panel ids, query names, and captured time windows;
- full docs paths and section anchors;
- exact `WORK_LOG.md` search query used;
- archived work-log paths and local-history snapshot ids;
- raw command logs and screenshots.

### Omitted With Auditable Reason

These stay out of the active packet unless the agent explicitly asks for them:

- unrelated linked issues or epics outside the selected task/domain;
- closed or superseded review threads after their outcome is summarized;
- raw CI logs after the failing assertion and run URL are captured;
- full historical Jira comment chains when recent comments supersede them;
- old work-log entries for closed tickets;
- duplicate docs reached by both epic and path mapping;
- raw production payloads, secrets, tokens, credentials, or private user data;
- large diffs when file paths, commit ids, and review findings are enough;
- speculative backlog notes that do not affect the current execution boundary.

Every omission should record `reason`, `sourceHandle`, `retrievalCommand` or
connector handle when safe, and `decidedBy`. Deferred/on-demand retrieval is a
first-class state, not a failure. If an agent later needs an omitted source, it
requests the handle and the context manifest records that promotion.

## Intake And Import Flow

Import should start from discovery, not mutation.

1. **Discover sources.** Guildhall detects configured external connectors,
   issue-key patterns in branches/commits/docs, repo workflow docs, PR helper
   scripts, and local context-routing files. For LinkCore, `LC-\d+` issue keys,
   `docs/99-context/*`, Jira workflow docs, and branch/commit/PR guardrails are
   strong signals.
2. **Show candidates.** The import review UI shows candidate external issues
   with title, status, parent, assignee, sprint, branch/PR hints, and why
   Guildhall thinks the issue is relevant.
3. **Ask what to mirror.** The user can mirror selected issues, mirror an epic
   plus children, attach to the current branch's issue, or skip. Guildhall does
   not create local tasks for every visible external issue by default.
4. **Map to local domains.** Guildhall maps external parents/epics/components
   to local domains and context routes. In LinkCore, LC epics map through
   `TASK_CONTEXT.yaml`; changed paths map through `FOLDER_CONTEXT.yaml`.
5. **Deduplicate.** Before creating a local mirror, Guildhall checks existing
   mirrors by provider/id, issue key, canonical URL, branch name, PR URL, and
   local task source notes. A duplicate becomes an attach/resume action, not a
   new task.
6. **Shape a task.** The local task is created as `import_draft` or
   `exploring` with external authority metadata, context budget, proof
   expectations, and external write policy.
7. **Confirm readiness.** Guildhall assesses outcome clarity, proofability,
   dependency risk, context load, and owner/external judgments before dispatch.

Import should also support "read-only mirror" mode for teams that want local
execution help but do not want Guildhall writing back to the external system.

## Sync Flow

Sync should be field-aware and permission-aware.

### External To Local

Guildhall can refresh local mirrors from external issue fields:

- status, sprint, assignee, parent/child links, labels/components;
- title and description;
- new comments;
- external blockers or dependencies;
- linked PRs/branches when the provider exposes them.

If the external issue changed after Guildhall shaped the local task, Guildhall
marks the mirror `stale` and explains what changed. If the change affects the
completion boundary, proof, branch, or assignment, the task requires a recheck
before work continues.

### Local To External

Guildhall can propose external updates from local execution:

- status note or comment;
- blocker summary;
- USER value framing;
- proof summary;
- PR link and test evidence;
- done/ready-for-review note.

Automatic writes should be allowed only when all of these are true:

- the connector is configured and has write permission;
- project policy allows the specific write type;
- the write is low-risk and reversible, such as adding a status comment or PR
  link;
- the write cites concrete local evidence;
- the external issue has not changed in a conflicting way since the local
  packet was shaped.

Guildhall should propose, not perform, writes when the update changes external
status, sprint, assignee, parent, priority, resolution, or public-facing
commitment; when the task has unresolved proof gaps; when comments include
uncertain product/risk judgment; or when the external provider state is stale.

### Status, Comments, And Blockers

The local mirror may show `ready`, `in_progress`, `review`, or `done` while the
external issue still says `In Progress`. That is not automatically a conflict.
Conflict exists when Guildhall wants to claim a state the external authority
disagrees with, or when the external state changes the local plan.

External comments should be grouped into:

- current instructions;
- decisions;
- blockers;
- requested changes;
- stakeholder/status notes;
- superseded history.

Blockers must name the owner: Guildhall, user, external provider/team, or
repo/CI/ops system.

### USER, PRs, And Review Threads

LinkCore uses USER framing in Jira for meaningful work: User impact, Strategic
value, Effort, Risk. Guildhall should render a proposed USER comment from local
evidence when work is selected, reframed, blocked, or completed. It should keep
the PR body concise and avoid duplicating the full USER block into PR text.

For PRs, Guildhall should understand and preserve:

- title constraints with issue key placement;
- branch naming policy;
- conventional commit and commit-subject issue-key requirements;
- no AI co-author trailer policy;
- PR template sections and risk/deployment/migration sections;
- helper-script preference for opening or drafting PRs;
- open review threads and whether each was addressed and resolved.

Review-thread closure is an external write with social meaning. Guildhall may
prepare replies and identify resolved threads automatically, but should only
resolve threads when policy and connector permissions allow it and the exact
thread state was read after the fix.

## LinkCore Fixture Mapping

LinkCore is a strong fixture because it already separates external planning
from local execution context.

### Current Observed State

Inspection on 2026-05-29 found the main LinkCore checkout on
`feature/LC-201-choice-page-enrichment-metrics`, tracking the same origin
branch. The current snapshot in `IMPLEMENTATION_STATE.yaml` names LC-201 as
the active focus under LC-29, with other open LC epics/issues represented as
resume-critical state. That is exactly the kind of external-task mirror
Guildhall should respect: the local state explains how to resume; Jira remains
the planning/status system.

### Startup And Context Routing

Map LinkCore's local docs this way:

- `docs/99-context/START_HERE.md`: repo-specific startup protocol and context
  discipline. Guildhall should always include the protocol summary and keep the
  file path as a handle.
- `docs/99-context/IMPLEMENTATION_STATE.yaml`: current open-ticket snapshot.
  Include the active issue and blockers; summarize other active issues unless
  they affect the selected task.
- `docs/99-context/TASK_BOARD.yaml`: initiative/epic map and Jira-facing
  status summary. Use it for parent/epic names, not as the execution task list.
- `docs/99-context/TASK_CONTEXT.yaml`: epic-to-doc routing. Use it to resolve
  task-specific required docs.
- `docs/99-context/FOLDER_CONTEXT.yaml`: path-to-doc routing. Use it when the
  selected issue or PR touches files.
- `docs/99-context/WORK_LOG.md`: searchable evidence ledger. Never read it
  top-to-bottom for startup; search by issue key, branch, file path, error,
  command, or test.
- `docs/05-delivery/JIRA_WORKFLOW.md`: role split and external status/comment
  workflow.

### Policies And Helpers

Guildhall should represent these as policy constraints in the context packet:

- pushed/shared branches refresh from `origin/main` by merge, not rebase;
- branch names must use approved prefixes and Jira-shaped keys for ticketed
  work;
- commits must be conventional and include the branch Jira key when present;
- AI co-author trailers are rejected;
- PR title/body metadata is checked, including required Summary, Risk Level,
  and Test Plan/Evidence sections;
- migration and deployment-sensitive paths require additional PR sections;
- PRs should use `scripts/ci/generate-pr-body.sh`, `pr-open.sh`, or
  `pr-draft.sh`;
- context coverage is checked through
  `scripts/ci/check-context-coverage-changed.sh origin/main`;
- `scripts/context/resolve-context.sh --task <epic> <path>` is the local
  resolver, even though the flag name says task.

### Operational Triage

For LinkCore, Jira-only status is often insufficient. The fixture expects
operational triage to pair issue titles with real signals:

- Grafana/Prometheus/Loki evidence for production failures;
- GitHub Actions or CI logs for failing checks;
- PR review-thread state for review follow-ups;
- Jenkins/Nomad/deployment knowledge where the deploy gate lives outside git;
- exact code path or runtime path before recommending work.

Guildhall should capture operational evidence as proof handles and summaries.
It should not paste raw dashboards, logs, or private payloads into local task
context unless the current decision depends on them.

## Generalization Beyond Jira

The provider adapter should normalize concepts without erasing provider
differences:

- Jira: issue key, issue id, project, epic/parent, sprint, status category,
  comments, components, fix versions.
- Linear: issue id, identifier, team, project, cycle, state, assignee, labels,
  relations, comments.
- GitHub Issues: owner/repo, issue number, labels, milestone, assignee,
  linked PRs, comments, projects fields where available.
- Azure DevOps: organization/project, work item id/type, iteration, area,
  state, assigned-to, relations.
- Asana: workspace/project, task id, sections, assignee, due dates,
  dependencies, stories/comments.

Provider-specific fields should remain available under `rawProviderFields` and
selected `fieldMappings`. Guildhall should avoid pretending every provider has
Jira's exact epic/sprint model. The common contract is identity, state,
relationships, comments, ownership, links, sync version, and write policy.

## UI And Product Behavior

### Import Review

The import review surface should show:

- external provider and issue key/title;
- status, assignee, parent, sprint/milestone, labels/components;
- branch/PR/worktree hints;
- context route and expected docs;
- duplicate detection result;
- context-budget risk;
- proposed local task shape;
- write policy: read-only, propose-only, or allowed automatic writes.

The primary action is "Mirror selected work", not "import everything".

### Task Drawer

A mirrored task drawer should make authority visible:

- external issue badge with link and last sync time;
- local status next to external status, with drift explained;
- context manifest: included, summarized, handles, omitted;
- proof paths, PR links, review threads, and operational evidence;
- blocker ownership;
- proposed external updates waiting for approval;
- memory candidates derived from the task.

External state should not be hidden in a debug tab. If the local task is stale
because Jira changed, the drawer should say what changed and offer refresh,
compare, or continue-with-reason actions.

### Completion Handoff

Completion handoff should produce two artifacts:

- a local completion handoff with proof paths, commands, PR links, residual
  risk, and memory candidates;
- a proposed external update with concise status/comment text appropriate for
  the provider.

For LinkCore, the proposed external update should include Jira link/title,
USER framing when meaningful, PR link, tests/proof, rollout notes when needed,
and any residual external blocker. It should not claim Done if the external
acceptance, PR merge, deployment proof, or review-thread closure is still
pending.

### Conflict And Staleness Resolution

When external and local state disagree, the UI should classify the disagreement:

- harmless drift: external status unchanged while local execution advances;
- stale context: external issue/comment/PR changed after the worker packet;
- conflict: external issue changed the outcome, ownership, priority, or
  completion boundary;
- write failure: Guildhall attempted an allowed write and the provider rejected
  it;
- manual-required: the proposed update changes external planning authority.

Resolution actions should be specific: refresh mirror, compare changes,
re-shape local task, propose comment, discard local proposal, mark stale source
as superseded, or ask owner.

## Open Questions

- Which external writes should be allowed by default for a newly connected
  provider: comments only, PR links only, or propose-only until the user opts in?
- Should mirror creation be stored under normal task state, a separate
  `external-task-mirrors` collection, or both with a compatibility pointer?
- How should Guildhall identify the "current task" when a branch references
  one issue key and the user asks about another?
- Should USER-style value framing become a provider-neutral value-frame model,
  with Jira-specific rendering for LinkCore?
- What minimum connector freshness is required before Guildhall may resolve a
  review thread or update external status?
- How much of this should be available through MCP for outside agents in the
  same 0.11.0 milestone as the agent memory bridge?

## Risks

- **Backlog fork risk:** local mirrors become a second planning system. Mitigate
  by making external authority explicit and sync-state visible.
- **Over-context risk:** external issues, PRs, logs, and work logs drown worker
  prompts. Mitigate with context manifests, role budgets, handles, and
  deferred retrieval.
- **Unsafe write risk:** Guildhall updates status or comments too eagerly.
  Mitigate with provider write policy, stale checks, and approval gates.
- **Provider mismatch risk:** the Jira fixture overfits the model. Mitigate
  with a provider-neutral identity/relationship/comment/write-policy core and
  provider-specific raw field preservation.
- **Evidence privacy risk:** logs/comments can contain secrets or user data.
  Mitigate with redaction, handles, omission reasons, and no raw production
  payloads by default.
- **Review-state drift risk:** review threads or PR checks change after local
  fixes. Mitigate by rereading exact thread/check state before external closure.

## Acceptance Criteria

- Guildhall can discover external-task candidates from a repo like LinkCore
  without creating project registration files.
- The user can mirror selected external issues and avoid duplicate local tasks.
- A mirrored task stores external identity, local task id, sync state, context
  manifest, proof paths, PR links, evidence, and memory candidates.
- Context packets show concrete budget behavior: always included, summarized,
  handle-only, and omitted-with-reason sources.
- LinkCore's `docs/99-context/*`, Jira workflow, branch/commit/PR helpers, USER
  framing, work-log discipline, and operational triage expectations map cleanly
  into the model.
- Guildhall distinguishes external planning/status authority from local
  execution/proof/memory authority in the UI and data model.
- Automatic external writes are limited to configured, low-risk, evidence-backed
  operations; status/ownership/sprint/priority changes are proposed unless
  explicitly allowed.
- Stale and conflicting external state is visible in import review, the task
  drawer, and completion handoff.
- The same model can represent Jira, Linear, GitHub Issues, Azure DevOps, and
  Asana without losing provider-specific fields.
- No large raw issue/comment/log/work-log history is injected into worker
  context without a recorded relevance reason and retrieval handle.
