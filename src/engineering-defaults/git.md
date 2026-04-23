# Git standards
One logical change per commit. History is read more than written.

## Commits
- One logical change per commit. Refactor and feature do not share a commit.
- Imperative mood: "Add X", "Fix Y", not "Added" or "Fixes".
- Subject ≤ 72 chars. Blank line. Body explains *why*, not what — the diff shows what.
- Reference issue/spec IDs in the body, not the subject.

## Branches
- `feat/<slug>` for features. `fix/<slug>` for bugs. `chore/<slug>` for tooling/refactor.
- Branch from the default branch. Rebase before merge; no merge commits from main into feature branches.

## What not to do
- Never force-push to a shared branch (main, release, or anything another agent pulled).
- Never `--no-verify`. If a hook fails, fix the underlying problem.
- Never amend a commit that has been pushed and others may have fetched.
- Never commit secrets, credentials, or generated artifacts.

## What to commit
- Lock files (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`) are committed. Not gitignored.
- `.env*` files are always gitignored. Commit `.env.example` with placeholder values.
- Build outputs (`dist/`, `build/`, `.next/`) gitignored.

## Pull requests
- PR description has: summary (why), change list (what), test plan (how verified).
- PR title follows commit-subject rules.
- PRs stay small. If it is over ~400 changed lines, split it.
