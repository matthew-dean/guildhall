import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LAUNCH_AGENT_LABEL,
  DEFAULT_LAUNCH_AGENT_PATH,
  DEFAULT_PACKAGED_SERVICE_PORT,
  buildLaunchAgentSpec,
  buildMacosPackageManifest,
  renderLaunchAgentPlist,
  resolveMacosPackagePaths,
} from '../launch-agent.js'

describe('resolveMacosPackagePaths', () => {
  it('uses the user-local guildhall layout for packaged installs', () => {
    const paths = resolveMacosPackagePaths('/Users/tester')

    expect(paths.guildhallHomeDir).toBe('/Users/tester/.guildhall')
    expect(paths.currentInstallDir).toBe('/Users/tester/.guildhall/app/current')
    expect(paths.binPath).toBe('/Users/tester/.guildhall/bin/guildhall')
    expect(paths.runtimeNodePath).toBe('/Users/tester/.guildhall/app/current/runtime/node')
    expect(paths.cliEntrypointPath).toBe('/Users/tester/.guildhall/app/current/app/dist/cli.js')
    expect(paths.launchAgentPath).toBe('/Users/tester/Library/LaunchAgents/io.guildhall.agent.plist')
    expect(paths.serviceStatePath).toBe('/Users/tester/.guildhall/service.json')
  })
})

describe('buildLaunchAgentSpec', () => {
  it('points LaunchAgent execution at the packaged executable and serve-internal mode', () => {
    const spec = buildLaunchAgentSpec({ homeDir: '/Users/tester', port: 8123 })

    expect(spec.label).toBe(DEFAULT_LAUNCH_AGENT_LABEL)
    expect(spec.programArguments).toEqual([
      '/Users/tester/.guildhall/bin/guildhall',
      'serve-internal',
      '--port',
      '8123',
      '--service-state',
      '/Users/tester/.guildhall/service.json',
    ])
    expect(spec.workingDirectory).toBe('/Users/tester/.guildhall/app/current')
    expect(spec.stdoutPath).toBe('/Users/tester/.guildhall/logs/service.stdout.log')
    expect(spec.stderrPath).toBe('/Users/tester/.guildhall/logs/service.stderr.log')
    expect(spec.environmentVariables).toEqual({ PATH: DEFAULT_LAUNCH_AGENT_PATH })
  })

  it('renders a stable plist with the packaged service arguments', () => {
    const spec = buildLaunchAgentSpec({ homeDir: '/Users/tester' })
    const plist = renderLaunchAgentPlist(spec)

    expect(plist).toContain('<string>io.guildhall.agent</string>')
    expect(plist).toContain('<string>/Users/tester/.guildhall/bin/guildhall</string>')
    expect(plist).toContain('<string>serve-internal</string>')
    expect(plist).toContain('<string>--service-state</string>')
    expect(plist).toContain('<string>/Users/tester/.guildhall/service.json</string>')
    expect(plist).toContain('<key>EnvironmentVariables</key>')
    expect(plist).toContain('<key>PATH</key>')
    expect(plist).toContain(`<string>${DEFAULT_LAUNCH_AGENT_PATH}</string>`)
    expect(plist).toContain('<key>KeepAlive</key>')
  })
})

describe('buildMacosPackageManifest', () => {
  it('publishes artifact metadata that points at the packaged runtime contract', () => {
    const manifest = buildMacosPackageManifest('0.5.0')

    expect(manifest.version).toBe('0.5.0')
    expect(manifest.platform).toBe('darwin')
    expect(manifest.label).toBe(DEFAULT_LAUNCH_AGENT_LABEL)
    expect(manifest.defaultPort).toBe(DEFAULT_PACKAGED_SERVICE_PORT)
    expect(manifest.executableRelativePath).toBe('bin/guildhall')
    expect(manifest.runtimeRelativePath).toBe('runtime/node')
    expect(manifest.cliEntrypointRelativePath).toBe('app/dist/cli.js')
  })
})
