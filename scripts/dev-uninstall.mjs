#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { devInstallPaths, removeDirIfEmpty, removeIfExists } from './dev-install-lib.mjs'

const paths = devInstallPaths()

const stopResult = spawnSync(paths.guildhallBinPath, ['stop'], {
  stdio: 'inherit',
})
if (stopResult.error && stopResult.error.code !== 'ENOENT') {
  console.error('[guildhall dev] Failed to stop running Guildhall service.')
  throw stopResult.error
}

const uninstallResult = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./uninstall-launch-agent.mjs', import.meta.url)), '--home', paths.homeDir],
  { stdio: 'inherit' },
)
if (uninstallResult.status !== 0) {
  process.exit(uninstallResult.status ?? 1)
}

removeIfExists(paths.localBinPath)
removeIfExists(paths.guildhallBinPath)
removeIfExists(paths.currentInstallDir)
removeIfExists(paths.appDir)
removeIfExists(paths.serviceStatePath)
removeDirIfEmpty(paths.guildhallBinDir)
removeDirIfEmpty(paths.localBinDir)

console.log('[guildhall dev] Removed dev-installed CLI and packaged runtime.')
console.log('[guildhall dev] Preserved ~/.guildhall project state and registry files.')
