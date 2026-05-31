# Pantry Pulse Recorded Smoke Run

Result: completion-boundary-satisfying recorded run.

This is the deterministic milestone-16 record that the future lifecycle benchmark harness must reproduce with real runtime, browser, UI, and MCP evidence. It is not a public demo and does not replace live release proof; it defines the minimum evidence shape that live proof must satisfy.

## Fixture

- Spec: `internal/fixtures/app-spec-smoke/spec.md`
- Completion boundary: `internal/fixtures/app-spec-smoke/completion-boundary.md`
- Expected hierarchy: `internal/fixtures/app-spec-smoke/expected-hierarchy.md`
- Proof checklist: `internal/fixtures/app-spec-smoke/proof-checklist.md`

## Final Hierarchy

```text
Pantry Pulse app spec [done]
  Pantry item list feature [done]
    Build seeded pantry data model [done]
    Build item list and expiring-soon visual state [done]
    Build all / expiring-soon filter [done]
    Build Mark used interaction and count update [done]
  Runtime proof and completion [done]
    Run automated unit/component checks [done]
    Start runtime dev server [done]
    Record design proof and decision packet [done]
    Browser-proof expiring-soon filter and Mark used flow [done]
    Produce completion handoff [done]
```

## Runtime Evidence

- `runtime-command://pantry-pulse/install` verifies dependencies installed or no install is needed.
- `runtime-command://pantry-pulse/test` verifies automated checks passed.
- `runtime-command://pantry-pulse/build` verifies production build passed.
- `runtime-dev-server://pantry-pulse/5173` verifies the runtime dev server started with host port mapping.

## Design Proof

- `design-foundation://pantry-pulse/looma-portable` verifies a portable Looma-compatible foundation was selected before implementation.
- `screenshot://pantry-pulse/desktop` verifies the desktop rendering was captured.
- `screenshot://pantry-pulse/mobile` verifies the mobile rendering was captured.
- `design-decision://pantry-pulse/control-semantics` verifies All / Expiring soon uses a persistent mutually-exclusive filter pattern, not a command-looking toggle.
- `design-decision://pantry-pulse/palette-rationale` verifies the warm grocery/domestic palette rationale, color roles, controlled saturation, and contrast expectation.
- `design-token-audit://pantry-pulse/palette` verifies actual palette tokens across CSS, Sass/Less, JavaScript/TypeScript, JSON, or the project token source; generic cool-blue primary/accent tokens fail the Pantry Pulse design boundary unless an accepted decision packet justifies them.
- `design-finding://pantry-pulse/reusable-vs-local` verifies Guildhall classified one project-specific interaction decision and one reusable segmented-filter pattern candidate.
- `design-decision-packet://pantry-pulse/final` verifies accepted feedback was compiled into worker/reviewer context.

## Browser Proof

- `browser-proof://pantry-pulse/open` verifies the Pantry Pulse page opens.
- `browser-proof://pantry-pulse/seeded-items` verifies at least five seeded pantry items are visible.
- `browser-proof://pantry-pulse/expiring-filter` verifies the expiring-soon filter hides later items.
- `browser-proof://pantry-pulse/mark-used` verifies Mark used updates the visible count.

## Design Quality Assessment

- Screenshot refs: `screenshot://pantry-pulse/desktop`, `screenshot://pantry-pulse/mobile`.
- DOM evidence: heading, seeded item cards, persistent selected filter mode, and Mark used count update are all visible and inspectable.
- Critique summary: the app should feel like a finished tiny utility, not a generic generated card grid.
- App-store-caliber gaps that must fail the run: unstyled scaffold output, unclear selected filter state, weak hierarchy, mobile crowding, color-only expiry status, one-note palette, or generic cool-blue / medical-blue primary accents for the domestic food mood.
- Spec-boundary recovery: if Guildhall refines or splits the fixed spec, runnable implementation and proof work must still preserve the Pantry Pulse completion boundary.
- Design-taste influence: the final worker/reviewer context must carry the design foundation, segmented-control semantics, palette rationale, and reusable-vs-local finding classification.

## Review And Gate

- `review://pantry-pulse/final` approves product behavior, code quality, tests, and proof path.
- `review://pantry-pulse/design` approves design foundation, screenshots, control semantics, palette rationale, and reusable-vs-local finding classification.
- `gate://pantry-pulse/final` approves commands, browser proof, and completion handoff.

## Completion Handoff

- `handoff://pantry-pulse/final` explains what shipped, how to launch it, what was verified, out-of-scope work, residual risk, and evidence refs.

## Owner Interventions

| Prompt or action | Classification | Why |
| --- | --- | --- |
| Confirm the app should stay local-only with seeded data and no accounts. | Necessary | Confirms product boundary and non-goals without asking the owner to choose Guildhall process. |

## Memory And MCP Audit

- Memory candidate: `memory://pantry-pulse/default-stack`.
- MCP audit resources:
  - `guildhall://project`
  - `guildhall://project/tasks`
  - `guildhall://project/artifacts`
  - `guildhall://project/feedback`
  - `guildhall://project/memory`

## Misses And Follow-Ups

- The recorded run contract is complete.
- The live lifecycle benchmark harness still needs to reproduce this record with actual agent/runtime/browser/MCP evidence before 0.9.0 release acceptance.
- The zero-information spec-from-scratch lane is tracked separately in `internal/fixtures/zero-info-spec-intake/scenario.md`.
