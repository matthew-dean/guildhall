# Coding standards
Language-agnostic quality floor for every file the agent writes.

## Functions
- Keep functions small. One thing, one level of abstraction.
- Name functions for what they return or do, not how.
- Prefer pure functions. No hidden I/O, no mutation of inputs.
- Getters must not have side effects. Reading a value never writes one.

## Naming & constants
- Names are descriptive and pronounceable. No `tmp`, `data2`, `doStuff`.
- Replace magic numbers and strings with named constants at point of use.
- Booleans read as predicates: `isReady`, `hasChildren`, not `ready`, `children`.

## Abstraction & scope
- Rule of three: do not abstract until the third duplication.
- Do not add features beyond what the task requires. No speculative hooks.
- No backwards-compat shims for code that has never shipped. Delete the old path.
- Delete dead code on sight. Unused exports, commented-out blocks, orphan files — gone.

## Errors
- Handle errors at system boundaries (HTTP, CLI, queue, file). Internal code lets them throw.
- No `try/catch` that only rethrows or logs-and-swallows.
- No defensive checks for conditions the type system already rules out. Trust the types.
- Throw with a message that tells the caller what to do next, not just what failed.

## TypeScript / JS specifics
- No `any`. Use `unknown` at boundaries and narrow.
- No `as` casts without a comment explaining why the compiler is wrong.
- Prefer `const`. `let` only when rebinding is required.
- No `== null` checks as a style. Be explicit: `x === undefined`.
