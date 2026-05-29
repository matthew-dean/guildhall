import { stat } from 'node:fs/promises'

export const runtimeExecutableNames = [
  'guildhall-runtime',
  'guildhall-exec',
  'guildhall-healthcheck',
  'guildhall-capability-request',
  'guildhall-runtime-info',
] as const

export type RuntimeExecutableName = (typeof runtimeExecutableNames)[number]

export interface RuntimeContainerEnv {
  GUILDHALL_PROJECT_ID?: string
  GUILDHALL_RUNTIME_ID?: string
  GUILDHALL_PROJECT_ROOT?: string
  GUILDHALL_HOME?: string
  GUILDHALL_RUNTIME_IMAGE_TAG?: string
}

export interface RuntimeVersionInfo {
  node?: string
  python?: string
}

export interface BuildRuntimeInfoOptions {
  env?: RuntimeContainerEnv
  versions?: RuntimeVersionInfo
}

export interface RuntimeInfo {
  apiVersion: '1'
  image: {
    family: 'guildhall-runtime-debian'
    tag: string | null
    os: {
      distribution: 'debian'
      version: '13'
      codename: 'trixie'
    }
  }
  versions: RuntimeVersionInfo
  executables: readonly RuntimeExecutableName[]
  mounts: {
    projectRoot: string | null
    guildhallHome: string | null
  }
  project: {
    id: string | null
    runtimeId: string | null
  }
}

export interface RuntimeHealthCheck {
  name:
    | 'project-root-mounted'
    | 'guildhall-home-mounted'
    | 'node-22-available'
    | 'python-3-13-available'
  ok: boolean
  message?: string
}

export interface RuntimeHealth {
  ok: boolean
  checks: RuntimeHealthCheck[]
}

export function buildRuntimeInfo(options: BuildRuntimeInfoOptions = {}): RuntimeInfo {
  const env = options.env ?? process.env

  return {
    apiVersion: '1',
    image: {
      family: 'guildhall-runtime-debian',
      tag: env.GUILDHALL_RUNTIME_IMAGE_TAG ?? null,
      os: {
        distribution: 'debian',
        version: '13',
        codename: 'trixie',
      },
    },
    versions: options.versions ?? {
      node: process.version,
    },
    executables: runtimeExecutableNames,
    mounts: {
      projectRoot: env.GUILDHALL_PROJECT_ROOT ?? null,
      guildhallHome: env.GUILDHALL_HOME ?? null,
    },
    project: {
      id: env.GUILDHALL_PROJECT_ID ?? null,
      runtimeId: env.GUILDHALL_RUNTIME_ID ?? null,
    },
  }
}

export function renderRuntimeInfo(info = buildRuntimeInfo()): string {
  return `${JSON.stringify(info, null, 2)}\n`
}

export async function checkRuntimeHealth(
  options: { env?: RuntimeContainerEnv, versions?: RuntimeVersionInfo } = {},
): Promise<RuntimeHealth> {
  const env = options.env ?? process.env
  const checks: RuntimeHealthCheck[] = [
    await directoryCheck('project-root-mounted', env.GUILDHALL_PROJECT_ROOT),
    await directoryCheck('guildhall-home-mounted', env.GUILDHALL_HOME),
  ]
  if (options.versions?.node) checks.push(nodeVersionCheck(options.versions.node))
  if (options.versions?.python) checks.push(pythonVersionCheck(options.versions.python))

  return {
    ok: checks.every((check) => check.ok),
    checks,
  }
}

function nodeVersionCheck(version: string): RuntimeHealthCheck {
  if (/^v22\./.test(version)) {
    return {
      name: 'node-22-available',
      ok: true,
    }
  }

  return {
    name: 'node-22-available',
    ok: false,
    message: `expected Node 22.x, got ${version}`,
  }
}

function pythonVersionCheck(version: string): RuntimeHealthCheck {
  if (/^Python 3\.13\./.test(version)) {
    return {
      name: 'python-3-13-available',
      ok: true,
    }
  }

  return {
    name: 'python-3-13-available',
    ok: false,
    message: `expected Python 3.13.x, got ${version}`,
  }
}

async function directoryCheck(
  name: RuntimeHealthCheck['name'],
  path: string | undefined,
): Promise<RuntimeHealthCheck> {
  if (!path) {
    return {
      name,
      ok: false,
      message: 'environment variable is not set',
    }
  }

  try {
    const entry = await stat(path)

    if (!entry.isDirectory()) {
      return {
        name,
        ok: false,
        message: `not a directory: ${path}`,
      }
    }

    return { name, ok: true }
  } catch {
    return {
      name,
      ok: false,
      message: `missing directory: ${path}`,
    }
  }
}
