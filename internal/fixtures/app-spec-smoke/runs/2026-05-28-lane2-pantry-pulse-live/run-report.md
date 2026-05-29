# Pantry Pulse Lane 2 Run Report

## Summary

- Fixture: `internal/fixtures/app-spec-smoke/spec.md`
- Initial run date: 2026-05-28
- Recovery run date: 2026-05-29
- Result: `APP_CREATED_AND_BROWSER_PROVED_WITH_RELEASE_AUDIT_GAPS`
- Live project: `<tmp>/guildhall-live-pantry-pulse-5Vh9A5`
- Live task: `task-pantry-pulse-live`

The fixed Pantry Pulse spec now reaches the important proof point that was
missing before: live Guildhall agents create a runnable app from the fixed spec.
The preserved project contains the actual app files, build output, a committed
task worktree change, and a `done` task. Browser proof verifies the core product
behavior: seeded pantry items render, the expiring-soon filter narrows the list,
and Mark used updates the visible count.

This is still not the final 0.9 release-acceptance story. The live report must
also expose explicit completion handoff, memory proposal, and MCP/context audit
evidence instead of requiring transcript or task-note archaeology.

## Commands

```sh
pnpm exec vitest run src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/context-builder.test.ts src/engine/__tests__/run-query.test.ts src/runtime/__tests__/app-spec-smoke.test.ts src/runtime/__tests__/intake.test.ts src/benchmarks/__tests__/benchmarks.test.ts src/runtime/__tests__/cli.test.ts --reporter=dot
GUILDHALL_LIVE_PANTRY_PROOF=1 GUILDHALL_PRESERVE_LIVE_PROOF=1 GUILDHALL_LIVE_PANTRY_PROJECT_PATH=<tmp>/guildhall-live-pantry-pulse-5Vh9A5 GUILDHALL_LIVE_PANTRY_TASK_ID=task-pantry-pulse-live pnpm exec vitest run src/runtime/__tests__/app-spec-smoke.test.ts --reporter=verbose --testNamePattern "uses live Guildhall agents"
```

## Pass / Fail

- Regression suite slice: passed, `493 passed | 1 skipped`.
- Live fully automated Pantry Pulse proof: passed, `1 passed | 6 skipped`.
- Final task status: `done`.
- Preserved live app browser proof: passed.
- Release-grade handoff/memory/MCP audit proof: not yet represented in the live
  report.

## Live Run Evidence

- Provider reported by Guildhall: `openai-api`, OpenAI-compatible endpoint
  `https://api.deepinfra.com/v1/openai`.
- Model assignment: `deepseek-ai/DeepSeek-V4-Flash` for spec, coordinator,
  worker, reviewer, gate checker, and context indexer.
- Fixed-spec recovery: approved Markdown acceptance criteria are now backfilled
  into structured `acceptanceCriteria`.
- Fixed-spec boundary recovery: the Pantry Pulse app spec is kept as runnable
  implementation work instead of being split into an unrelated parent/child.
- False-success recovery: preserved stale worker self-critiques with no
  project-file changes are rejected before redispatch.
- Generated app files: `package.json`, `vite.config.js`, `index.html`,
  `main.js`, `data.js`, `components.js`, `tokens.css`, `style.css`, and
  `dist/index.html`.
- Task worktree commit recorded by Guildhall: `ba9634244ea1a0856acdb41a9901227e971cf3ab`.

## Browser Proof

The live browser proof asserts product behavior rather than just DOM shape:

- `.pantry-item` count starts at least five.
- The visible remaining-count text appears.
- Selecting the `Expiring soon` radio option narrows the item list.
- Clicking `Mark used` updates the item count.

This proof intentionally checks control semantics as a radio-style segmented
choice, matching the design-system guidance that emerged from the earlier UI
critique.

## Remaining Release Gap

The app-creation story is fixed. The release-acceptance story still needs a
first-class report packet for:

- completion handoff;
- accepted or proposed memory;
- MCP/context audit answers;
- screenshot refs from the live app when the release benchmark requires visual
  design proof.

Those gaps should be tracked as reporting/audit work, not as evidence that the
live agents failed to create the app.
