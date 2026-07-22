# Review checklist
The reviewer-agent runs this against every task in `review`. Each row is verifiable.

## Correctness
- [ ] All spec acceptance criteria for the task are met.
- [ ] Typecheck passes (`pnpm typecheck` or equivalent) with zero errors.
- [ ] Lint passes with zero errors and zero new warnings.
- [ ] Test suite passes. No skipped or `.only` tests.

## Model independence
- [ ] Human-readable model prose is never a contract. It may explain a result,
      but it must not decide routing, sizing, decomposition, readiness, proof,
      release scope, approval, or completion.
- [ ] A test or runtime path that matches a model's adjective, phrase, heading,
      sentence order, verbosity, or explanation is an immediate release blocker.
      Remove it and replace it with typed fields, stable IDs, enums, numeric
      metrics, or evidence references; fail closed when those are absent.
- [ ] Model-output tests vary arbitrary prose while holding structured data
      constant. Exact prose assertions are allowed only for system-authored
      display copy, never for provider output.

## Tests
- [ ] New or changed behavior has a test. Failing-first was demonstrated.
- [ ] No mocks introduced for code we own.
- [ ] No non-deterministic sources (`Date.now`, `Math.random`, unseeded UUIDs) without injection.

## Code quality
- [ ] No new TODO, FIXME, XXX, or HACK comments without a linked issue.
- [ ] No dead code, unused exports, or commented-out blocks introduced.
- [ ] No `any`, no unexplained `as` casts.
- [ ] No defensive checks for impossible-per-types conditions.

## Frontend (if UI changed)
- [ ] Design-system tokens used for type, spacing, and color. No new inline `font-size`/`margin` overrides.
- [ ] Heading hierarchy correct (one `<h1>`, semantic `<h2>`/`<h3>`).
- [ ] Accessibility baseline held: focus states, aria-labels on icon buttons, keyboard reachable, contrast ≥ 4.5:1.

## Security & ops
- [ ] No secrets, tokens, or PII in the diff.
- [ ] Input validated at any new system boundary.
- [ ] Feature flag or rollout plan noted if change is user-visible and risky.

## Hygiene
- [ ] Commit messages follow the standard (imperative, ≤72 char subject, why in body).
- [ ] No unrelated changes in the diff.
- [ ] Lock file updated if deps changed; no stray deps added.
- [ ] Docs updated in the same commit as behavior change.

---
If any row is unchecked, return `verdict=revise` with the specific row.
