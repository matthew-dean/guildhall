import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildReleaseManifest,
  defaultRuntimeImageRef,
  assertRuntimeReleaseReady,
  readInstalledReleaseManifest,
} from '../release-manifest.js'

describe('release manifest', () => {
  it('describes the compatible host package and default runtime image set', () => {
    const manifest = buildReleaseManifest({
      guildhallVersion: '0.9.0',
      runtimeImageDigest: 'sha256:0123456789abcdef',
    })

    expect(manifest).toEqual({
      schemaVersion: 1,
      guildhallVersion: '0.9.0',
      host: {
        nodeMajor: 22,
      },
      runtime: {
        apiVersion: '1',
        defaultImage: {
          registry: 'ghcr.io',
          repository: 'matthew-dean/guildhall-runtime-debian',
          immutableTag: '0.9.0-trixie-node22-python313-playwright',
          minorTag: '0.9-trixie-node22-python313-playwright',
          digest: 'sha256:0123456789abcdef',
        },
        os: {
          distribution: 'debian',
          version: '13',
          codename: 'trixie',
        },
        nodeMajor: 22,
        pythonMajorMinor: '3.13',
      },
      projectMigrations: [],
    })
  })

  it('resolves the default runtime image to immutable, minor-line, and digest refs', () => {
    const manifest = buildReleaseManifest({
      guildhallVersion: '0.9.1',
      runtimeImageDigest: 'sha256:fedcba9876543210',
    })

    expect(defaultRuntimeImageRef(manifest, 'immutable')).toBe(
      'ghcr.io/matthew-dean/guildhall-runtime-debian:0.9.1-trixie-node22-python313-playwright',
    )
    expect(defaultRuntimeImageRef(manifest, 'minor')).toBe(
      'ghcr.io/matthew-dean/guildhall-runtime-debian:0.9-trixie-node22-python313-playwright',
    )
    expect(defaultRuntimeImageRef(manifest, 'digest')).toBe(
      'ghcr.io/matthew-dean/guildhall-runtime-debian@sha256:fedcba9876543210',
    )
  })

  it('blocks real 0.9 releases until the default runtime image digest is recorded', () => {
    const manifest = buildReleaseManifest({ guildhallVersion: '0.9.0' })

    expect(() => assertRuntimeReleaseReady(manifest, { dryRun: false })).toThrow(
      'Guildhall 0.9.0 requires a verified default runtime image digest before release.',
    )
    expect(() => assertRuntimeReleaseReady(manifest, { dryRun: true })).not.toThrow()
  })

  it('does not require a runtime image digest for pre-0.9 releases', () => {
    const manifest = buildReleaseManifest({ guildhallVersion: '0.8.1' })

    expect(() => assertRuntimeReleaseReady(manifest, { dryRun: false })).not.toThrow()
  })

  it('reads the installed release manifest next to a bundled entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guildhall-release-manifest-'))
    const dist = join(root, 'dist')
    await mkdir(dist)
    await writeFile(join(dist, 'cli.js'), '')
    await writeFile(
      join(dist, 'release-manifest.json'),
      `${JSON.stringify(buildReleaseManifest({ guildhallVersion: '0.9.0' }), null, 2)}\n`,
    )

    await expect(readInstalledReleaseManifest(pathToFileURL(join(dist, 'cli.js')).href)).resolves.toMatchObject({
      schemaVersion: 1,
      guildhallVersion: '0.9.0',
      runtime: {
        defaultImage: {
          immutableTag: '0.9.0-trixie-node22-python313-playwright',
        },
      },
    })
  })
})
