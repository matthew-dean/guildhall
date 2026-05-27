# Guildhall Repo Instructions

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
  node dist/cli.js mcp serve /Users/matthew/git/oss/guildhall
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
