#!/usr/bin/env node
/**
 * Publish the `guildhall` package to npm.
 *
 * The repo is flat — one package at the root. There is no monorepo and
 * nothing pretends to be a package that isn't. The `dist/` bundle
 * inlines every internal module (src/*) via esbuild, so `npm install
 * -g guildhall` stays a complete supported install story even though
 * the recommended 0.5.x UX is the packaged macOS installer.
 *
 * What this script does, in order:
 *   1. Parse the target version (explicit semver or `patch`/`minor`/`major`).
 *   2. Refuse to run on a dirty worktree or when not on `main` (override with
 *      `--allow-dirty` / `--allow-branch`).
 *   3. Bump the root `package.json` to the new version.
 *   4. For real publishes, update public docs pointers and cut
 *      docs/versions/<version> from the current docs. Dry-runs skip this.
 *   5. Typecheck + docs build + tests + dep-cruise as the pre-publish gate.
 *   6. Rebuild `dist/` fresh.
 *   7. Build the macOS packaged artifact used by the curl installer.
 *   8. Verify package contents exclude raw docs/ but keep generated help.
 *   9. `npm publish` with `--access=public`.
 *   10. Commit the version/docs bump and tag `v<version>`.
 *
 * Flags:
 *   --dry-run             Print each step; run everything except `npm publish`
 *                         (uses `npm publish --dry-run`), skip the commit/tag,
 *                         and restore package.json before exit.
 *   --skip-tests          Skip step 4. Build still runs.
 *   --allow-dirty         Allow a dirty git tree (e.g. mid-release fix-up).
 *   --allow-branch        Allow publishing from a branch other than `main`.
 *   --tag <dist-tag>      npm dist-tag (defaults to `latest`; use `next` for
 *                         prereleases).
 *
 * Usage:
 *   node scripts/publish.mjs 0.4.0
 *   node scripts/publish.mjs patch --dry-run
 *   node scripts/publish.mjs 0.4.0-rc.1 --tag next
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertRuntimeReleaseReady, buildReleaseManifest } from './release-manifest.mjs'

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
const originalManifestText = readFileSync(MANIFEST, 'utf-8')
let restoreManifestOnExit = false
const releaseArtifactRollback = {
  active: false,
  files: new Map(),
  dirsToRestore: new Map(),
  dirsToRemove: [],
  tempDirs: [],
}
process.on('exit', () => {
  if (restoreManifestOnExit) writeFileSync(MANIFEST, originalManifestText)
  if (releaseArtifactRollback.active) restoreReleaseArtifacts()
})
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
if (manifest.version !== nextVersion) {
  manifest.version = nextVersion
  writeJson(MANIFEST, manifest)
  restoreManifestOnExit = true
  log(`Bumped package.json to ${nextVersion}.`)
} else {
  log(`package.json already at ${nextVersion}; continuing without a manifest bump.`)
}

const releaseManifest = buildReleaseManifest({
  guildhallVersion: nextVersion,
})
try {
  assertRuntimeReleaseReady(releaseManifest, { dryRun: flags.dryRun })
} catch (error) {
  die(error instanceof Error ? error.message : String(error))
}

// ---------------------------------------------------------------------------
// 4. Version docs for real publishes
// ---------------------------------------------------------------------------

if (flags.dryRun) {
  warn('Dry-run: skipping docs versioning and public docs pointer updates.')
} else {
  trackReleaseArtifacts(nextVersion)
  updatePublicDocsVersion(nextVersion)
  log(`Cutting docs version ${nextVersion} from current docs...`)
  run('node', ['scripts/version-docs.mjs', nextVersion])
}

const releaseHelpDocsEnv = flags.dryRun
  ? {}
  : { GUILDHALL_HELP_DOCS_PREFIX: `versions/${nextVersion}/` }

// ---------------------------------------------------------------------------
// 5. Pre-publish gate
// ---------------------------------------------------------------------------

if (!flags.skipTests) {
  log('Running typecheck, docs build, lint:deps, and tests...')
  run('pnpm', ['typecheck'])
  run('pnpm', ['docs:build'], releaseHelpDocsEnv)
  run('pnpm', ['lint:deps'])
  run('pnpm', ['test'])
} else {
  warn('Skipping gate (--skip-tests). Build still runs.')
}

// ---------------------------------------------------------------------------
// 6. Build the bundle
// ---------------------------------------------------------------------------

log('Building dist/...')
run('pnpm', ['build'], releaseHelpDocsEnv)

// ---------------------------------------------------------------------------
// 7. Build the macOS packaged artifact
// ---------------------------------------------------------------------------

log('Building macOS packaged artifact...')
run('node', ['scripts/build-macos-package.mjs', '--skip-build'])

// ---------------------------------------------------------------------------
// 8. Package contents guard
// ---------------------------------------------------------------------------

log('Checking npm package contents...')
assertNoDocsInPackage()

// ---------------------------------------------------------------------------
// 9. Publish
// ---------------------------------------------------------------------------

const publishArgs = ['publish', '--access=public', '--tag', flags.tag]
if (flags.dryRun) publishArgs.push('--dry-run')

log(`Publishing guildhall@${nextVersion} (tag: ${flags.tag})${flags.dryRun ? ' [dry-run]' : ''}...`)
run('npm', publishArgs)
if (!flags.dryRun) {
  restoreManifestOnExit = false
  cleanupReleaseArtifactBackups()
  releaseArtifactRollback.active = false
}

// ---------------------------------------------------------------------------
// 10. Commit + tag
// ---------------------------------------------------------------------------

if (flags.dryRun) {
  warn('Dry-run: skipping git commit + tag and restoring package.json.')
  process.exit(0)
}

log('Committing version bump + tagging...')
const releasePaths = [
  'package.json',
  'docs/index.md',
  'docs/releases/index.md',
  'docs/versions',
]
run('git', ['add', ...releasePaths])
if (hasStagedDiff(releasePaths)) {
  run('git', ['commit', '-m', `chore(release): guildhall@${nextVersion}`])
} else {
  warn('No release diff to commit; skipping release commit.')
}
if (gitRefExists(`refs/tags/v${nextVersion}`)) {
  warn(`Tag v${nextVersion} already exists; skipping tag creation.`)
} else {
  run('git', ['tag', `v${nextVersion}`])
}

log(`\n✓ Published guildhall@${nextVersion}`)
log(`  Push when ready:  git push origin main --follow-tags`)
log(`  Pushing v${nextVersion} triggers the GitHub release workflow for guildhall-macos.tar.gz.`)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node scripts/publish.mjs <version> [flags]

Arguments:
  version            Explicit semver (e.g. 0.4.0) or keyword: patch | minor | major

Flags:
  --dry-run          Do everything except the real publish and the git commit/tag;
                     restore package.json before exit.
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

function updatePublicDocsVersion(version) {
  const homePath = join(ROOT, 'docs/index.md')
  const releasesPath = join(ROOT, 'docs/releases/index.md')

  replaceFileText(homePath, (raw) => raw
    .replace(/\/(?:guildhall\/)?versions\/\d+\.\d+\.\d+(-[\w.]+)?\//g, `/versions/${version}/`)
    .replace(/Guildhall \d+\.\d+\.\d+(-[\w.]+)?/g, `Guildhall ${version}`))

  replaceFileText(releasesPath, (raw) => raw
    .replace(/\/versions\/\d+\.\d+\.\d+(-[\w.]+)?\//g, `/versions/${version}/`)
    .replace(/Guildhall \d+\.\d+\.\d+(-[\w.]+)?/g, `Guildhall ${version}`))

  log(`Updated public docs pointers to ${version}.`)
}

function trackReleaseArtifacts(version) {
  const trackedFiles = [
    join(ROOT, 'docs/index.md'),
    join(ROOT, 'docs/releases/index.md'),
  ]
  for (const file of trackedFiles) {
    releaseArtifactRollback.files.set(file, readFileSync(file, 'utf-8'))
  }
  const versionDir = join(ROOT, 'docs/versions', version)
  if (!existsSync(versionDir)) {
    releaseArtifactRollback.dirsToRemove.push(versionDir)
  }
  const versionsRoot = join(ROOT, 'docs/versions')
  if (existsSync(versionsRoot)) {
    const targetMinor = minorLine(version)
    const backupRoot = mkdtempSync(join(tmpdir(), 'guildhall-release-docs-'))
    releaseArtifactRollback.tempDirs.push(backupRoot)
    for (const entry of readdirSync(versionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === version) continue
      if (minorLine(entry.name) !== targetMinor) continue
      const source = join(versionsRoot, entry.name)
      const backup = join(backupRoot, entry.name)
      cpSync(source, backup, { recursive: true })
      releaseArtifactRollback.dirsToRestore.set(source, backup)
    }
  }
  releaseArtifactRollback.active = true
}

function restoreReleaseArtifacts() {
  for (const [file, contents] of releaseArtifactRollback.files) {
    writeFileSync(file, contents)
  }
  for (const dir of releaseArtifactRollback.dirsToRemove) {
    rmSync(dir, { recursive: true, force: true })
  }
  for (const [target, backup] of releaseArtifactRollback.dirsToRestore) {
    rmSync(target, { recursive: true, force: true })
    cpSync(backup, target, { recursive: true })
  }
  for (const dir of releaseArtifactRollback.tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function cleanupReleaseArtifactBackups() {
  for (const dir of releaseArtifactRollback.tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  releaseArtifactRollback.tempDirs = []
}

function replaceFileText(path, transform) {
  const raw = readFileSync(path, 'utf-8')
  const next = transform(raw)
  if (next !== raw) writeFileSync(path, next)
}

function run(cmd, argv, extraEnv = {}) {
  try {
    execFileSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...extraEnv } })
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

function hasStagedDiff(paths) {
  const result = spawnSync('git', ['diff', '--cached', '--quiet', '--', ...paths], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  if (result.status === 0) return false
  if (result.status === 1) return true
  die(`Command failed: git diff --cached --quiet -- ${paths.join(' ')}`)
}

function gitRefExists(ref) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', ref], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  die(`Command failed: git show-ref --verify --quiet ${ref}`)
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

function minorLine(version) {
  const match = version.match(/^(\d+)\.(\d+)(?:\.\d+)?(?:-[\w.]+)?$/)
  return match ? `${match[1]}.${match[2]}` : version
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
