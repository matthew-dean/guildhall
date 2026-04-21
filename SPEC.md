# Guildhall — System Specification

**Version:** 0.3-draft
**Status:** Active — absorbing prior-harness (linkcore / jess) requirements
**Lineage:** Evolved from the internal "Forge" prototype. Engine primitives are being ported from [OpenHarness](https://github.com/HKUDS/OpenHarness) (MIT), itself a Python port of Claude Code. Operational-model additions (agent-originated tasks, pre-rejection, worktree fanout, business envelopes) absorb requirements from the internal `linkcore` autoloop and the `jess` codex/auto-loop prototypes.

This document is the authoritative spec. All changes require a spec update before implementation.

---

## 1. Purpose

Guildhall is a multi-agent operating system for software projects. It enables one or more AI agents to work autonomously on a codebase for extended periods without human interruption, while producing reliable output through layered quality controls.

The metaphor: a medieval guildhall, where masters, journeymen, and apprentices work under shared standards, and where admission to each tier requires producing a verified masterpiece.

Primary design constraints:
- Acceptable output quality using local LLMs (LM Studio), not only frontier models
- Run for hours without human input, safely
- Safe to stop and restart at any time (all state persisted)
- Auditable: every decision, revision, and gate result recorded
- **Operational behavior tuned by explicit levers (§2.1), not hidden defaults.** How much human involvement, how much agent autonomy, how strict the spec, how wide the fanout — all lever positions set during meta-intake and visible in `memory/agent-settings.yaml`.

---

## 2. Requirements

### 2.1 Lever model

Guildhall's operational behavior is governed by a finite set of **named levers**, each with an enumerated set of positions. The system has no hidden hardcoded defaults — every behavior difference traces back to a lever position persisted in `memory/agent-settings.yaml`.

**Goal:** a UX that feels like "magic" (the system follows the user's wishes without being nagged), backed by fully deterministic, auditable behavior. The *magic* comes from the Spec Agent's exploratory conversation (FR-12) inferring lever positions from natural project-guidance questions and from reading the user's expertise / risk tolerance / project maturity via how they describe the work — never by asking direct meta-questions. The *determinism* comes from every lever's position being explicit, persisted, and readable by the orchestrator.

**Setter path:**
- Initial positions set during meta-intake (FR-14) and per-task exploration (FR-12)
- Refined mid-project by coordinators via the `save-agent-setting` tool
- Overridable per-task or per-domain where the Scope column permits

**Inventory:**

| Lever | Positions | Scope | Governs |
|---|---|---|---|
| `task_origination` | `human_only` / `agent_proposed_human_approved` / `agent_proposed_coordinator_approved` / `agent_autonomous` | per-domain | FR-21 |
| `spec_completeness` | `full_upfront` / `stage_appropriate` / `emergent` | per-domain | FR-03 |
| `pre_rejection_policy` | `terminal_shelved` / `requeue_lower_priority` / `requeue_with_dampening` | per-domain | FR-22 |
| `completion_approval` | `human_required` / `coordinator_sufficient` / `gates_sufficient` | per-domain | FR-04, FR-05 |
| `concurrent_task_dispatch` | `serial` / `fanout_N` (N ∈ ℤ⁺) | project | FR-24 |
| `worktree_isolation` | `none` / `per_task` / `per_attempt` | project | FR-24 |
| `merge_policy` | `ff_only_local` / `ff_only_with_push` / `manual_pr` | project | FR-25 |
| `reviewer_mode` | `llm_only` / `deterministic_only` / `llm_with_deterministic_fallback` | per-domain | FR-27 |
| `rejection_dampening` | `off` / `soft_penalty_after_N` / `hard_suppress_after_N` | project | FR-26 |
| `max_revisions` | integer | per-domain | FR-04 |
| `business_envelope_strictness` | `strict` / `advisory` / `off` | project | FR-23 |
| `escalation_on_ambiguity` | `always` / `coordinator_first` / `never` | per-domain | FR-10 |
| `agent_health_strictness` | `lax` / `standard` / `strict` | project | FR-30 |
| `crash_recovery_default` | `prefer_resume` / `prefer_restart_clean` / `pause_for_review` | per-domain | FR-32 |
| `remediation_autonomy` | `auto` / `confirm_destructive` / `confirm_all` / `pause_all_on_issue` | project | FR-32 |
| `runtime_isolation` | `none` / `slot_allocation` | project | FR-24 |

Adding a new lever requires amending this table and referencing it from at least one FR. No FR may hardcode a policy decision that belongs on a lever.

**Levers vs. per-incident decisions.** Levers express *stable project-wide policy* ("what's our general stance?"). Many operational choices are *not* levers — they are per-incident judgments the coordinator makes by looking at the actual situation (artifact state, crash pattern, checkpoint inspection). Examples that intentionally are **not** levers: whether to keep/archive/delete a specific failed worktree, whether a particular checkpoint looks resumable or corrupted, whether to escalate after this specific crash. Those are coordinator decisions informed by lever defaults, not determined by them.

### 2.2 Functional Requirements

**FR-01 Task lifecycle**
- Every unit of work is a Task with a defined lifecycle:
  `proposed → exploring → spec_review → ready → in_progress → review → gate_check → done`
- Terminal states: `done`, `shelved` (worker pre-rejected per FR-22), `blocked` (halted by escalation per FR-10)
- Origination:
  - `proposed` — originated by an agent (FR-21), routed per lever `task_origination`
  - `exploring` — originated by a human via the Spec Agent intake (FR-12)
- Advancement to `ready` requires spec content appropriate to the governing lever `spec_completeness` (FR-03) — NOT necessarily a fully complete spec
- The only status that *requires* sustained human interaction is `exploring`; whether `proposed`, `spec_review`, and gate_check transitions require human sign-off is governed by levers `task_origination` and `completion_approval`

**FR-02 Coordinator domains**
- One or more Coordinator agents, each with a defined domain
- Each coordinator has: a mandate, a set of concerns with review questions, autonomous decision authority, and escalation triggers
- Coordinators may negotiate via the CrossDomainRequest protocol
- Multiple coordinators may govern the same project with different perspectives

**FR-03 Stage-appropriate spec fidelity**
- Every task must have spec content appropriate to its current status, as governed by lever `spec_completeness`:
  - `full_upfront` — summary + numbered acceptance criteria + out-of-scope + required tools/skills + complexity before `ready`
  - `stage_appropriate` — `proposed` needs summary + success condition; `ready` needs acceptance criteria; richer spec content may be filled in during `in_progress` as the work clarifies it
  - `emergent` — spec content grows alongside the work; each status transition requires only the minimum content for the next agent to proceed
- Specs are built conversationally during the `exploring` phase by the Spec Agent (see FR-12) or proposed by an agent in the `proposed` phase (FR-21)
- If an acceptance criterion is ambiguous and cannot be resolved within the current status's fidelity requirement, the Spec Agent escalates per FR-10 rather than guessing
- Acceptance criteria, when present, must be independently verifiable (automated or rubric-based)

**FR-04 Review and revision loop**
- All completed work is reviewed before gate checking; reviewer implementation is governed by lever `reviewer_mode` (FR-27)
- The Reviewer evaluates each acceptance criterion independently
- Failed reviews return the task to `in_progress` with specific, actionable feedback and increment `revisionCount`
- Worker pre-rejection (FR-22) is a distinct path: it does NOT increment `revisionCount` and skips the reviewer
- After `max_revisions` (lever; per-domain integer) failed reviews, the task is set to `blocked` and escalated per FR-10

**FR-05 Hard gates**
- Tasks must pass all registered hard gates before being marked `done`
- Hard gates are shell commands that must exit 0
- Gate results (command, output, pass/fail, timestamp) are persisted on the task
- Hard gates cannot be skipped; they can only be overridden by a human with a recorded ADR

**FR-06 Soft gates**
- The Reviewer evaluates a weighted rubric of soft gate questions
- Soft gates that fail below the passing threshold trigger revision
- A coordinator may override a failed soft gate with a recorded decision (ADR entry)

**FR-07 Just-in-time context**
- Agents do not receive full memory/history dumps; context is assembled per-task
- Context includes: current task (full), relevant MEMORY.md sections (keyword-matched), last N progress lines, recent domain decisions
- Memory sections are ranked by keyword relevance to the task

**FR-08 Persistent memory**
- TASKS.json: the task queue, source of truth, append + update
- MEMORY.md: long-term project knowledge, append-only sections
- DECISIONS.md: ADR trail, append-only entries
- PROGRESS.md: human-readable progress log, append-only entries
- memory/exploring/<task-id>.md: transcript of the exploratory spec-building conversation (see FR-12)
- All files are plain text/JSON; no external database required

**FR-09 Progress reporting**
- Agents write progress entries of type: heartbeat, milestone, blocked, escalation
- Milestone entries written when a task completes all gates
- Blocked entries written immediately when a task cannot proceed
- The human can read PROGRESS.md at any time to see current state

**FR-10 Escalation protocol**
- Agents escalate when: spec is ambiguous, task is stuck after maxRevisions, a decision requires human judgment
- Escalations written to the task notes and to PROGRESS.md as type `escalation`
- The orchestrator halts the affected task until the escalation is resolved

**FR-11 Self-critique**
- Worker agents must write a structured self-critique on every task before handoff to reviewer
- Self-critique must address each acceptance criterion individually
- Self-critique must declare any out-of-scope changes introduced

**FR-12 Exploratory task intake**
- Tasks begin in the `exploring` state when created from a fuzzy user ask
- The Spec Agent drives a conversation with the user to elicit:
  - Outcome (what success looks like)
  - Numbered acceptance criteria (how we verify "done") — depth governed by lever `spec_completeness`
  - Out-of-scope list (what not to change)
  - Happy path + edge cases
  - Domain routing (which coordinator owns this; CrossDomainRequests if spanning)
  - Blast radius (existing features/schemas/APIs at risk)
  - Required skills/tools
  - Escalation triggers
  - Complexity estimate (feeds lever `max_revisions`)
- The conversation transcript is persisted at `memory/exploring/<task-id>.md`
- The spec draft updates live during the conversation and is displayed to the user
- The user approves the draft to transition the task to `spec_review` (human approval default; overridable by lever `task_origination`)
- If the user cannot answer a load-bearing question, it is recorded as a planned escalation trigger rather than guessed

**Lever inference (FR-12 UX constraint):**
- The Spec Agent MUST infer lever positions from natural project-guidance questions — what the project is, what the goals are, what's been tried, what the guardrails are. It reads the user's fluency, vocabulary, confidence, and what they reveal about past practice. All of that is signal.
- The Spec Agent MUST NOT ask direct meta-questions about the user's expertise, autonomy preferences, or risk tolerance. Those questions feel like a test, produce unreliable answers, and break the "magic" UX.
- When inference is ambiguous between two lever positions and the choice is load-bearing, the agent asks in **project terms**, not system terms. ("Do you want to see each task before it's picked up, or scan a summary at the end of the day?" — not "what should I set `task_origination` to?")
- Inferred lever positions are persisted to `memory/agent-settings.yaml` with the inference rationale as a comment so future agents can audit why.

**FR-13 Task decomposition during exploration (NEW)**
- If the Spec Agent determines an ask is really N sub-tasks with dependencies, it proposes a task group
- On user approval, the sub-tasks are created in `spec_review` with dependency edges
- The parent task represents the group and completes when all children complete

**FR-14 Coordinator bootstrapping for new projects (NEW)**
- On a new workspace without coordinator definitions, the first `exploring` task is a meta-intake:
  "Tell me about this codebase and what you're trying to protect"
- Output: a draft `guildhall.yaml` with coordinator definitions (mandate, concerns, escalation triggers)
- User reviews and approves; config is written to disk

**FR-15 Permission modes (NEW)**
- Runtime supports three permission modes (ported from OpenHarness):
  - `default`: prompt user for each tool invocation that could have side effects
  - `plan`: read-only mode; agent may analyze but not modify
  - `full_auto`: unattended; all permitted tools run without prompting
- Mode is declared per-task by the coordinator and can be narrowed but not widened by the agent
- Individual tools declare whether they require permission in each mode

**FR-16 Structured event protocol (NEW)**
- The engine emits a typed event stream over a JSONL wire protocol (ported from OpenHarness `OHJSON:`)
- Events include: task lifecycle transitions, tool started/completed, assistant deltas, compact progress, todo updates, modal/select requests, errors, escalations
- Requests include: submit_line, permission_response, question_response, list_sessions, select_command, shutdown
- This protocol is the contract between the engine and any frontend (CLI, Tauri GUI, web dashboard)

**FR-17 Skill system (NEW)**
- A Skill is a named bundle of (prompt fragment, optional tool set, optional hook bindings)
- Skills are discoverable from `skills/<skill-name>/SKILL.md` under (a) the guildhall package, (b) `~/.guildhall/skills/`, (c) `<workspace>/skills/`, (d) installed plugins
- SKILL.md has YAML frontmatter (name, description) + markdown body (prompt content)
- Agents declare required skills; the orchestrator loads them into the agent's system prompt

**FR-18 Hook system (NEW)**
- Hooks are handlers for lifecycle events: SESSION_START, SESSION_END, PRE_COMPACT, POST_COMPACT, PRE_TOOL_USE, POST_TOOL_USE, USER_PROMPT_SUBMIT, NOTIFICATION, STOP, SUBAGENT_STOP
- Hook definitions may be: command (shell), http (POST to URL), prompt (sub-agent call)
- Hook results may block the action (`blocked: true` with reason), which aborts the corresponding workflow step
- Hooks are the extensibility point for project-specific guardrails

**FR-19 Context compaction (NEW)**
- The engine automatically compacts conversation history when approaching the model's context window or a configured threshold
- Compaction phases are first-class events (hooks_start, context_collapse_start/end, session_memory_start/end, compact_start/retry/end/failed)
- Compaction may be triggered: `auto` (threshold), `manual` (user command), or `reactive` (on context-overflow API error)
- Compaction checkpoints are persisted so compaction loss is recoverable

**FR-20 Session persistence for mid-turn resume (NEW)**
- Every conversation turn is checkpointed to `~/.guildhall/sessions/<project-digest>/<session-id>/`
- On crash or restart, the orchestrator can resume a task mid-turn (in addition to the between-tick restartability of NFR-01)
- Session persistence is separate from TASKS.json (task-level) and MEMORY.md (project-level)

**FR-21 Agent-originated task proposals**
- Any agent (worker, spec agent, coordinator) may create tasks in status `proposed`
- A proposed task carries: summary, success condition, proposing agent id, rationale, parent goalId (FR-23)
- Approval routing governed by lever `task_origination`:
  - `human_only` — proposals are rejected on creation; only human-initiated `exploring` tasks advance
  - `agent_proposed_human_approved` — proposal enters `spec_review` for the user to approve or reject
  - `agent_proposed_coordinator_approved` — owning coordinator approves → `ready`, or rejects with reason
  - `agent_autonomous` — auto-approved into `ready` (requires owning coordinator to be configured for full autonomy in this domain)
- Rejected proposals are persisted with reason and the coordinator's identity; this feeds rejection dampening (FR-26)

**FR-22 Worker pre-rejection outcomes**
- During or after implementation a worker may emit a structured pre-rejection with one of: `no_op` / `not_viable` / `low_value` / `duplicate` / `spec_wrong`
- Pre-rejection skips the reviewer and does not increment `revisionCount`
- Terminal handling governed by lever `pre_rejection_policy`:
  - `terminal_shelved` — task status → `shelved` with reason; no requeue
  - `requeue_lower_priority` — task returns to `ready` at lower priority
  - `requeue_with_dampening` — requeue and record the rejection shape for FR-26 dampening
- Every pre-rejection produces a `decision` log entry and an `escalation_raised`-adjacent wire event (`pre_rejection` sub-type) for observability

**FR-23 Business envelope (goals + guardrails)**
- Above tasks, Guildhall models a `Goal` entity: `{id, title, description, successCondition, guardrails[], status: active | paused | complete}`
- Tasks carry a `goalId`; an uncategorized task is an escalation signal, not a free-floating task
- Coordinators evaluate proposals and completed work against the parent goal's guardrails; strictness governed by lever `business_envelope_strictness`:
  - `strict` — any work outside guardrails is rejected
  - `advisory` — coordinator warns but may approve
  - `off` — envelope is informational only
- Goals are seeded during meta-intake (FR-14); later goals are added via the same intake flow

**FR-24 Concurrent task dispatch with worktree and runtime isolation**
- Lever `concurrent_task_dispatch` selects per-tick fanout: `serial` = one task per tick (current behavior), `fanout_N` = up to N tasks dispatched concurrently per tick
- Lever `worktree_isolation` selects per-dispatch filesystem isolation:
  - `none` — all agents share the project root
  - `per_task` — each dispatched task runs in a fresh `git worktree` forked from a configured base branch; cleaned up on task terminal
  - `per_attempt` — same as `per_task`, but a retry creates a new worktree rather than reusing the old one
- Lever `runtime_isolation` selects per-dispatch runtime-resource isolation:
  - `none` — workers share the host's runtime (ports, DBs, container names) — correct only for `serial` dispatch
  - `slot_allocation` — each concurrent worker is assigned an integer **slot** (0..N-1), a port base (default `base + slot * stride`; both configurable in `guildhall.yaml`), and an env-var prefix (default `GUILDHALL_W{slot}_`). Three injection paths, all available simultaneously:
    1. **Env vars on the worker process** — `GUILDHALL_SLOT`, `GUILDHALL_PORT_BASE`, `GUILDHALL_ENV_PREFIX` are set on the spawned worker so the project's build/dev scripts can read them directly.
    2. **Shared env vars inherited from orchestrator** — the project may declare additional vars in `guildhall.yaml` that are passed through to every worker.
    3. **Agent system-prompt injection** — the agent is *told the rules* in its context: "Your slot is N. Port base is P. If you need additional environment variables, prefix them with GUILDHALL_W{N}\_. If you need ports, start incrementing from P." The agent can then synthesize project-specific vars without them being pre-enumerated.
  - Guildhall does NOT prescribe a container model — the project's own build/dev scripts consume these env vars and the agent's rule knowledge to pick non-clashing ports, DB names, Docker project names, etc. Container, LXC, or plain-process setups all work.
- The orchestrator warns if `concurrent_task_dispatch: fanout_N (N≥2)` and `runtime_isolation: none`; coordinators may still proceed if the project legitimately has no runtime resources to clash over.
- Concurrent writes to TASKS.json serialize through a per-project lock (advisory file lock + fail-on-stale-read)
- Workers in their own worktree cannot see other workers' in-flight changes; integration happens only via FR-25

**FR-25 Attempt-branch merge policy**
- On a `done` task, the worker's branch is merged onto a shared integration branch via strategy declared by lever `merge_policy`:
  - `ff_only_local` — fast-forward merge locally; no push
  - `ff_only_with_push` — fast-forward + push to origin; on push failure, degrade to local-only and log per FR-29
  - `manual_pr` — open a PR (via `gh` CLI or configured MCP) and hold the task at `pending_pr` until the PR merges
- Merge conflicts block the merge and create a `fixup` task parented to the original goal
- Merge records (from-branch, to-branch, strategy, commit, timestamp) persist on the source task

**FR-26 Verdict persistence + rejection dampening**
- Every reviewer verdict and coordinator decision persists with `{timestamp, verdict, reason, policyVersion}`
- Shape-matching key for rejected proposals: canonical hash of `(goalId, normalized summary, proposing agent role)` — exact normalization deferred to implementation, but must be deterministic
- Lever `rejection_dampening`:
  - `off` — rejection history does not affect future proposals
  - `soft_penalty_after_N` — after N rejections of a shape-matched proposal, penalize its effective priority
  - `hard_suppress_after_N` — after N rejections, suppress creation until `policyVersion` changes
- On startup, the orchestrator re-evaluates persisted rejections whose `policyVersion` differs from the current one; resurrected tasks return to `proposed` for re-judgment

**FR-27 Deterministic reviewer fallback**
- The reviewer has three implementations governed by lever `reviewer_mode`:
  - `llm_only` — always call the LLM reviewer (FR-04 default behavior)
  - `deterministic_only` — rubric-based pass/fail from gate outputs + acceptance-criteria check; no LLM call
  - `llm_with_deterministic_fallback` — attempt LLM; on timeout, budget exhaustion, or provider unavailability, fall back to deterministic
- Deterministic verdicts use the soft gate rubric (§3) with integer thresholds keyed to hard-gate results
- Mode selection persists on the task's verdict record so the audit trail shows which path was taken

**FR-28 Process registry + cooperative shutdown**
- The orchestrator maintains an in-memory registry of child processes it spawns (dev servers, subprocess agents, worker processes): `{pid, kind, label, owningTaskId}`
- SIGINT / SIGTERM triggers: write `memory/stop-requested` → wait for in-flight ticks to drain → cleanup registered processes → exit
- Between ticks, the orchestrator polls `memory/stop-requested`; presence of the file triggers the same cooperative shutdown
- External tools / operators may write `memory/stop-requested` directly to request shutdown without signaling
- Agents check the stop-requested marker between tool calls and halt the current turn cleanly

**FR-29 Local-first integration**
- All state mutations persist to local files first; remote propagation (git push, PR creation, webhook delivery, MCP server calls) is strictly a secondary action
- On remote failure the project continues in `local_only` mode with a warning entry in PROGRESS.md
- Reconnection is attempted on the next applicable lifecycle event (next merge, next tick, next explicit command); no background retry daemon
- Local-only mode is first-class — every feature must have a defined behavior when remote is unavailable

**FR-30 Agent liveness via event-stream silence**
- The orchestrator monitors each active agent's FR-16 event stream; the stream itself is the heartbeat. Any emitted event (`tool_started`, `tool_completed`, `assistant_delta`, `task_transition`, `agent_issue`, etc.) renews the liveness timestamp. There is NO separate heartbeat file or polling channel.
- Silence exceeding the threshold set by lever `agent_health_strictness` flags the agent as **stalled**:
  - `lax` — 5 minute threshold
  - `standard` — 2 minute threshold
  - `strict` — 45 second threshold
- For out-of-process workers (FR-24 concurrent dispatch), the event stream is the worker's stdout JSONL pipe. Stream EOF = clean exit; stall = no event line within threshold.
- Stall flags are **inputs** to the coordinator remediation loop (FR-32); a stall does NOT automatically restart the agent — the coordinator decides per-incident.

**FR-31 Structured agent-issue channel**
- Agents may emit `agent_issue` events (new FR-16 event type) at any point during execution via a built-in `report_issue` tool.
- Issue payload: `{code, severity, detail, suggested_action?}` where code ∈ `{stuck, tool_unavailable, context_exhausted, dependency_unreachable, infinite_loop_suspected, spec_incoherent, unknown}` and severity ∈ `{info, warn, critical}`.
- Issues are NOT terminal — the agent continues working unless the coordinator intervenes. Issues surface in the event stream and in the coordinator's next-tick inbox.
- Multiple open issues per agent are allowed; the coordinator sees the full open-issue list when invoked.

**FR-32 Coordinator remediation decision loop**
- The coordinator is invoked with a **remediation context** whenever ANY of: a stall flag (FR-30), a new `agent_issue` event (FR-31), or an agent-process exit without a terminal task status (FR-33 crash detection).
- Remediation context inputs:
  - Trigger type (stall / issue / crash) and payload
  - Recent event-stream density (last N events with timestamps)
  - Last durable checkpoint from FR-33
  - Artifact snapshot (worktree diff, partial outputs, uncommitted files)
  - Relevant lever state — `crash_recovery_default`, `remediation_autonomy`
  - Prior-attempt count on the same task and prior remediation decisions on this agent
- Coordinator chooses from a fixed action menu: `wait`, `restart_from_checkpoint`, `restart_clean`, `replace_with_different_agent`, `shelve_task` (writes `shelved` per FR-22), `pause_task_line` (blocks dependents), `escalate_to_human`.
- Whether the coordinator may act autonomously (vs. requiring human confirmation) is governed by lever `remediation_autonomy`:
  - `auto` — coordinator executes any action it chooses
  - `confirm_destructive` — `restart_clean` / `shelve_task` / `pause_task_line` require human confirmation
  - `confirm_all` — every action requires human confirmation
  - `pause_all_on_issue` — first issue or stall freezes the whole project pending human review
- **Case-by-case decisions** made inside the loop but NOT on levers: artifact retention (keep / archive / delete the failed worktree), checkpoint resumability judgment, whether the same code recurring across two tasks is coincidence or a systemic problem. The coordinator inspects the inputs and decides.
- Every remediation decision is recorded in DECISIONS.md with trigger, inputs, chosen action, rationale, and lever state at decision time.

**FR-33 Crash-safe task checkpointing and resume**
- Workers write a durable `memory/tasks/<task-id>/checkpoint.json` at each tool-boundary: before destructive filesystem changes, after subprocess success, on explicit checkpoint markers in the spec, and immediately before engine-level compaction (FR-19).
- Checkpoint contents: `{step, intent, files_touched[], last_committed_sha?, next_planned_action, engine_session_id}` — the engine session id links into FR-20 mid-turn resume.
- On orchestrator startup and on agent-crash detection, any task in a non-terminal status without a live agent process is a **reclaim candidate**. The coordinator is invoked via FR-32 with the checkpoint as input and decides resume path.
- `restart_from_checkpoint` rehydrates engine state via FR-20 and continues from `next_planned_action`. `restart_clean` discards the checkpoint (after artifact retention decision) and begins from the task spec.
- Checkpoints older than 24 hours with no live agent are auto-escalated to human review regardless of `remediation_autonomy`.

### 2.3 Non-Functional Requirements

**NFR-01 Restartability**
- The orchestrator can be stopped and restarted at any time without data loss
- On restart, it reads TASKS.json and resumes from the current task states
- Mid-turn resume via FR-20 when applicable

**NFR-02 Context efficiency**
- Per-agent context must be bounded to prevent token overflow on local models
- Memory injection capped at 4000 chars; decisions at 2000 chars
- Only the last 60 lines of PROGRESS.md injected
- Context compaction (FR-19) runs automatically before hitting model limits

**NFR-03 Observability**
- All agent transitions logged via the structured event protocol (FR-16)
- PROGRESS.md provides a human-readable audit trail
- DECISIONS.md provides a searchable ADR log
- `guildhall inspect <task-id>` replays the event stream for a task

**NFR-04 Configurability**
- All project-specific config lives in `guildhall.yaml` (or `guildhall.workspace.ts` for programmatic config)
- Ships with sensible defaults for TypeScript monorepos
- No Guildhall internals change to support a new project

**NFR-05 Test inheritance from OpenHarness (NEW)**
- Modules ported from OpenHarness retain their test contract: ported tests must pass in the TS translation
- Where Python-only behavior is tested (Pydantic validators, asyncio-specific), tests are rewritten to cover the equivalent TS behavior
- Ports ship with their tests in the same PR; no module is merged without green tests

**NFR-06 License attribution (NEW)**
- `NOTICE` at repo root credits OpenHarness (MIT) and the Claude Code lineage
- Each file ported from OpenHarness begins with an attribution comment pointing to the source file + upstream SHA

---

## 3. Gate Registry

### Hard gates (TypeScript monorepo defaults)
| Gate ID    | Command          | Timeout |
|------------|------------------|---------|
| typecheck  | pnpm typecheck   | 2 min   |
| build      | pnpm build       | 3 min   |
| test       | pnpm test        | 2 min   |
| lint       | pnpm lint        | 1 min   |

### Soft gate rubric (default code review)
| ID                      | Weight | Question |
|-------------------------|--------|----------|
| acceptance-criteria-met | 1.0    | Are all acceptance criteria explicitly met? |
| no-scope-creep          | 0.8    | Does the change stay within task scope? |
| conventions-followed    | 0.7    | Does the code follow documented conventions? |
| no-regressions          | 1.0    | Are there no obvious regressions? |
| documented              | 0.6    | Are public APIs/components documented? |

Default passing threshold: 80% weighted score.

---

## 4. Acceptance Criteria

v0.2 is the pivot release: exploring phase + ported OH engine running a single task end-to-end.
v0.3 layers the Lever model (§2.1) and the prior-harness absorption FRs (FR-21..29) on top of v0.2.

**AC-01** `pnpm typecheck` passes across all packages
**AC-02** `pnpm test` passes with ported-test-coverage of the translated OH modules (protocol, engine core, sessions)
**AC-03** The orchestrator processes a task from `exploring → done` end-to-end in a test environment
**AC-04** The Spec Agent drives a conversational intake that produces a valid spec and an `memory/exploring/<task-id>.md` transcript
**AC-05** The structured event protocol (FR-16) emits all lifecycle events for one complete task run, consumable by a subscriber
**AC-06** Hard gate runner correctly records pass/fail results on the task (unit tested)
**AC-07** `guildhall.workspace.ts` contains valid coordinator domain definitions for Looma and Knit
**AC-08** SPEC.md, MEMORY.md, DECISIONS.md, PROGRESS.md, TASKS.json, and memory/exploring/ all exist and are seeded
**AC-09** Permission modes (FR-15) are enforced at the tool dispatch layer; in `plan` mode no mutation occurs
**AC-10** Context compaction (FR-19) runs when the configured threshold is crossed and emits `compact_progress` events
**AC-11** Session persistence (FR-20) allows mid-turn resume after simulated crash
**AC-12** NOTICE file present, per-file attribution comments present on ported files

### v0.3 additions (lever model + prior-harness absorption)

**AC-13** `memory/agent-settings.yaml` stores every lever from §2.1 with position + inference rationale; orchestrator and agents read from this file and behave deterministically per the positions
**AC-14** Spec Agent can set lever positions during meta-intake (FR-14) without asking direct meta-questions, and persists inference rationale on every lever set
**AC-15** An agent can create a `proposed` task (FR-21); approval path taken matches lever `task_origination` in an end-to-end test
**AC-16** A worker can emit a pre-rejection (FR-22); task terminal state matches lever `pre_rejection_policy`; `revisionCount` is not incremented
**AC-17** With `concurrent_task_dispatch: fanout_N` (N≥2), `worktree_isolation: per_task`, and `runtime_isolation: slot_allocation`, the orchestrator runs N tasks in parallel worktrees, each worker receives unique `GUILDHALL_SLOT` and `GUILDHALL_PORT_BASE` env vars, and merges proceed per lever `merge_policy`
**AC-18** With `reviewer_mode: llm_with_deterministic_fallback`, a simulated LLM outage triggers the deterministic reviewer and the verdict record shows which path was taken
**AC-19** `SIGINT` during an active tick writes `memory/stop-requested`, drains the in-flight tick, cleans up registered child processes, and exits with status 0
**AC-20** A simulated push failure transitions the project to `local_only` mode with a PROGRESS.md entry; a subsequent successful push auto-restores normal mode
**AC-21** With `agent_health_strictness: strict`, an agent that stops emitting FR-16 events for >45 seconds is flagged as stalled on the next tick; the coordinator is invoked with a stall-trigger remediation context (FR-30, FR-32)
**AC-22** An agent calling the `report_issue` tool produces an `agent_issue` FR-16 event; the coordinator sees it in its next-tick inbox and selects an action from the FR-32 menu consistent with lever `remediation_autonomy`
**AC-23** Killing a worker process mid-task leaves a valid checkpoint at `memory/tasks/<task-id>/checkpoint.json`; on orchestrator restart the task is detected as a reclaim candidate, the coordinator is invoked via FR-32, and `restart_from_checkpoint` successfully rehydrates via FR-20 and continues from `next_planned_action`
**AC-24** Every remediation decision writes a DECISIONS.md entry containing trigger type, full input context (event density, checkpoint, artifact snapshot, lever state, prior-attempt count), chosen action, and rationale

---

## 5. Development Rules

These apply to anyone (human or agent) working on Guildhall itself:

1. **Spec first.** No implementation without a spec entry in this file or an approved task spec.
2. **Test before ship.** Every function in `@guildhall/core`, `@guildhall/protocol`, `@guildhall/tools` must have unit tests.
3. **No untested gate logic.** Gate pass/fail logic is safety-critical and must be 100% covered.
4. **Honest self-critique.** When agents work on Guildhall itself, the same self-critique requirement applies.
5. **No silent failures.** All tool execute() functions return structured errors, never throw raw.
6. **ADR for overrides.** Any deviation from this spec requires a DECISIONS.md entry.
7. **Attribution on ports.** Every file translated from OpenHarness begins with a comment linking to the source file and upstream commit SHA.
8. **Port PR discipline.** A ported module and its ported tests ship in the same PR; the PR description cross-references the upstream file.
