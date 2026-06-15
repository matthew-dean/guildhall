# Guildhall 0.11.0 Agent Memory Bridge

**Status:** Deferred to 0.11.0

**Deferral note, 2026-06-06:** This is no longer a 0.10 target. The 0.10
default model is delivery spine plus project contract governance. External
agent memory exchange should wait for 0.11, after the local delivery spine,
contract validation, and authority boundaries have settled enough to make
outside-agent writes trustworthy.

Guildhall should become the durable project memory and coordination layer for
outside agent work. Codex, Claude Code, and similar tools can still do the
hands-on execution, but when they are working inside a Guildhall project they
should read Guildhall context first, attach to the right task, write evidence
back as they work, and leave the project in a state the next agent or owner can
understand.

The goal is not to make Guildhall replace Codex or Claude. The goal is to make
those tools less amnesiac when they operate on a project that already has
Guildhall state.

## Why This Moves To 0.11.0

The 0.9.0 release is already focused on task hierarchy, proof paths, runtime
isolation, memory, MCP visibility, and completion quality. The agent memory
bridge depends on those surfaces becoming trustworthy. It should move to 0.11.0
because 0.10 now owns the local delivery and governance foundation first:

- 0.9 makes Guildhall's project state reliable enough to trust.
- 0.10 makes Guildhall's own local delivery model and contract governance
  trustworthy.
- 0.11 should let outside agents use that state as their operating context.

The Looma setup task was the first useful pressure test. A Codex worker handled
the public GitHub/MIT/npm-readiness work while Guildhall tracked the parent
task through `ExternalAgentLink`. That should become normal product behavior,
not a one-off chat maneuver.

## Product Promise

When an owner asks Codex or Claude to work in a folder that has Guildhall set
up, the agent should be able to say:

1. I found the Guildhall project.
2. I understand the current task, milestone, memory, decisions, proof
   expectations, and constraints.
3. I attached this session to the appropriate Guildhall task or created a
   visible external work session.
4. I wrote back the important evidence: files changed, commands run, tests,
   blockers, decisions, PRs, links, and handoff notes.
5. The next Guildhall run, Codex run, Claude run, or owner UI view can pick up
   without reconstructing the work from transcript archaeology.

That makes Guildhall a project guidance system as much as a task runner.

## Principles

1. **Guildhall state is the source of continuity.**
   External chats and terminals are transient. Project memory, tasks,
   artifacts, proof paths, decisions, capability requests, and evidence should
   live in Guildhall-owned state.

2. **Agents attach before they improvise.**
   If Guildhall is present, an external agent should first discover whether the
   work belongs to an existing task, a new child task, or a short external
   session record.

3. **Evidence is structured, not pasted lore.**
   Writeback should preserve commands, outcomes, files, links, blockers, and
   reasoning summaries in fields Guildhall can inspect. A prose note is useful
   but not enough.

4. **MCP is preferred, CLI is the fallback.**
   The happy path is the Guildhall MCP bridge. If a client cannot use MCP,
   Guildhall should offer equivalent bounded CLI helpers.

5. **No hidden mutation.**
   External agents may record sessions and append evidence. Creating tasks,
   changing task status, pushing branches, opening PRs, or granting host access
   should follow the same permissions and audit rules as normal Guildhall work.

6. **The bridge should serve multiple work styles.**
   A casual user may only want continuity and fewer repeated explanations. A
   full-time developer or CTO may care about traceability, proof quality,
   security, and review posture. The same bridge should support both.

## Existing Foundation

Guildhall already has pieces of this:

- `guildhall mcp serve` exposes project state through MCP.
- `guildhall agent bridge` can install Codex/Claude-facing MCP instructions.
- MCP resources expose tasks, artifacts, decisions, memory, runtime, local
  history health, and effective context.
- MCP tools can append task evidence and manage capability requests.
- `ExternalAgentLink` now records an outside agent id, provider, linked task,
  target project path, prompt summary, status, and result summary.

0.11 should unify these pieces into a first-class product loop.

## Data Model

### ExternalAgentSession

`ExternalAgentLink` is a good seed, but 0.11 should promote the concept into an
external session model:

- `id`
- `provider`: `codex`, `codex-subagent`, `claude-code`, `other-mcp-client`
- `externalAgentId`
- `projectPath`
- `taskId`
- `parentTaskId`
- `status`: `starting`, `attached`, `running`, `blocked`, `completed`,
  `failed`, `abandoned`
- `intent`
- `promptSummary`
- `startedAt`
- `lastSeenAt`
- `completedAt`
- `resultSummary`
- `changedFiles`
- `commands`
- `checks`
- `links`
- `blockers`
- `evidenceRefs`

The model should stay provider-neutral. A Codex subagent id, Claude session id,
or MCP client name are all external identities attached to the same Guildhall
session contract.

### ExternalAgentEvidence

Evidence records should be append-only and queryable:

- command evidence: command, cwd, exit code, abbreviated output, redaction
  state;
- file evidence: paths changed, generated artifacts, screenshots, reports;
- review evidence: findings, comments addressed, unresolved risks;
- proof evidence: test/browser/runtime/proof path outcomes;
- handoff evidence: summary, next step, blocker, owner decision needed.

The UI can render a concise activity story while MCP can expose bounded,
machine-readable slices.

## Protocol

### 1. Detect

When an external agent starts, it should look for Guildhall state:

- `guildhall.yaml`;
- `.guildhall/`;
- workspace/project registry entry;
- configured Guildhall MCP server.

If no Guildhall project is present, the agent proceeds normally. If partial
state is present, the agent says what it found and uses the safest available
read path.

### 2. Attach

The agent asks Guildhall for an attachment decision:

- attach to an explicit task id from the user;
- infer the likely task from current milestone, active task, branch, or files;
- create a lightweight external session without changing the task list;
- propose a new task when the work is bigger than a session note.

Attach should produce an `ExternalAgentSession` id. For routine Codex work, the
agent does not need to ask the owner which path to use unless the choice is
ambiguous or risky.

### 3. Read Guidance

After attaching, the agent reads a bounded effective context packet:

- task intent and acceptance criteria;
- current milestone;
- relevant decisions;
- project memory and owner preferences;
- proof requirements;
- runtime/capability constraints;
- recent similar failures or prior attempts;
- public-doc/internal-doc boundaries.

This should be available through MCP and CLI:

```sh
guildhall agent attach --provider codex --intent "Fix review comments"
guildhall agent context --session <session-id>
```

### 4. Work

The external agent works in its own environment, but writes back meaningful
events:

```sh
guildhall agent evidence --session <session-id> --kind command --command "pnpm test" --exit-code 0
guildhall agent evidence --session <session-id> --kind files --paths "src/runtime/foo.ts,src/runtime/foo.test.ts"
guildhall agent evidence --session <session-id> --kind blocker --summary "npm auth is invalid"
```

MCP tools should offer the same operations without shelling out.

### 5. Complete

At finish, the agent records:

- final status;
- result summary;
- changed files;
- checks run and outcomes;
- links to branch, commit, PR, screenshots, or external dashboards;
- remaining blockers;
- recommended next action.

Completion should not automatically mark the Guildhall task done unless the
session has enough proof to satisfy the task's completion contract. Guildhall
can recommend the transition, but the same gate/proof system should decide.

## MCP Changes

Add resources:

- `guildhall://project/external-agent-sessions`
- `guildhall://project/external-agent-sessions/<session-id>`
- `guildhall://project/tasks/<task-id>/external-sessions`
- `guildhall://project/agent-context`

Add tools:

- `guildhall.attach_external_agent`
- `guildhall.record_external_agent_evidence`
- `guildhall.update_external_agent_session`
- `guildhall.complete_external_agent_session`
- `guildhall.suggest_external_agent_task_binding`

Existing tools remain useful:

- `guildhall.append_task_evidence`
- `guildhall.create_capability_request`
- `guildhall.list_capability_requests`
- `guildhall.read_effective_context`

The new tools should be intent-shaped. External agents should not edit
`.guildhall/TASKS.json` or private state files directly when a tool exists.

## CLI Changes

Add a small CLI layer for agent environments without MCP:

```sh
guildhall agent detect [path]
guildhall agent attach --provider codex --intent "..." [--task <id>]
guildhall agent context --session <id>
guildhall agent evidence --session <id> --kind <kind> ...
guildhall agent complete --session <id> --status completed --summary "..."
```

The CLI should print compact JSON when `--json` is passed so Codex/Claude can
consume it without fragile string parsing.

## UI Changes

The UI should surface external sessions without making them a new workflow the
owner has to manage manually.

Recommended surfaces:

- task drawer: "Outside agent sessions" with provider, status, summary, and
  last update;
- timeline: session attached/completed events;
- settings/advanced: bridge health, configured clients, MCP status, recent
  sessions;
- task cards: a small "Codex working" or "Claude working" status when active;
- proof/release views: external evidence included in the same proof story as
  Guildhall-native work.

The owner should never have to decide "use the pressure-tested path or the
short path." The bridge should do the reasonable thing automatically, then show
what happened.

## Security And Privacy

- Do not expose full transcripts or prompts through broad resources.
- Redact secret-looking output before recording command evidence.
- Keep host paths visible only where they are necessary for local proof.
- Capability requests remain explicit and auditable.
- External agents cannot grant themselves access by writing a session record.
- The bridge should show when a client is using MCP versus raw file fallback.

## Acceptance Criteria

- Codex and Claude instructions tell agents to detect and attach to Guildhall
  when a project is present.
- MCP exposes external sessions and lets clients attach, record evidence, and
  complete sessions.
- CLI fallback supports the same flow with JSON output.
- The UI shows active and completed external sessions on linked tasks.
- Task proof and release readiness can include external-agent evidence.
- A live test starts from a Guildhall project, runs an external Codex task,
  records evidence through the bridge, and leaves enough state for a different
  agent to summarize what happened without reading the original chat.
- Missing MCP or partial Guildhall setup degrades cleanly with an explicit
  fallback message.

## 0.11.0 Task Breakdown

- Define `ExternalAgentSession` and migrate/adapt `ExternalAgentLink`.
- Add session/evidence store tests.
- Add MCP resources and tools for attach/evidence/complete.
- Add CLI commands for MCP-less clients.
- Update `guildhall agent bridge` instructions for Codex and Claude.
- Add UI session summaries to task drawer, timeline, and settings.
- Add proof-path integration so external evidence is treated as first-class
  completion evidence.
- Add live bridge smoke test using a small external Codex task.

### First Bounded Memory-Exchange Slice

- [x] Add a provider-neutral external memory bridge record with explicit
  scope/type, freshness, confidence/risk, and required evidence refs.
- [x] Persist explicit import/export and link-style bridge records in
  `.guildhall/external-agent-memory-bridge.json`.
- [x] Keep imported external memory reviewable before it shapes local execution
  by requiring an explicit review step before promotion into ordinary effective
  memory.
- [x] Expose the bridge through MCP/CLI/UI flows after the runtime contract has
  enough release-proof coverage. The bounded 0.10 record path exposes reviewable
  bridge records through MCP and CLI: clients can list/import/review/reject
  records, and only review promotes a record into ordinary effective memory.
  UI exposure is intentionally left to the broader external-session/task-surface
  work instead of adding a small one-off Settings surface for this slice.

## Open Questions

- Should Guildhall create a task automatically when an external session has no
  matching task, or should it stay as a session until the work proves large
  enough?
- How much of an external agent's command output should be persisted by
  default?
- Should bridge setup be part of first-run project initialization, advanced
  settings, or both?
- How should Guildhall detect and reconcile two agents working on the same task
  at once?
