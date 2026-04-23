# Documentation standards
Write docs only when the code cannot explain itself.

## When to document
- Document the *why*: hidden constraints, non-obvious invariants, workarounds for upstream bugs.
- Do not document the *what*: good names and types already do that.
- If a comment paraphrases the next line, delete the comment.

## Public API
- Every exported symbol of a public package has a typedoc block:
  - One-line summary.
  - `@param` for each parameter.
  - `@returns` for the return.
  - `@throws` for expected errors.
  - One single-line `@example` if usage is non-obvious.
- Internal helpers: no doc block. Let the name and types speak.

## Style
- One short line max per comment. No multi-paragraph essays in code.
- No "final thoughts", "notes", "TL;DR" sections inside source files.
- Reference specs, issues, or RFCs by ID: `see SPEC FR-07`, not "see the spec".

## README
- What it is (one sentence).
- Install command.
- 5-line quickstart.
- Link to full docs. Nothing else.

## CHANGELOG
- Follow Keep-a-Changelog: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- One entry per user-visible change. Internal refactors are not changelog material.

## Maintenance
- Delete stale docs aggressively. An outdated doc is worse than no doc.
- When changing behavior, update the doc in the same commit.
