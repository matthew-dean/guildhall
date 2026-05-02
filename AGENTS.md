# Guildhall Repo Instructions

## Task log discipline

- Keep `/Users/matthew/git/oss/guildhall/docs/web-ui/flow-audit.md` as the
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
