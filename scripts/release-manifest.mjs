export const RUNTIME_IMAGE_REPOSITORY = 'ghcr.io/matthew-dean/guildhall-runtime-debian'
export const RUNTIME_IMAGE_TAG_SUFFIX = 'trixie-node22-python313-playwright'

export function buildReleaseManifest({
  guildhallVersion,
  runtimeImageDigest = process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST ?? null,
  projectMigrations = [],
}) {
  const minor = minorLine(guildhallVersion)

  return {
    schemaVersion: 1,
    guildhallVersion,
    host: {
      nodeMajor: 22,
    },
    runtime: {
      apiVersion: '1',
      defaultImage: {
        registry: 'ghcr.io',
        repository: 'matthew-dean/guildhall-runtime-debian',
        immutableTag: `${guildhallVersion}-${RUNTIME_IMAGE_TAG_SUFFIX}`,
        minorTag: `${minor}-${RUNTIME_IMAGE_TAG_SUFFIX}`,
        digest: runtimeImageDigest,
      },
      os: {
        distribution: 'debian',
        version: '13',
        codename: 'trixie',
      },
      nodeMajor: 22,
      pythonMajorMinor: '3.13',
    },
    projectMigrations,
  }
}

export function assertRuntimeReleaseReady(manifest, { dryRun = false } = {}) {
  if (dryRun || !isRuntimeRequiredRelease(manifest.guildhallVersion)) return

  if (!manifest.runtime.defaultImage.digest) {
    throw new Error(
      `Guildhall ${manifest.guildhallVersion} requires a verified default runtime image digest before release.`,
    )
  }
}

function minorLine(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return version
  return `${match[1]}.${match[2]}`
}

function isRuntimeRequiredRelease(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 0 || minor >= 9
}
