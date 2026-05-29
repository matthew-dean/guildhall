import { readFile } from 'node:fs/promises'

export interface ReleaseManifest {
  schemaVersion: 1
  guildhallVersion: string
  host: {
    nodeMajor: 22
  }
  runtime: {
    apiVersion: '1'
    defaultImage: {
      registry: 'ghcr.io'
      repository: 'matthew-dean/guildhall-runtime-debian'
      immutableTag: string
      minorTag: string
      digest: string | null
    }
    os: {
      distribution: 'debian'
      version: '13'
      codename: 'trixie'
    }
    nodeMajor: 22
    pythonMajorMinor: '3.13'
  }
  projectMigrations: string[]
}

export interface BuildReleaseManifestOptions {
  guildhallVersion: string
  runtimeImageDigest?: string | null
  projectMigrations?: string[]
}

export type RuntimeImageRefKind = 'immutable' | 'minor' | 'digest'

const runtimeTagSuffix = 'trixie-node22-python313-playwright'

export function buildReleaseManifest(options: BuildReleaseManifestOptions): ReleaseManifest {
  const minorVersion = minorLine(options.guildhallVersion)

  return {
    schemaVersion: 1,
    guildhallVersion: options.guildhallVersion,
    host: {
      nodeMajor: 22,
    },
    runtime: {
      apiVersion: '1',
      defaultImage: {
        registry: 'ghcr.io',
        repository: 'matthew-dean/guildhall-runtime-debian',
        immutableTag: `${options.guildhallVersion}-${runtimeTagSuffix}`,
        minorTag: `${minorVersion}-${runtimeTagSuffix}`,
        digest: options.runtimeImageDigest ?? null,
      },
      os: {
        distribution: 'debian',
        version: '13',
        codename: 'trixie',
      },
      nodeMajor: 22,
      pythonMajorMinor: '3.13',
    },
    projectMigrations: options.projectMigrations ?? [],
  }
}

export function defaultRuntimeImageRef(
  manifest: ReleaseManifest,
  kind: RuntimeImageRefKind = 'immutable',
): string {
  const image = manifest.runtime.defaultImage
  const name = `${image.registry}/${image.repository}`

  if (kind === 'digest') {
    if (!image.digest) {
      throw new Error('Default runtime image digest is not recorded in the release manifest.')
    }

    return `${name}@${image.digest}`
  }

  const tag = kind === 'minor' ? image.minorTag : image.immutableTag
  return `${name}:${tag}`
}

export function assertRuntimeReleaseReady(
  manifest: ReleaseManifest,
  options: { dryRun?: boolean } = {},
): void {
  if (options.dryRun || !isRuntimeRequiredRelease(manifest.guildhallVersion)) return

  if (!manifest.runtime.defaultImage.digest) {
    throw new Error(
      `Guildhall ${manifest.guildhallVersion} requires a verified default runtime image digest before release.`,
    )
  }
}

export async function readInstalledReleaseManifest(
  entrypointUrl: string = import.meta.url,
): Promise<ReleaseManifest> {
  const manifestUrl = new URL('./release-manifest.json', entrypointUrl)
  return JSON.parse(await readFile(manifestUrl, 'utf8')) as ReleaseManifest
}

function minorLine(version: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return version
  return `${match[1]}.${match[2]}`
}

function isRuntimeRequiredRelease(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 0 || minor >= 9
}
