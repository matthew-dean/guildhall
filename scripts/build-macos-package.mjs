#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACTS_DIR = join(ROOT, 'artifacts', 'macos')
const PACKAGE_DIR = join(ARTIFACTS_DIR, 'guildhall-macos')
const TAR_PATH = join(ARTIFACTS_DIR, 'guildhall-macos.tar.gz')
const args = new Set(process.argv.slice(2))

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = manifest.version

if (!args.has('--skip-build')) {
  run('pnpm', ['build'])
}

rmSync(PACKAGE_DIR, { recursive: true, force: true })
mkdirSync(PACKAGE_DIR, { recursive: true })
mkdirSync(join(PACKAGE_DIR, 'runtime'), { recursive: true })
mkdirSync(join(PACKAGE_DIR, 'bin'), { recursive: true })
mkdirSync(join(PACKAGE_DIR, 'install'), { recursive: true })

deployApp(join(PACKAGE_DIR, 'app'))
copyFileSync(process.execPath, join(PACKAGE_DIR, 'runtime', 'node'))
chmodSync(join(PACKAGE_DIR, 'runtime', 'node'), 0o755)

copyFileSync(join(ROOT, 'scripts', 'install-launch-agent.mjs'), join(PACKAGE_DIR, 'install', 'install-launch-agent.mjs'))
copyFileSync(join(ROOT, 'scripts', 'uninstall-launch-agent.mjs'), join(PACKAGE_DIR, 'install', 'uninstall-launch-agent.mjs'))
copyFileSync(join(ROOT, 'packaging', 'macos', 'io.guildhall.agent.plist.tmpl'), join(PACKAGE_DIR, 'install', 'io.guildhall.agent.plist.tmpl'))

writeFileSync(
  join(PACKAGE_DIR, 'manifest.json'),
  JSON.stringify({
    version,
    platform: 'darwin',
    label: 'io.guildhall.agent',
    defaultPort: 7777,
    executableRelativePath: 'bin/guildhall',
    runtimeRelativePath: 'runtime/node',
    cliEntrypointRelativePath: 'app/dist/cli.js',
    releaseManifestRelativePath: 'app/dist/release-manifest.json',
  }, null, 2) + '\n',
)

const launcher = `#!/bin/sh
set -eu
SELF="$0"
while [ -L "$SELF" ]; do
  TARGET="$(readlink "$SELF")"
  case "$TARGET" in
    /*) SELF="$TARGET" ;;
    *) SELF="$(dirname "$SELF")/$TARGET" ;;
  esac
done
DIR="$(CDPATH= cd -- "$(dirname "$SELF")/.." && pwd -P)"
exec "$DIR/runtime/node" "$DIR/app/dist/cli.js" "$@"
`
writeFileSync(join(PACKAGE_DIR, 'bin', 'guildhall'), launcher, 'utf8')
chmodSync(join(PACKAGE_DIR, 'bin', 'guildhall'), 0o755)

if (existsSync(TAR_PATH)) rmSync(TAR_PATH, { force: true })
run('tar', ['-czf', TAR_PATH, '-C', ARTIFACTS_DIR, 'guildhall-macos'])

console.log(`[guildhall package] ✓ ${PACKAGE_DIR}`)
console.log(`[guildhall package] ✓ ${TAR_PATH}`)

function run(cmd, argv) {
  execFileSync(cmd, argv, { cwd: ROOT, stdio: 'inherit' })
}

function deployApp(targetDir) {
  const baseArgs = ['--filter', '.', 'deploy', '--prod', targetDir]
  const modern = spawnSync('pnpm', baseArgs, { cwd: ROOT, encoding: 'utf8' })
  if (modern.status === 0) {
    if (modern.stdout) process.stdout.write(modern.stdout)
    if (modern.stderr) process.stderr.write(modern.stderr)
    return
  }

  const combined = `${modern.stdout ?? ''}${modern.stderr ?? ''}`
  if (
    !combined.includes('ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE') &&
    !combined.includes('force-legacy-deploy') &&
    !combined.includes('--legacy')
  ) {
    if (modern.stdout) process.stdout.write(modern.stdout)
    if (modern.stderr) process.stderr.write(modern.stderr)
    process.exit(modern.status ?? 1)
  }

  if (combined.includes('ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE')) {
    process.stderr.write(' WARN  Shared workspace lockfile detected; retrying pnpm deploy with --legacy.\n')
  }
  rmSync(targetDir, { recursive: true, force: true })
  const legacy = spawnSync('pnpm', ['--filter', '.', 'deploy', '--legacy', '--prod', targetDir], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (legacy.status !== 0) process.exit(legacy.status ?? 1)
}
