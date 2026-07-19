#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { artifactDirForRoot, devInstallPaths, pathContainsDir, repoRootFromScript } from './dev-install-lib.mjs'

const ROOT = repoRootFromScript(import.meta.url)
const paths = devInstallPaths()
const artifactDir = artifactDirForRoot(ROOT)

run('node', ['scripts/build-macos-package.mjs'])
run('sh', [fileURLToPath(new URL('./install.sh', import.meta.url))], {
  env: {
    ...process.env,
    GUILDHALL_ARTIFACT_DIR: artifactDir,
  },
})

runWithRetry(paths.localBinPath, ['--help'], { attempts: 5, delayMs: 100 })

const commandLookup = spawnSync('sh', ['-lc', 'command -v guildhall'], {
  env: {
    ...process.env,
    PATH: pathContainsDir(process.env.PATH ?? '', paths.localBinDir)
      ? process.env.PATH
      : `${paths.localBinDir}:${process.env.PATH ?? ''}`,
  },
  encoding: 'utf8',
})
if (commandLookup.status !== 0) {
  process.exit(commandLookup.status ?? 1)
}

console.log('\n[guildhall dev] Installed current branch artifact.')
console.log(`[guildhall dev] CLI path: ${commandLookup.stdout.trim()}`)
console.log('[guildhall dev] Try: guildhall serve')

function run(cmd, argv, options = {}) {
  execFileSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...options })
}

function runWithRetry(cmd, argv, { attempts, delayMs }) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      run(cmd, argv)
      return
    } catch (err) {
      lastError = err
      if (attempt === attempts) break
      sleep(delayMs)
    }
  }
  throw lastError
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
