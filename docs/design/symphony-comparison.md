---
title: Symphony comparison
---

# Symphony comparison

This note compares Guildhall against OpenAI's Symphony direction as described in:

- [An open-source spec for Codex orchestration: Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)
- [openai/symphony `SPEC.md`](https://github.com/openai/symphony/blob/main/SPEC.md)
- [openai/symphony Elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md)
- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)

The comparison is intentionally about both feature coverage and UX. Symphony is
mostly an orchestration spec and prototype runner; Guildhall is already more of
a local product surface. That means "ahead" and "behind" are not just about code
paths. They are about who can start work, what they have to understand, how much
state is visible, and whether the system reduces or relocates operator burden.

## Executive read

Guildhall is directionally aligned with Symphony's core premise: long-running
agent work should be managed at the work-item level, not by manually babysitting
chat sessions. It is also ahead of Symphony's spec on product UX, local setup,
policy legibility, provider choice, in-browser task shaping, and explicit
human-facing controls.

The biggest gaps are external-control-plane integration and last-mile landing.
Symphony treats Linear as the source of work, keeps one isolated workspace per
issue, continuously reconciles tracker state, and explicitly shepherds work
through CI, conflicts, review, and handoff. Guildhall has richer local task and
review machinery, but its primary control plane is still project-local
`memory/TASKS.json` plus the dashboard. That is powerful for a solo/local
workflow, but less seamless for the "PM/designer files a ticket from anywhere
and gets a review packet back" workflow highlighted by Symphony.

## Comparison matrix

| Area | Symphony direction | Guildhall today | Assessment | Future exploration |
|---|---|---|---|---|
| Work source of truth | External issue tracker, currently Linear, is the control plane. Open issues become agent work. | Local `memory/TASKS.json` is the primary queue. Workspace import can seed local work from repo artifacts. | Guildhall is stronger locally; Symphony is stronger for team-native task intake. | Add an issue-tracker adapter layer that maps external tickets to Guildhall tasks without demoting local tasks. Start with read-only import/reconciliation before writes. |
| Work abstraction | Issues are deliverables; sessions and PRs are implementation details. One issue may produce multiple PRs or no PR. | Tasks, goals, business envelopes, specs, reviews, gates, and merges are first-class. | Guildhall is at least parity conceptually and richer in internal domain modeling. | Make parent goals and task groups visible enough that multi-PR/no-PR outcomes feel normal in the UI. |
| Continuous daemon behavior | Long-running service polls tracker, dispatches eligible work, retries failures, and recovers after restart. | Orchestrator ticks over local task state, resumes from memory, has liveness/remediation concepts, and exposes Run/Stop in the dashboard. | Strong conceptual parity, with Guildhall more operator-facing. | Ensure the web surface clearly distinguishes stopped, idle, blocked, running, stalled, and retry-waiting states. |
| Issue/workspace isolation | Deterministic per-issue workspaces; preserved across runs; cleanup for terminal issues. | Worktree fanout, slot allocation, runtime isolation, and merge policy are specified and implemented/tested in runtime modules. | Guildhall is stronger on runtime-resource UX, not just filesystem isolation. | Add an operator view that shows each live slot, worktree path, port base, branch, and cleanup state. |
| Workflow contract | Repo-owned `WORKFLOW.md` combines tracker config, hooks, Codex runtime settings, and prompt template. It dynamically reloads. | Repo-owned `guildhall.yaml`, `memory/agent-settings.yaml`, docs, skills, hooks, and engineering defaults split responsibilities. | Guildhall is more expressive; Symphony is simpler to bootstrap and easier to copy into an arbitrary repo. | Consider a generated "workflow brief" page or file that summarizes Guildhall's split contract for agents and humans. Avoid collapsing everything into one file unless setup friction proves it is worth it. |
| Dynamic config reload | Required: reload `WORKFLOW.md`, keep last known good config, apply future changes without restart where possible. | Dashboard reflects file changes; lever/config state lives on disk; some runtime behavior reloads per tick, but the contract is more distributed. | Partial parity. Guildhall likely needs a clearer explicit reload contract. | Document which files are hot-reloaded, which require restart, and what the UI shows when reload fails. |
| Tracker reconciliation | Poll active states, terminal states, blockers, current issue state, and cleanup terminated work. | Local lifecycle is rich; external tracker state is not the primary loop. | Symphony ahead for team workflow and remote truth reconciliation. | Explore Jira/Linear/GitHub issue adapters as sources of proposed/exploring/ready tasks, with blocked-by mapping. |
| Dependency DAG | Agents can break plans into task trees; blocked tasks wait while independent tasks run. | Task decomposition and task groups are in the spec; task lifecycle and coordinator domains exist. | Similar ambition; unclear if UI makes dependency DAGs a first-class operating surface. | Add a Planner DAG view: parent goal, child tasks, blockers, eligible-now lane, and hidden blocked work. |
| Agent-originated work | Agents file follow-up issues for out-of-scope improvements; humans evaluate/schedule. | Agent-originated proposals and dampening are explicit levers. | Guildhall ahead on policy modeling. | Make rejected/suppressed proposal shapes inspectable so users trust autonomous proposal behavior. |
| Autonomy model | Started as state-machine orchestration, then moved toward objective-oriented agents with broad tools. | Guildhall uses levers, coordinators, guild reviewers, goals, guardrails, and remediation menus. | Guildhall has a richer autonomy vocabulary. Symphony's blog offers a useful warning: do not over-constrain agents as rigid nodes. | Audit where Guildhall's lifecycle may force unnecessary transitions. Let objectives carry more context than statuses where useful. |
| Observability | At minimum structured logs; optional status surface. Elixir prototype has Phoenix LiveView dashboard and JSON API. | Rich Svelte dashboard, Thread, task drawer, timeline, SSE event feed, help system, setup wizard, provider pages. | Guildhall ahead in product UX. | Keep reducing "you have to know internals" moments. Thread should remain the command surface for corrections and decisions. |
| Non-engineer initiation | Symphony highlights PM/designer filing tasks directly in Linear and receiving a review packet/video walkthrough. | Guildhall has browser intake and setup, but assumes access to the local workspace/dashboard. | Symphony ahead for ambient team initiation; Guildhall ahead for guided local intake. | Design a "review packet" artifact per task: summary, changed files, gates, screenshots/video if available, open decisions, and safe next action. |
| Human attention load | Core promise is eliminating context switching across many Codex sessions. Engineers manage work, not sessions. | Same premise: one dashboard, persistent queue, Run/Stop, local memory, visible levers. | Strong parity. Guildhall can be friendlier because it owns the product UI. | Add a daily/weekly operator summary: active, blocked, landed, needs-review, risky autonomy decisions. |
| Mid-flight steering | Symphony explicitly accepts less continuous nudging as a tradeoff of ticket-level delegation. | Guildhall's Thread surface supports direct correction, answers, and inline setup/task actions. | Guildhall ahead for steering UX. | Preserve this advantage while adding external issue intake: external tickets should create work, but Thread should remain the place to steer live work. |
| Last-mile landing | Symphony watches CI, handles rebases/conflicts, retries flaky checks, and shepherds changes toward merging. | Merge policy, local-only mode, gates, review, and worktree integration exist; PR/CI shepherding appears less central. | Symphony ahead for repo-hosted PR lifecycle automation. | Add a "Landing lane" that tracks PR/check status, stale base, conflicts, flaky retry count, unresolved review, and merge readiness. |
| Review loop | Agents read feedback and address it; agent-to-agent review is part of the harness strategy. | Reviewer/gate-checker roles, guild persona reviewers, deterministic fallback, and fanout policies are first-class. | Guildhall ahead in review architecture. | Connect review results to GitHub/issue-thread replies when external control-plane support exists. |
| App/browser validation | Harness engineering emphasizes making UI, logs, screenshots, and browser automation legible to Codex. | Guildhall has web UI docs and browser-flow audit notes, but product-under-test validation is not yet as central as task/review/gate flow. | Symphony/harness ahead as a principle; Guildhall has pieces. | Treat screenshots, DOM snapshots, local dev servers, and smoke plans as standard review packet inputs, not ad hoc extras. |
| Repo knowledge | Harness guidance favors short map files plus structured docs, quality docs, plans, and recurring doc-gardening. | Guildhall has extensive docs, subsystem pages, levers, design notes, and help topics generated from docs frontmatter. | Guildhall aligned and possibly ahead for its own repo; customer workspaces may need scaffolding. | Add workspace doc-health checks: missing map, stale docs, uncited decisions, and hidden tribal knowledge prompts. |
| Policy legibility | Symphony uses `WORKFLOW.md`; harness recommends enforceable repo-local principles. | Guildhall's lever model is much more explicit and provenance-aware. | Guildhall ahead. | Keep lever docs concise; avoid turning levers into a second giant instruction manual. |
| Trust/safety posture | Implementation-defined but must be documented; prototype defaults to safer Codex approval/sandbox posture when omitted. | Permission modes, remediation autonomy, provider setup, local model safety, and runtime isolation are explicit. | Guildhall ahead in vocabulary; Symphony's spec is cleaner about requiring the posture to be documented. | Add a single trust/safety posture summary in setup and Settings: effective permission, sandbox, model-loading, merge, and remote-write behavior. |
| Provider/runtime portability | Symphony targets Codex app-server mode. | Guildhall is provider-agnostic: Codex, Claude, OpenAI-compatible, llama.cpp, LM Studio. | Guildhall ahead for model/runtime choice. | Make capability differences visible: which providers support streaming, tool calls, app control, long context, and reliable resume. |
| Remote worker scale | Elixir README describes local and SSH worker E2E scenarios. | Guildhall focuses on local worktrees and runtime slots. | Symphony ahead for distributed worker topology. | Explore remote slot providers only after local slot UX is boringly clear. |
| Setup friction | Symphony asks users to copy `WORKFLOW.md`, set Linear key, configure hooks, and run service. | Guildhall has `npx guildhall init`, setup wizard, provider detection, meta-intake, and docs-backed help. | Guildhall ahead. | Borrow Symphony's "single copyable contract" feel by generating a concise workspace readiness report after setup. |
| Status surface philosophy | Rich UI is explicitly a non-goal in the spec, but prototype ships optional dashboard. | Rich UI is core product strategy. | Guildhall intentionally diverges and should keep doing so. | Do not chase Symphony minimalism. Use it as a protocol/orchestration reference, not as a product ceiling. |

## UX takeaways

### Where Guildhall feels better

- **Start path:** `npx guildhall init` plus provider setup and meta-intake is friendlier than copying a workflow file and wiring tracker credentials.
- **Steering path:** Thread gives the user a natural place to answer, correct, and redirect. Symphony's ticket-level mode reduces session babysitting but can lose fine-grained mid-flight steering.
- **Policy explainability:** Levers are a better user-facing model than raw YAML fields when the user wants to understand why the system behaved a certain way.
- **Local safety:** Runtime slots, worktree isolation, permission modes, provider choice, and conservative local-model posture are easier to explain in Guildhall's UI than in a bare orchestrator spec.

### Where Symphony feels better

- **Ambient work creation:** Filing a Linear ticket is a much lower-friction team workflow than opening a local dashboard, especially for PM/design/QA.
- **Control-plane familiarity:** Teams already understand issue statuses, blockers, comments, and PR links. Symphony uses that existing map instead of asking everyone to learn a new one.
- **Last-mile confidence:** CI watching, conflict handling, flaky retry, rebase/refresh, and merge shepherding are central to the Symphony story.
- **Review packet expectation:** The blog explicitly frames finished work as something non-engineers can inspect through artifacts like a product walkthrough, not just logs and task states.

## Suggested exploration sequence

1. **External task adapter, read-only first**
   - Map Linear/Jira/GitHub issues into Guildhall proposed/exploring/ready tasks.
   - Preserve Guildhall local task IDs but store external source refs.
   - Show external status, blocker, and URL in the task drawer.

2. **Review packet artifact**
   - Generate a durable per-task packet after review/gates.
   - Include summary, acceptance criteria status, changed files, verification, screenshots/video when available, and recommended next action.
   - This should serve both dashboard users and external-ticket comments.

3. **Landing lane**
   - Add a Release/Landing view that treats PR readiness as a lifecycle, not a terminal afterthought.
   - Track CI, stale base, conflicts, unresolved review, flaky retries, push mode, and merge policy.

4. **Workflow posture summary**
   - Add a single human-readable snapshot of effective trust/safety/runtime behavior.
   - Include provider, model, permission mode, sandbox, remote-write policy, merge policy, worktree cleanup, and hot-reload state.

5. **Dependency planner**
   - Make task groups and blocked-by edges visible as a DAG.
   - Highlight "eligible now" work so autonomous fanout feels intentional instead of surprising.

6. **Harness-legibility checks**
   - Add workspace checks that score whether the target repo is agent-legible:
     docs map, gate commands, setup command, test command, architecture map, UI smoke path, and known-risk notes.

## Product position

Guildhall should not try to become a clone of Symphony. The stronger product
move is to treat Symphony as the external orchestration reference and keep
Guildhall's differentiators:

- richer local-first product UX,
- explicit lever/provenance model,
- provider and model portability,
- Thread as a live steering surface,
- guild/persona review architecture,
- strong local runtime isolation.

The strategic gap to close is not "implement Symphony." It is: let Guildhall
participate in the same team-native workflow Symphony optimizes for while
preserving Guildhall's better local operator experience.
