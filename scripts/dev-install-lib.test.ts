import { describe, expect, it } from 'vitest'

import {
  artifactDirForRoot,
  devInstallPaths,
  pathContainsDir,
} from './dev-install-lib.mjs'

describe('devInstallPaths', () => {
  it('maps the packaged dev install into stable user-local paths', () => {
    const paths = devInstallPaths('/Users/tester')

    expect(paths.guildhallHome).toBe('/Users/tester/.guildhall')
    expect(paths.localBinDir).toBe('/Users/tester/.local/bin')
    expect(paths.localBinPath).toBe('/Users/tester/.local/bin/guildhall')
    expect(paths.guildhallBinPath).toBe('/Users/tester/.guildhall/bin/guildhall')
    expect(paths.appDir).toBe('/Users/tester/.guildhall/app')
    expect(paths.currentInstallDir).toBe('/Users/tester/.guildhall/app/current')
    expect(paths.serviceStatePath).toBe('/Users/tester/.guildhall/service.json')
  })
})

describe('artifactDirForRoot', () => {
  it('points at the local macOS package artifact', () => {
    expect(artifactDirForRoot('/repo/guildhall')).toBe(
      '/repo/guildhall/artifacts/macos/guildhall-macos',
    )
  })
})

describe('pathContainsDir', () => {
  it('matches only whole PATH entries', () => {
    expect(pathContainsDir('/usr/bin:/Users/tester/.local/bin:/bin', '/Users/tester/.local/bin')).toBe(true)
    expect(pathContainsDir('/usr/bin:/Users/tester/.local/bin-tools:/bin', '/Users/tester/.local/bin')).toBe(false)
  })
})
