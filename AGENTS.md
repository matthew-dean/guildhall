# Guildhall Repo Instructions

## Commit Boundaries

- Start independent work on a reviewable `codex/...` branch unless the user explicitly asks to recover an already-mixed worktree.
- Before beginning another independent concern, commit and push the verified current unit or record why it cannot yet be isolated.
- Keep product behavior, data migrations, documentation, and generated output in separate commits when they can be reviewed independently. If a release-boundary commit must combine them, say why in the commit message or accompanying audit.
- Before requesting review or publishing, report the branch, commit range, dirty-file count, and validations performed.

## Guildhall MCP when available

- Use Guildhall's MCP bridge as the preferred way to read Guildhall project
  state only when a Guildhall MCP client/tool surface is actually configured in
  the current agent environment.
- This repository currently has committed `.guildhall/` state but may not have
  a root `guildhall.yaml`. Do not assume it is a fully initialized Guildhall
  project unless that config exists or the user says they have registered it.
- For meaningful Guildhall work in an MCP-enabled environment, start by trying
  the Guildhall MCP resources before reconstructing state from raw files:
  - `guildhall://project`
  - `guildhall://project/tasks`
  - `guildhall://project/artifacts`
  - `guildhall://project/artifacts/flow-audit`
  - `guildhall://project/decisions`
  - `guildhall://project/memory`
  - `guildhall://project/capability-requests`
- When the MCP tools are available, use them for intent-shaped operations:
  - `guildhall.read_artifact` to read registered artifacts by id.
  - `guildhall.append_task_evidence` after meaningful externally driven work.
  - `guildhall.create_capability_request` instead of assuming extra host access.
  - `guildhall.list_capability_requests` before creating a duplicate request.
- If the current Codex environment has no Guildhall MCP tools configured, or if
  the repo has `.guildhall/` state without a full project config, say that
  explicitly and fall back to local files. Do not pretend raw file reads came
  through MCP.
- To smoke-test the bridge against this repo's current `.guildhall/` state,
  build first, then run a real MCP client against:

  ```sh
  pnpm build
  node dist/cli.js mcp serve /path/to/guildhall
  ```

## Task log discipline

- Keep `artifact:flow-audit` as the canonical live checklist for ongoing
  Guildhall UI/runtime hardening work. Resolve artifact IDs through the
  project-checked-in `.guildhall/artifacts.yaml` registry instead of copying a
  concrete path into new plans or handoff notes.
- When you start a meaningful multi-step fix, add or update checklist items
  before you finish the turn.
- When you complete, defer, or discover a new blocker during live testing,
  reflect that in the checklist the same turn so the next agent can resume
  without reconstructing state from chat or git history.
- Do not leave the checklist claiming work is pending when the code is already
  fixed, or claiming work is done when the browser/runtime still disproves it.

## Live testing

- Prefer validating browser/runtime changes against the real target project the
  user is actively testing, not the Guildhall repo root, unless the work is
  specifically about first-run initialization.

## Flow-audit evidence protocol

- Treat "flow audit" and "user testing" as evidence protocols, not reasoning
  summaries. Before touching code for a flow-audit fix, write the concrete user
  job for the route: the user should be able to tell what is happening now, what
  is queued, what is blocked, what they can do next, and whether the system is
  actually working.
- Every flow audit must compare the same state across the authoritative API,
  top action, work list/cards, Thread, bottom/status chrome, and visible cards
  when those surfaces claim the same concept. If two surfaces disagree about
  running, queued, blocked, owner-input, approval, or next-action state, log it
  as a failing finding and fix the shared summary/action model first.
- Browser proof must include viewport and geometry evidence. Check the reported
  or screenshot-sized desktop/split viewport, a narrower desktop viewport for
  wide layouts, and mobile when the route has a mobile layout. Visible content
  must not be clipped; if horizontal overflow is unavoidable, it must be inside
  a named scroll region.
- Use `tests/rendered-ui/flow-audit-assertions.ts` for deterministic checks:
  `defineFlowUserJob`, `readProjectFlowState`, `expectNoClippedContent`, and
  `expectProjectFlowStateAgreement`.
- Installed-app proof is mandatory when the user is looking at
  `localhost:7777`: run `pnpm build`, `pnpm dev:install`, `guildhall stop &&
  guildhall start`, confirm `/api/stale-server` reports `stale:false`, then
  verify the real route in Browser. Do not run Playwright web-server tests in
  parallel with `pnpm build` or `pnpm dev:install`; they rewrite `.svelte-kit`
  and `dist`.
- Turn escaped UX misses into calibration cases under
  `internal/calibration/cases/ux` or rendered regressions, preferably both.
  Required miss families include ambiguous primary actions, contradictory
  counts, hidden overflow, clipped cards, vague approval labels, status bars
  claiming invisible work, and passive sections looking selected.

## Summary-state and next-action ownership

- Any derived project summary, readiness, next-action, owner-input,
  release/blocker, inbox, or "what should I do now?" state must be computed in a
  shared runtime utility or API builder, cached with the project snapshot, and
  reused by every surface that displays the same concept.
- Product views must render the shared result. They must not re-rank inbox
  items, reinterpret `startReadiness`, synthesize competing "Do this next"
  labels, infer owner-input state from raw thread/task data, or duplicate
  release/blocker math locally when another view needs the same answer.
- If a view needs a new presentation of the same state, extend the shared
  summary/action model with explicit fields for that presentation instead of
  adding bespoke business logic inside the view.
- If two surfaces disagree about the next action, readiness, owner input,
  release blocker, or task-summary status, treat that as a runtime summary-model
  bug first and a copy/layout bug second.

## Model-independence boundary

- Human-readable model prose is audit/display material, never an operational
  contract. It must not decide routing, sizing, decomposition, readiness,
  proof, release scope, approval, or completion.
- If code or a test matches a model's adjective, phrase, heading, sentence
  order, verbosity, or explanation to make a decision, treat it as an
  immediate release-blocking defect. Stop the affected worker/review loop;
  remove the matcher and replace it with typed fields, stable IDs, enums,
  numeric metrics, or evidence references; fail closed when those are absent.
  Do not tune prompts around the failing wording, add a fixture exception, or
  preserve the prose matcher as a fallback. Re-run the same step after the
  owning contract is repaired.
- Model-output tests must vary arbitrary prose while holding structured data
  constant. Exact prose assertions are allowed only for system-authored copy,
  never for provider output.
- Run `pnpm model:independence` before claiming a model-facing change is
  complete. The gate rejects direct and locally aliased provider-text
  matchers; a failure is an immediate nuke-and-replace condition, not a prompt
  calibration task or a reason to add a fixture exception.

## Contract and schema governance

- Before accepting work that changes authoritative project contracts, record a
  `Contract Touch Decision` in the relevant implementation spec, plan, or review
  note. Include work id, touched contracts, contracts considered but not touched,
  required follow-up, proof required, proof provided, waivers, owner-review
  items, and apply/revert behavior.
- Before persisting project, workspace, machine, database, local-history, task,
  primitive, delivery, validation-evidence, or finished-work intake schema
  changes, record a `Schema Migration Decision`. Include persisted schema
  touched, scope, change class, existing data impact, migration id, safety,
  whether it is required before run, compatibility reader, fixtures, tests,
  owner-facing plan text, and rollback/revert behavior.
- Treat touched contracts without a decision as incomplete unless the work
  records why the detector considered the contract and why it is not touched.
- Run the advisory detector with `pnpm lint:contracts` when a change touches
  contract-owning paths. It is advisory, but missing decisions should be fixed
  before claiming the work is complete.

## Design-system constitution

- Treat design-system integrity as a first-class product and agent responsibility.
  Guildhall should always push the codebase toward more order, less duplication,
  and clearer UI ownership rather than accepting style sprawl as normal.
- Product surfaces such as pages, feature components, data components, and
  one-off views should compose shared UI components, shared layout primitives,
  and design-system tokens. They should not introduce new bespoke styling
  patterns just because nearby code is already messy.
- If a task exposes a visual or layout need that the current shared primitives
  cannot express cleanly, elevate that need into the design system first:
  define the semantics, decide whether it belongs in an existing primitive or a
  new shared primitive, choose coherent prop names, and explain the intended use
  case before using it in content-specific surfaces.
- “Do not add to sprawl” is the default rule. Existing local CSS, wrapper
  classes, or inline styles are not permission to copy the pattern forward.
  When touching an ad-hoc area, prefer extracting or extending shared
  primitives, shared props, or layout components so the area becomes more
  consistent after the change.
- Rare local styling is acceptable only when the need is genuinely
  infrastructure-level, platform-constrained, or being added inside the shared
  UI/design-system layer itself. In those cases, keep it minimal and make the
  design-system intent obvious in the implementation and review notes.
- Deterministic checks that look for style sprawl, duplicate treatments, or
  copy/paste UI patterns are advisory pressure reducers, not excuses to stop
  thinking. A task should not be treated as failed only because a touched file
  already had old mess, but the agent must not add new mess and should reduce
  nearby sprawl when it is practical inside scope.

## Docs boundary

- Treat `docs/guide`, `docs/reference`, `docs/releases`, `docs/levers`, and
  `docs/web-ui` as public product documentation unless a file is explicitly
  excluded by the docs build.
- Treat `internal/` as the home for unpublished planning, private product
  strategy, future-release specs, commercially sensitive notes, and agent-facing
  implementation plans that should not appear on the public docs site.
- Do not add future-release planning docs, private product plans, raw agent
  strategy notes, or exploratory tool comparisons under `docs/`.
- `docs/superpowers` contains legacy/internal planning material. Do not rewrite
  those files for public-doc tone unless the user explicitly asks to turn a
  specific plan/spec into public documentation.
- Before adding a new Markdown file under `docs/`, ask: "Should this be visible
  on the published docs site?" If the answer is no or unclear, put it under
  `internal/` instead.
- Before sweeping public docs copy, scope the edit to actual public pages. Do
  not run broad copy rewrites across internal planning folders.

## Public copy voice

- Anything a user reads in the product or public docs should sound like a
  smart, friendly person explaining the thing plainly. Warm, conversational,
  specific, and a little alive is good. Internal policy prose is not.
- Do not write public docs as agent instructions. Avoid defaulting to
  "Guildhall should...", "agents should...", "humans", "human input", or long
  lists of abstract conditions. Say what the reader will see, choose, trust, or
  do.
- Keep the old Guildhall voice guardrail in mind: plain language beats clever
  language, but bloodless corporate/process copy is still bad copy. If it
  sounds like a PRD, a governance memo, or an internal prompt packet, rewrite
  it before shipping.
