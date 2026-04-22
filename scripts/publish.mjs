#!/usr/bin/env node
/**
 * Publish the `guildhall` package to npm.
 *
 * Only `packages/guildhall/` is published — every workspace package is marked
 * `"private": true` because their source is inlined into the shipped
 * `dist/cli.js` by `packages/guildhall/build.mjs`. See README for the full
 * shape of what actually reaches npm.
 *
 * What this script does, in order:
 *   1. Parse the target version (explicit semver or `patch`/`minor`/`major`).
 *   2. Refuse to run on a dirty worktree or when not on `main` (override with
 *      `--allow-dirty` / `--allow-branch`).
 *   3. Bump every packages/<name>/package.json + root package.json to the new
 *      version so workspace manifests stay in lockstep.
 *   4. `pnpm -r typecheck && pnpm -r test` as a pre-publish gate.
 *   5. Rebuild `packages/guildhall/dist/` fresh.
 *   6. `npm publish` from `packages/guildhall/` with `--access=public`.
 *   7. Commit the version bump and tag `v<version>`.
 *
 * Flags:
 *   --dry-run             Print each step; run everything except `npm publish`
 *                         (uses `npm publish --dry-run`) and skip the commit/tag.
 *   --skip-tests          Skip steps 4 (tests + typecheck). Build still runs.
 *   --allow-dirty         Allow a dirty git tree (e.g. mid-release fix-up).
 *   --allow-branch        Allow publishing from a branch other than `main`.
 *   --tag <dist-tag>      npm dist-tag (defaults to `latest`; use `next` for
 *                         prereleases).
 *
 * Usage:
 *   node scripts/publish.mjs 0.3.0
 *   node scripts/publish.mjs patch --dry-run
 *   node scripts/publish.mjs 0.3.0-rc.1 --tag next
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const PUBLISHABLE_DIR = join(PACKAGES_DIR, 'guildhall')

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1)
}

const flags = {
  dryRun: args.includes('--dry-run'),
  skipTests: args.includes('--skip-tests'),
  allowDirty: args.includes('--allow-dirty'),
  allowBranch: args.includes('--allow-branch'),
  tag: takeFlagValue('--tag') ?? 'latest',
}
const versionArg = args.find((a) => !a.startsWith('--'))
if (!versionArg) die('Missing version argument. Pass a semver or `patch`/`minor`/`major`.')

// ---------------------------------------------------------------------------
// 1. Resolve target version
// ---------------------------------------------------------------------------

const currentVersion = readJson(join(PUBLISHABLE_DIR, 'package.json')).version
const nextVersion = resolveNextVersion(currentVersion, versionArg)
log(`Current version: ${currentVersion}`)
log(`Target version:  ${nextVersion}`)

// ---------------------------------------------------------------------------
// 2. Git preflight
// ---------------------------------------------------------------------------

preflightGit()

// ---------------------------------------------------------------------------
// 3. Bump all workspace manifests
// ---------------------------------------------------------------------------

const manifestsBumped = bumpAllManifests(nextVersion)
log(`Bumped ${manifestsBumped.length} manifests to ${nextVersion}.`)

// ---------------------------------------------------------------------------
// 4. Pre-publish gate
// ---------------------------------------------------------------------------

if (!flags.skipTests) {
  log('Running typecheck + tests…')
  run('pnpm', ['-r', 'typecheck'])
  run('pnpm', ['-r', 'test'])
} else {
  warn('Skipping typecheck + tests (--skip-tests).')
}

// ---------------------------------------------------------------------------
// 5. Build the publishable bundle
// ---------------------------------------------------------------------------

log('Building packages/guildhall/dist/…')
run('pnpm', ['--filter', 'guildhall', 'build'])

// ---------------------------------------------------------------------------
// 6. Publish
// ---------------------------------------------------------------------------

const publishArgs = ['publish', '--access=public', '--tag', flags.tag]
if (flags.dryRun) publishArgs.push('--dry-run')

log(`Publishing guildhall@${nextVersion} (tag: ${flags.tag})${flags.dryRun ? ' [dry-run]' : ''}…`)
run('npm', publishArgs, { cwd: PUBLISHABLE_DIR })

// ---------------------------------------------------------------------------
// 7. Commit + tag
// ---------------------------------------------------------------------------

if (flags.dryRun) {
  warn('Dry-run: skipping git commit + tag. Your manifests are still bumped — revert with `git checkout -- .` if needed.')
  process.exit(0)
}

log('Committing version bump + tagging…')
run('git', ['add', 'package.json', 'packages'])
run('git', ['commit', '-m', `chore(release): guildhall@${nextVersion}`])
run('git', ['tag', `v${nextVersion}`])

log(`\n✓ Published guildhall@${nextVersion}`)
log(`  Push when ready:  git push origin main --follow-tags`)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node scripts/publish.mjs <version> [flags]

Arguments:
  version            Explicit semver (e.g. 0.3.0) or keyword: patch | minor | major

Flags:
  --dry-run          Do everything except the real publish and the git commit/tag.
  --skip-tests       Skip typecheck + tests. Use sparingly.
  --allow-dirty      Permit a dirty worktree.
  --allow-branch     Publish from a branch other than main.
  --tag <dist-tag>   npm dist-tag (default: latest; use 'next' for pre-releases).
  -h, --help         Show this help.
`)
}

function takeFlagValue(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) die(`Flag ${flag} requires a value.`)
  return v
}

function log(msg) {
  console.log(`\x1b[36m[publish]\x1b[0m ${msg}`)
}
function warn(msg) {
  console.warn(`\x1b[33m[publish]\x1b[0m ${msg}`)
}
function die(msg) {
  console.error(`\x1b[31m[publish]\x1b[0m ${msg}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n')
}

function run(cmd, argv, opts = {}) {
  try {
    execFileSync(cmd, argv, { stdio: 'inherit', cwd: opts.cwd ?? ROOT })
  } catch (err) {
    die(`Command failed: ${cmd} ${argv.join(' ')}`)
  }
}

function resolveNextVersion(current, spec) {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(spec)) return spec
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/)
  if (!m) die(`Current version "${current}" isn't a plain semver; pass an explicit target.`)
  let [_, maj, min, pat] = m
  ;[maj, min, pat] = [maj, min, pat].map(Number)
  switch (spec) {
    case 'patch': return `${maj}.${min}.${pat + 1}`
    case 'minor': return `${maj}.${min + 1}.0`
    case 'major': return `${maj + 1}.0.0`
    default: die(`Unknown version spec "${spec}". Pass semver or patch/minor/major.`)
  }
}

function preflightGit() {
  let branch
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT })
      .toString().trim()
  } catch {
    die('Not inside a git repo — aborting.')
  }
  if (branch !== 'main' && !flags.allowBranch) {
    die(`Refusing to publish from branch "${branch}". Use --allow-branch to override.`)
  }

  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT })
    .toString().trim()
  if (status && !flags.allowDirty) {
    die('Working tree is dirty. Commit or stash first, or pass --allow-dirty.')
  }
}

function bumpAllManifests(version) {
  const touched = []

  const rootPath = join(ROOT, 'package.json')
  const rootJson = readJson(rootPath)
  rootJson.version = version
  writeJson(rootPath, rootJson)
  touched.push(rootPath)

  for (const entry of readdirSync(PACKAGES_DIR)) {
    const pkgPath = join(PACKAGES_DIR, entry, 'package.json')
    if (!safeStat(pkgPath)) continue
    const pkg = readJson(pkgPath)
    if (pkg.version === version) continue
    pkg.version = version
    writeJson(pkgPath, pkg)
    touched.push(pkgPath)
  }
  return touched
}

function safeStat(path) {
  try { return statSync(path) } catch { return null }
}
