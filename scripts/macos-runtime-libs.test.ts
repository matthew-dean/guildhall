import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveRuntimeDylib, runtimeDylibDependencies } from './macos-runtime-libs.mjs'

describe('macos runtime dylibs', () => {
  it('finds @rpath libnode dependencies from otool output', () => {
    expect(runtimeDylibDependencies('/tmp/node', {
      otool: () => [
        '/tmp/node:',
        '\t@rpath/libnode.141.dylib (compatibility version 141.0.0, current version 141.0.0)',
        '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)',
      ].join('\n'),
    })).toEqual(['@rpath/libnode.141.dylib'])
  })

  it('resolves runtime dylibs from supplied search dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guildhall-runtime-lib-'))
    const lib = join(dir, 'libnode.141.dylib')
    writeFileSync(lib, 'fake')

    expect(resolveRuntimeDylib('@rpath/libnode.141.dylib', '/tmp/package/runtime/node', {
      searchDirs: [dir],
    })).toBe(lib)
  })
})
