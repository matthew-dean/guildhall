import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function repoRootFromScript(metaUrl) {
  return resolve(new URL('..', metaUrl).pathname)
}

export function artifactDirForRoot(rootDir) {
  return join(rootDir, 'artifacts', 'macos', 'guildhall-macos')
}

export function devInstallPaths(homeDir = homedir()) {
  const guildhallHome = join(homeDir, '.guildhall')
  const localBinDir = join(homeDir, '.local', 'bin')
  const guildhallBinDir = join(guildhallHome, 'bin')
  const appDir = join(guildhallHome, 'app')
  return {
    homeDir,
    guildhallHome,
    localBinDir,
    localBinPath: join(localBinDir, 'guildhall'),
    guildhallBinDir,
    guildhallBinPath: join(guildhallBinDir, 'guildhall'),
    appDir,
    currentInstallDir: join(appDir, 'current'),
    serviceStatePath: join(guildhallHome, 'service.json'),
  }
}

export function pathContainsDir(pathValue, dirPath) {
  return `:${pathValue}:`.includes(`:${dirPath}:`)
}

export function removeIfExists(targetPath) {
  if (existsSync(targetPath)) rmSync(targetPath, { force: true, recursive: true })
}

export function removeDirIfEmpty(targetPath) {
  if (!existsSync(targetPath)) return
  if (readdirSync(targetPath).length === 0) {
    rmSync(targetPath, { recursive: true, force: true })
  }
}
