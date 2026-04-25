#!/usr/bin/env node
/**
 * Publish the `guildhall` package to npm.
 *
 * The repo is flat — one package at the root. There is no monorepo and
 * nothing pretends to be a package that isn't. The `dist/` bundle
 * inlines every internal module (src/*) via esbuild, so `npm install
 * guildhall` is the complete install story.
 *
 * What this script does, in order:
 *   1. Parse the target version (explicit semver or `patch`/`minor`/`major`).
 *   2. Refuse to run on a dirty worktree or when not on `main` (override with
 *      `--allow-dirty` / `--allow-branch`).
 *   3. Bump the root `package.json` to the new version.
 *   4. Typecheck + tests + dep-cruise as the pre-publish gate.
 *   5. Rebuild `dist/` fresh.
 *   6. Verify package contents exclude raw docs/ but keep generated help.
 *   7. `npm publish` with `--access=public`.
 *   8. Commit the version bump and tag `v<version>`.
 *
 * Flags:
 *   --dry-run             Print each step; run everything except `npm publish`
 *                         (uses `npm publish --dry-run`) and skip the commit/tag.
 *   --skip-tests          Skip step 4. Build still runs.
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
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'package.json')
const GENERATED_HELP_TOPICS = join(ROOT, 'src/web/generated/help-topics.json')
const WEB_BUNDLE = join(ROOT, 'dist/web/app.js')

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

const currentVersion = readJson(MANIFEST).version
const nextVersion = resolveNextVersion(currentVersion, versionArg)
log(`Current version: ${currentVersion}`)
log(`Target version:  ${nextVersion}`)

// ---------------------------------------------------------------------------
// 2. Git preflight
// ---------------------------------------------------------------------------

preflightGit()

// ---------------------------------------------------------------------------
// 3. Bump the manifest
// ---------------------------------------------------------------------------

const manifest = readJson(MANIFEST)
manifest.version = nextVersion
writeJson(MANIFEST, manifest)
log(`Bumped package.json to ${nextVersion}.`)

// ---------------------------------------------------------------------------
// 4. Pre-publish gate
// ---------------------------------------------------------------------------

if (!flags.skipTests) {
  log('Running typecheck, lint:deps, and tests…')
  run('pnpm', ['typecheck'])
  run('pnpm', ['lint:deps'])
  run('pnpm', ['test'])
} else {
  warn('Skipping gate (--skip-tests). Build still runs.')
}

// ---------------------------------------------------------------------------
// 5. Build the bundle
// ---------------------------------------------------------------------------

log('Building dist/…')
run('pnpm', ['build'])

// ---------------------------------------------------------------------------
// 6. Package contents guard
// ---------------------------------------------------------------------------

log('Checking npm package contents…')
assertNoDocsInPackage()

// ---------------------------------------------------------------------------
// 7. Publish
// ---------------------------------------------------------------------------

const publishArgs = ['publish', '--access=public', '--tag', flags.tag]
if (flags.dryRun) publishArgs.push('--dry-run')

log(`Publishing guildhall@${nextVersion} (tag: ${flags.tag})${flags.dryRun ? ' [dry-run]' : ''}…`)
run('npm', publishArgs)

// ---------------------------------------------------------------------------
// 8. Commit + tag
// ---------------------------------------------------------------------------

if (flags.dryRun) {
  warn('Dry-run: skipping git commit + tag. package.json is still bumped — revert with `git checkout -- package.json` if needed.')
  process.exit(0)
}

log('Committing version bump + tagging…')
run('git', ['add', 'package.json'])
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
  --skip-tests       Skip the pre-publish gate. Build still runs. Use sparingly.
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

function run(cmd, argv) {
  try {
    execFileSync(cmd, argv, { stdio: 'inherit', cwd: ROOT })
  } catch {
    die(`Command failed: ${cmd} ${argv.join(' ')}`)
  }
}

function runCapture(cmd, argv) {
  try {
    return execFileSync(cmd, argv, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch {
    die(`Command failed: ${cmd} ${argv.join(' ')}`)
  }
}

function assertNoDocsInPackage() {
  const stdout = runCapture('npm', ['pack', '--dry-run', '--json'])
  let packs
  try {
    packs = JSON.parse(stdout)
  } catch {
    die('Could not parse `npm pack --dry-run --json` output.')
  }

  const files = packs.flatMap((pack) => pack.files ?? [])
  const docsFiles = files
    .map((file) => file.path)
    .filter((path) => path === 'docs' || path.startsWith('docs/'))

  if (docsFiles.length > 0) {
    die(`Refusing to publish package with docs/ files:\n${docsFiles.map((path) => `  - ${path}`).join('\n')}`)
  }

  assertHelpSystemInPackage(files)

  log(`Package contents OK (${files.length} files, no raw docs/; generated help is bundled).`)
}

function assertHelpSystemInPackage(files) {
  const packedPaths = new Set(files.map((file) => file.path))
  if (!packedPaths.has('dist/web/app.js')) {
    die('Refusing to publish package without dist/web/app.js; the help system is bundled into the web app.')
  }

  let topics
  try {
    topics = JSON.parse(readFileSync(GENERATED_HELP_TOPICS, 'utf-8'))
  } catch {
    die('Refusing to publish package without generated help topics. Run `pnpm build` before publishing.')
  }

  const firstTopic = Object.values(topics)[0]
  if (!firstTopic?.href) {
    die('Refusing to publish package without generated help topic hrefs.')
  }

  const webBundle = readFileSync(WEB_BUNDLE, 'utf-8')
  if (!webBundle.includes(firstTopic.href)) {
    die('Refusing to publish package because dist/web/app.js does not include generated help topics.')
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
