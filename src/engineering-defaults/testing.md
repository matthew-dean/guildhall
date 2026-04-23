# Testing standards
TDD-first. A failing test exists before the code that makes it pass.

## Workflow
- Write the failing test first. Run it. Watch it fail for the right reason.
- Then write the minimum code to make it pass. Then refactor.
- Every public function has at least one test covering its contract.

## What to test where
- Unit tests for pure logic. Fast, no I/O.
- Integration tests for anything touching network, disk, DB, subprocess, or time.
- Do not mock code you own. Mocks mask real integration bugs.
- Integration tests hit real services: test containers, in-memory DBs, local fixtures. Not mocks.

## Determinism
- No `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` without injection or seeding.
- No reliance on test execution order. Each test sets up its own state.
- No network calls to external services in CI. Fixture or containerize.
- Tests pass 100 runs in a row or they are flaky and must be fixed, not retried.

## Assertions & failure
- Each test name states what is being verified: `returns null when input is empty`.
- One logical assertion per test. Helpers for shared setup, not shared assertions.
- Fail loudly. No `try/catch` in tests that hides the real error.
- Assert on values, not on whether functions were called, unless interaction is the contract.

## Coverage
- Coverage is a floor signal, not a goal. 100% of public API, branches on error paths.
- Untested code is assumed broken.
