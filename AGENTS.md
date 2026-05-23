# Guildhall Repo Instructions

## Task log discipline

- Keep `/Users/matthew/git/oss/guildhall/internal/audits/flow-audit.md` as the
  canonical live checklist for ongoing Guildhall UI/runtime hardening work.
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
