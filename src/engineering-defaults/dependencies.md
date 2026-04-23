# Dependency standards
A new dependency is a long-term liability. Justify it.

## Before adding
- Can the standard library do this? Use it.
- Can an existing dependency do this? Use it.
- Check bundle size (bundlephobia, `pnpm why`). Reject if cost exceeds value.
- Check maintenance: last publish < 12 months, open issues triaged, not archived.
- Check license compatibility with the project license.
- Prefer zero-dep or single-file solutions for small problems.

## Versioning
- Pin tool versions exactly (no `^`, no `~`) — formatters, linters, build tools.
- Libraries: conservative range (`~`) unless semver is known-trustworthy.
- Commit the lock file. It is the source of truth for reproducible installs.
- `pnpm` is the package manager for this project. Do not mix in `npm install` or `yarn add`.

## Install scripts
- No dependency with a postinstall script unless explicitly vetted.
- Use `pnpm` with `onlyBuiltDependencies` allowlist.

## Upgrades
- Patch and minor upgrades: monthly, batched.
- Major upgrades: their own PR, with a migration note in the PR body.
- Never upgrade a dep inside an unrelated feature commit.

## Removal
- Before refactoring, check if a dep is now unused. Remove it in the same PR.
- Run `pnpm dedupe` periodically. No unneeded duplicates in the lockfile.
