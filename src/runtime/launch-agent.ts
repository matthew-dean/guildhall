import { join } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_LAUNCH_AGENT_LABEL = 'io.guildhall.agent'
export const DEFAULT_PACKAGED_SERVICE_PORT = 7777

export interface MacosPackagePaths {
  homeDir: string
  guildhallHomeDir: string
  appDir: string
  currentInstallDir: string
  binDir: string
  binPath: string
  runtimeNodePath: string
  appRuntimeDir: string
  cliEntrypointPath: string
  manifestPath: string
  logsDir: string
  serviceStatePath: string
  launchAgentsDir: string
  launchAgentPath: string
}

export interface LaunchAgentSpec {
  label: string
  plistPath: string
  workingDirectory: string
  programArguments: string[]
  stdoutPath: string
  stderrPath: string
  environmentVariables: Record<string, string>
  keepAlive: boolean
  runAtLoad: boolean
}

export const DEFAULT_LAUNCH_AGENT_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':')

export interface MacosPackageManifest {
  version: string
  platform: 'darwin'
  label: string
  defaultPort: number
  executableRelativePath: string
  runtimeRelativePath: string
  cliEntrypointRelativePath: string
}

export interface LaunchAgentLifecycleTarget {
  plistPath: string
  domainTarget: string
  serviceTarget: string
}

export function resolveLaunchAgentLifecycleTarget(
  opts: { homeDir?: string; uid?: number; platform?: NodeJS.Platform; port?: number } = {},
): LaunchAgentLifecycleTarget | null {
  const currentPlatform = opts.platform ?? process.platform
  const uid = opts.uid ?? process.getuid?.()
  const port = opts.port ?? DEFAULT_PACKAGED_SERVICE_PORT
  if (currentPlatform !== 'darwin' || uid === undefined || port !== DEFAULT_PACKAGED_SERVICE_PORT) {
    return null
  }

  const paths = resolveMacosPackagePaths(opts.homeDir)
  const domainTarget = `gui/${uid}`
  return {
    plistPath: paths.launchAgentPath,
    domainTarget,
    serviceTarget: `${domainTarget}/${DEFAULT_LAUNCH_AGENT_LABEL}`,
  }
}

export function resolveMacosPackagePaths(homeDir = homedir()): MacosPackagePaths {
  const guildhallHomeDir = join(homeDir, '.guildhall')
  const currentInstallDir = join(guildhallHomeDir, 'app', 'current')
  return {
    homeDir,
    guildhallHomeDir,
    appDir: join(guildhallHomeDir, 'app'),
    currentInstallDir,
    binDir: join(guildhallHomeDir, 'bin'),
    binPath: join(guildhallHomeDir, 'bin', 'guildhall'),
    runtimeNodePath: join(currentInstallDir, 'runtime', 'node'),
    appRuntimeDir: join(currentInstallDir, 'app'),
    cliEntrypointPath: join(currentInstallDir, 'app', 'dist', 'cli.js'),
    manifestPath: join(currentInstallDir, 'manifest.json'),
    logsDir: join(guildhallHomeDir, 'logs'),
    serviceStatePath: join(guildhallHomeDir, 'service.json'),
    launchAgentsDir: join(homeDir, 'Library', 'LaunchAgents'),
    launchAgentPath: join(homeDir, 'Library', 'LaunchAgents', `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`),
  }
}

export function buildLaunchAgentSpec(
  opts: { homeDir?: string; port?: number; label?: string } = {},
): LaunchAgentSpec {
  const paths = resolveMacosPackagePaths(opts.homeDir)
  const label = opts.label ?? DEFAULT_LAUNCH_AGENT_LABEL
  const port = opts.port ?? DEFAULT_PACKAGED_SERVICE_PORT
  return {
    label,
    plistPath: paths.launchAgentPath,
    workingDirectory: paths.currentInstallDir,
    programArguments: [
      paths.binPath,
      'serve-internal',
      '--port',
      String(port),
      '--service-state',
      paths.serviceStatePath,
    ],
    stdoutPath: join(paths.logsDir, 'service.stdout.log'),
    stderrPath: join(paths.logsDir, 'service.stderr.log'),
    environmentVariables: {
      PATH: DEFAULT_LAUNCH_AGENT_PATH,
    },
    keepAlive: true,
    runAtLoad: true,
  }
}

export function renderLaunchAgentPlist(spec: LaunchAgentSpec): string {
  const args = spec.programArguments
    .map(arg => `    <string>${xmlEscape(arg)}</string>`)
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xmlEscape(spec.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    args,
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xmlEscape(spec.workingDirectory)}</string>`,
    '  <key>StandardOutPath</key>',
    `  <string>${xmlEscape(spec.stdoutPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xmlEscape(spec.stderrPath)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...Object.entries(spec.environmentVariables).flatMap(([key, value]) => [
      `    <key>${xmlEscape(key)}</key>`,
      `    <string>${xmlEscape(value)}</string>`,
    ]),
    '  </dict>',
    '  <key>KeepAlive</key>',
    spec.keepAlive ? '  <true/>' : '  <false/>',
    '  <key>RunAtLoad</key>',
    spec.runAtLoad ? '  <true/>' : '  <false/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

export function buildMacosPackageManifest(version: string): MacosPackageManifest {
  return {
    version,
    platform: 'darwin',
    label: DEFAULT_LAUNCH_AGENT_LABEL,
    defaultPort: DEFAULT_PACKAGED_SERVICE_PORT,
    executableRelativePath: 'bin/guildhall',
    runtimeRelativePath: 'runtime/node',
    cliEntrypointRelativePath: 'app/dist/cli.js',
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
