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
 *   1. Parse the target version (explicit semver or `patch`/`minor`/`major`)
 *      against the latest published npm release, not the local manifest.
 *   2. Verify npm auth before any irreversible release refs are pushed.
 *   3. Refuse to run on a dirty worktree or when not on `main` (override with
 *      `--allow-dirty` / `--allow-branch`).
 *   4. Bump the root `package.json` to the new version.
 *   5. For real publishes, publish or verify the default runtime image and
 *      record its digest in the release manifest.
 *   6. For real publishes, update public docs pointers and cut the one-time
 *      docs/versions/<version> snapshot from canonical docs. Dry-runs skip this.
 *   7. Typecheck + docs build + model-independence + tests + dep-cruise as
 *      the pre-publish gate.
 *   8. Rebuild `dist/` fresh.
 *   9. Build the macOS packaged artifact used by the curl installer.
 *   10. Verify package contents exclude raw docs/ but keep generated help.
 *   11. Commit the release snapshot and tag `v<version>`.
 *   12. Push the branch and tag so the GitHub release artifact workflow runs.
 *   13. Wait for the GitHub Release tarball and checksum.
 *   14. `npm publish` with `--access=public`.
 *   15. Move `package.json` to the next development version and commit/push that bump.
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
 *   --next-version <v>    Version to write back into package.json after a real
 *                         release commit/tag. Defaults to the next patch after
 *                         the published release version.
 *   --remote <name>       Git remote to push release refs (defaults to origin).
 *   --no-push             Stage the release commit/tag locally and skip runtime,
 *                         GitHub artifact, and npm publishing.
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
import {
  assertRuntimeReleaseReady,
  buildReleaseManifest,
} from './release-manifest.mjs'
import {
  resolveRuntimeImageDigestFromRegistry,
  runtimeImageRef,
} from './resolve-runtime-image-digest.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'package.json')
const GENERATED_HELP_TOPICS = join(ROOT, 'src/web/generated/help-topics.json')
const WEB_INDEX = join(ROOT, 'dist/web/index.html')
const WEB_APP_DIR = join(ROOT, 'dist/web/_app')

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1)
}

const positionalArgs = collectPositionalArgs(args)
const flags = {
  dryRun: args.includes('--dry-run'),
  skipTests: args.includes('--skip-tests'),
  allowDirty: args.includes('--allow-dirty'),
  allowBranch: args.includes('--allow-branch'),
  tag: takeFlagValue('--tag') ?? 'latest',
  nextVersion: takeFlagValue('--next-version') ?? null,
  remote: takeFlagValue('--remote') ?? 'origin',
  pushRemote: !args.includes('--no-push'),
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
const versionArg = positionalArgs[0]
if (!versionArg) die('Missing version argument. Pass a semver or `patch`/`minor`/`major`.')
if (positionalArgs.length > 1) die(`Unexpected positional arguments: ${positionalArgs.slice(1).join(' ')}`)

// ---------------------------------------------------------------------------
// 1. Resolve target version
// ---------------------------------------------------------------------------

const manifestJson = readJson(MANIFEST)
const currentVersion = manifestJson.version
const publishedVersion = fetchPublishedVersion(manifestJson.name, flags.tag)
const nextVersion = resolveNextVersion(publishedVersion ?? currentVersion, versionArg)
const postReleaseVersion = flags.dryRun ? null : resolvePostReleaseVersion(nextVersion, flags.nextVersion)
log(`Manifest version:  ${currentVersion}`)
log(`Published version: ${publishedVersion ?? '(none found)'}`)
log(`Target version:    ${nextVersion}`)
if (postReleaseVersion) {
  log(`Next dev version: ${postReleaseVersion}`)
}
if (publishedVersion === nextVersion && !flags.dryRun) {
  die(`guildhall@${nextVersion} is already published on npm; choose a newer release version.`)
}
if (!flags.dryRun && flags.pushRemote) {
  ensureNpmPublishAuth(manifestJson.name)
}

// ---------------------------------------------------------------------------
// 2. Git preflight
// ---------------------------------------------------------------------------

const releaseBranch = preflightGit()

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

const runtimeImageDigest = await resolveRuntimeImageDigest(nextVersion, releaseBranch)
const releaseManifest = buildReleaseManifest({
  guildhallVersion: nextVersion,
  runtimeImageDigest,
})
try {
  assertRuntimeReleaseReady(releaseManifest, { dryRun: flags.dryRun || !flags.pushRemote })
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
  const versionDocsDir = join(ROOT, 'docs/versions', nextVersion)
  if (existsSync(versionDocsDir)) {
    warn(`docs/versions/${nextVersion} already exists; keeping existing release snapshot for resume.`)
  } else {
    log(`Cutting docs version ${nextVersion} from current docs...`)
    run('node', ['scripts/version-docs.mjs', nextVersion])
  }
}

const releaseHelpDocsEnv = flags.dryRun
  ? {}
  : { GUILDHALL_HELP_DOCS_PREFIX: `versions/${nextVersion}/` }

// ---------------------------------------------------------------------------
// 5. Pre-publish gate
// ---------------------------------------------------------------------------

if (!flags.skipTests) {
  log('Running typecheck, docs build, model-independence, lint:deps, and release tests...')
  run('pnpm', ['typecheck'])
  run('pnpm', ['docs:build'], releaseHelpDocsEnv)
  run('pnpm', ['lint:deps'])
  // A model changing prose is a release blocker if it changes any durable
  // Guildhall meaning. Keep this adversarial gate explicit and visible rather
  // than relying on the much larger suite to make that contract obvious.
  run('pnpm', ['model:independence'])
  run('pnpm', ['test:release'])
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

if (flags.dryRun) {
  const publishArgs = ['publish', '--access=public', '--tag', flags.tag, '--dry-run']
  log(`Publishing guildhall@${nextVersion} (tag: ${flags.tag}) [dry-run]...`)
  run('npm', publishArgs)
  warn('Dry-run: skipping git commit + tag and restoring package.json.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 9. Commit + tag
// ---------------------------------------------------------------------------

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

restoreManifestOnExit = false
cleanupReleaseArtifactBackups()
releaseArtifactRollback.active = false

if (postReleaseVersion) {
  if (!flags.pushRemote) {
    warn(`--no-push: staged release commit and v${nextVersion} tag locally; skipping npm publish because GitHub release artifacts cannot be verified.`)
    log(`  Push when ready: git push ${flags.remote} HEAD:${releaseBranch} refs/tags/v${nextVersion}`)
    process.exit(0)
  }
}

if (flags.pushRemote) {
  pushReleaseRefs(releaseBranch, nextVersion)
  waitForReleaseArtifacts(nextVersion)
} else {
  warn(`--no-push: staged release commit and v${nextVersion} tag locally; skipping npm publish because GitHub release artifacts cannot be verified.`)
  log(`  Push when ready: git push ${flags.remote} HEAD:${releaseBranch} refs/tags/v${nextVersion}`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 10. Publish after GitHub artifacts exist
// ---------------------------------------------------------------------------

const publishArgs = ['publish', '--access=public', '--tag', flags.tag]

log(`Publishing guildhall@${nextVersion} (tag: ${flags.tag})...`)
run('npm', publishArgs)

log(`\n✓ Published guildhall@${nextVersion}`)

if (postReleaseVersion) {
  const nextManifest = readJson(MANIFEST)
  nextManifest.version = postReleaseVersion
  writeJson(MANIFEST, nextManifest)
  run('git', ['add', 'package.json'])
  if (hasStagedDiff(['package.json'])) {
    run('git', ['commit', '-m', `chore: start ${postReleaseVersion}`])
  } else {
    warn(`package.json already at ${postReleaseVersion}; skipping post-release bump commit.`)
  }
}
pushPostReleaseBranch(releaseBranch)

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
  --next-version <v> Version to restore into package.json after a real release
                     (default: next patch after the published release).
  --remote <name>    Git remote to push release refs (default: origin).
  --no-push          Stage the release commit/tag locally and skip runtime,
                     GitHub artifact, and npm publishing.
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

function collectPositionalArgs(argv) {
  const valueFlags = new Set(['--tag', '--next-version', '--remote'])
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (valueFlags.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('--')) continue
    positional.push(arg)
  }
  return positional
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
    .replace(/Guildhall \d+\.\d+\.\d+(-[\w.]+)?/g, `Guildhall ${version}`)
    .replace(new RegExp(`(^- \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^\\n]*) \\(Upcoming\\.\\)$`, 'm'), '$1'))

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

function runCaptureOptional(cmd, argv) {
  const result = spawnSync(cmd, argv, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result
}

async function resolveRuntimeImageDigest(version, branch) {
  if (!runtimeDigestRequired(version)) return null
  if (flags.dryRun) {
    warn(`Dry-run: skipping runtime image publish for ${runtimeImageRef(version)}.`)
    return null
  }
  if (!flags.pushRemote) {
    warn(`--no-push: skipping runtime image publish for ${runtimeImageRef(version)}.`)
    return null
  }
  if (process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST) {
    log(`Using runtime image digest from GUILDHALL_RUNTIME_IMAGE_DIGEST for ${runtimeImageRef(version)}.`)
    return process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST
  }

  let digest = await resolveRuntimeImageDigestFromRegistry({
    version,
    log: message => warn(message),
  })
  if (digest) {
    log(`Found runtime image digest for ${runtimeImageRef(version)}: ${digest}`)
    process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST = digest
    return digest
  }

  publishRuntimeImage(version, branch)
  digest = await resolveRuntimeImageDigestFromRegistry({
    version,
    wait: true,
    log: message => warn(message),
  })
  if (!digest) {
    die(`Runtime image workflow completed, but ${runtimeImageRef(version)} was not readable from GHCR.`)
  }
  log(`Verified runtime image digest for ${runtimeImageRef(version)}: ${digest}`)
  process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST = digest
  return digest
}

function runtimeDigestRequired(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 0 || minor >= 9
}

function publishRuntimeImage(version, branch) {
  log(`Publishing runtime image ${runtimeImageRef(version)} via GitHub Actions...`)
  const startedAt = Date.now()
  run('gh', ['workflow', 'run', 'runtime-image.yml', '--ref', branch, '-f', `version=${version}`])
  const runId = waitForRuntimeImageRun(version, branch, startedAt)
  log(`Waiting for runtime image workflow run ${runId}...`)
  run('gh', ['run', 'watch', runId, '--exit-status'])
}

function waitForRuntimeImageRun(version, branch, startedAt) {
  const deadline = Date.now() + Number(process.env.GUILDHALL_RUNTIME_WORKFLOW_DISCOVERY_TIMEOUT_MS ?? 2 * 60 * 1000)
  while (Date.now() <= deadline) {
    const runs = JSON.parse(runCapture('gh', [
      'run',
      'list',
      '--workflow',
      'runtime-image.yml',
      '--branch',
      branch,
      '--event',
      'workflow_dispatch',
      '--json',
      'databaseId,createdAt,displayTitle,url',
      '--limit',
      '20',
    ]))
    const candidate = runs
      .filter(run => Date.parse(run.createdAt) >= startedAt - 10_000)
      .find(run => typeof run.displayTitle === 'string' && run.displayTitle.includes(version))
      ?? runs.find(run => Date.parse(run.createdAt) >= startedAt - 10_000)
    if (candidate?.databaseId) return String(candidate.databaseId)
    sleep(5_000)
  }
  die(`Could not find the runtime image workflow run for ${version} on ${branch}.`)
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
  if (!packedPaths.has('dist/web/index.html')) {
    die('Refusing to publish package without dist/web/index.html; the help system is bundled into the SvelteKit web app.')
  }
  if (![...packedPaths].some((path) => path.startsWith('dist/web/_app/'))) {
    die('Refusing to publish package without SvelteKit web chunks under dist/web/_app/.')
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

  const webFiles = [WEB_INDEX, ...listFiles(WEB_APP_DIR).filter((file) => file.endsWith('.js'))]
  if (!webFiles.some((file) => readFileSync(file, 'utf-8').includes(firstTopic.href))) {
    die('Refusing to publish package because the SvelteKit web assets do not include generated help topics.')
  }
}

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    if (entry.isFile()) return [path]
    return []
  })
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

function resolvePostReleaseVersion(releasedVersion, explicitNextVersion) {
  if (explicitNextVersion) {
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(explicitNextVersion)) {
      die(`Post-release version "${explicitNextVersion}" is not valid semver.`)
    }
    return explicitNextVersion
  }
  return resolveNextVersion(releasedVersion, 'patch')
}

function fetchPublishedVersion(packageName, distTag) {
  const queries = distTag && distTag !== 'latest'
    ? [['view', packageName, `dist-tags.${distTag}`], ['view', packageName, 'version']]
    : [['view', packageName, 'version']]

  for (const query of queries) {
    const result = runCaptureOptional('npm', query)
    if (result.status !== 0) continue
    const value = `${result.stdout ?? ''}`.trim()
    if (value) return value
  }
  return null
}

function ensureNpmPublishAuth(packageName) {
  const authenticatedUser = npmWhoami()
  if (authenticatedUser) {
    log(`npm authenticated as ${authenticatedUser}.`)
    return
  }

  warn(`npm is not logged in for ${packageName}; starting npm login before release refs are pushed.`)
  run('npm', ['login', '--registry', 'https://registry.npmjs.org/'])

  const loggedInUser = npmWhoami()
  if (!loggedInUser) {
    die('npm login did not produce an authenticated npm session; aborting before release refs are pushed.')
  }
  log(`npm authenticated as ${loggedInUser}.`)
}

function npmWhoami() {
  const result = runCaptureOptional('npm', ['whoami', '--registry', 'https://registry.npmjs.org/'])
  if (result.status !== 0) return null
  const user = `${result.stdout ?? ''}`.trim()
  return user || null
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

  if (!flags.dryRun) {
    assertExistingReleaseTagMatchesHead(nextVersion)
  }

  if (!flags.dryRun && flags.pushRemote) {
    assertPushRemoteReady(branch, nextVersion)
  }

  return branch
}

function assertExistingReleaseTagMatchesHead(version) {
  const tagRef = `refs/tags/v${version}`
  const localTag = localRefHash(`${tagRef}^{}`)
  if (!localTag) return
  const head = runCapture('git', ['rev-parse', 'HEAD']).trim()
  if (head !== localTag) {
    die(`Tag v${version} points at ${localTag}, but HEAD is ${head}. Check out the tagged release commit before resuming so npm and GitHub artifacts are built from the same tree.`)
  }
}

function assertPushRemoteReady(branch, version) {
  const remoteUrl = runCaptureOptional('git', ['remote', 'get-url', flags.remote])
  if (remoteUrl.status !== 0 || !`${remoteUrl.stdout ?? ''}`.trim()) {
    die(`Remote "${flags.remote}" is not configured. Add it, pass --remote <name>, or use --no-push for a staged release.`)
  }
  const tagRef = `refs/tags/v${version}`
  const remoteTag = remoteRefHash(flags.remote, tagRef)
  if (remoteTag) {
    const localTag = localRefHash(tagRef)
    if (!localTag) {
      die(`Remote tag v${version} already exists on ${flags.remote}, but no matching local tag exists. Fetch tags and inspect before resuming.`)
    }
    if (remoteTag !== localTag) {
      die(`Remote tag v${version} already exists on ${flags.remote}, but it points at ${remoteTag} instead of local ${localTag}. Refusing to publish over a different release.`)
    }
    log(`Remote tag v${version} already exists on ${flags.remote} and matches the local tag; release publish can resume.`)
  }
  const remoteBranch = remoteRefHash(flags.remote, `refs/heads/${branch}`)
  if (!remoteBranch) {
    warn(`Remote branch ${flags.remote}/${branch} does not exist yet; the release push will create it.`)
  }
}

function remoteRefHash(remote, ref) {
  const result = spawnSync('git', ['ls-remote', '--exit-code', remote, ref], {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status === 0) {
    const line = `${result.stdout ?? ''}`.trim().split(/\r?\n/)[0] ?? ''
    return line.split(/\s+/)[0] || null
  }
  if (result.status === 2) return null
  die(`Command failed: git ls-remote --exit-code ${remote} ${ref}\n${result.stderr ?? ''}`.trim())
}

function localRefHash(ref) {
  const result = runCaptureOptional('git', ['rev-parse', '--verify', ref])
  if (result.status !== 0) return null
  const hash = `${result.stdout ?? ''}`.trim()
  return hash || null
}

function pushReleaseRefs(branch, version) {
  const tagRef = `refs/tags/v${version}`
  const localTag = runCapture('git', ['rev-parse', tagRef]).trim()
  const head = runCapture('git', ['rev-parse', 'HEAD']).trim()
  const remoteTag = remoteRefHash(flags.remote, tagRef)
  const remoteBranch = remoteRefHash(flags.remote, `refs/heads/${branch}`)

  if (remoteTag && remoteTag !== localTag) {
    die(`Remote tag verification failed for v${version}: expected ${localTag}, got ${remoteTag}.`)
  }
  if (remoteTag === localTag && remoteBranch === head) {
    log(`Release refs for ${branch} and v${version} are already pushed to ${flags.remote}; resuming.`)
  } else if (remoteTag === localTag) {
    log(`Pushing ${branch} to ${flags.remote}; v${version} already exists there and matches the local tag...`)
    run('git', ['push', flags.remote, `HEAD:${branch}`])
  } else {
    log(`Pushing ${branch} and v${version} to ${flags.remote}...`)
    run('git', ['push', '--atomic', flags.remote, `HEAD:${branch}`, tagRef])
  }

  const verifiedRemoteTag = remoteRefHash(flags.remote, tagRef)
  const verifiedRemoteBranch = remoteRefHash(flags.remote, `refs/heads/${branch}`)
  if (verifiedRemoteTag !== localTag) {
    die(`Remote tag verification failed for v${version}: expected ${localTag}, got ${verifiedRemoteTag || '(missing)'}.`)
  }
  if (verifiedRemoteBranch !== head) {
    die(`Remote branch verification failed for ${flags.remote}/${branch}: expected ${head}, got ${verifiedRemoteBranch || '(missing)'}.`)
  }
  if (remoteTag === localTag && remoteBranch === head) return
  log(`Pushed ${branch} and v${version} to ${flags.remote}.`)
}

function pushPostReleaseBranch(branch) {
  log(`Pushing post-release ${branch} to ${flags.remote}...`)
  run('git', ['push', flags.remote, `HEAD:${branch}`])
}

function waitForReleaseArtifacts(version) {
  const assetNames = ['guildhall-macos.tar.gz', 'guildhall-macos.tar.gz.sha256']
  const timeoutMs = Number(process.env.GUILDHALL_RELEASE_ARTIFACT_TIMEOUT_MS ?? 30 * 60 * 1000)
  const pollMs = Number(process.env.GUILDHALL_RELEASE_ARTIFACT_POLL_MS ?? 15 * 1000)
  const deadline = Date.now() + timeoutMs

  log(`Waiting for GitHub release artifacts for v${version}...`)
  while (Date.now() <= deadline) {
    const missing = assetNames.filter((assetName) => !releaseAssetExists(version, assetName))
    if (missing.length === 0) {
      log(`GitHub release artifacts for v${version} are available.`)
      return
    }
    warn(`Release artifacts not ready yet: ${missing.join(', ')}`)
    sleep(Math.max(250, pollMs))
  }

  die(`Timed out waiting for GitHub release artifacts for v${version}: ${assetNames.join(', ')}`)
}

function releaseAssetExists(version, assetName) {
  const url = `https://github.com/matthew-dean/guildhall/releases/download/v${version}/${assetName}`
  const result = spawnSync('curl', ['-fsIL', '--max-time', '20', url], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  return result.status === 0
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
