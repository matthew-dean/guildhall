import { describe, expect, it } from 'vitest'
import { renderHelpText, resolveServiceLifecycleIntent, SHIPPED_CLI_COMMANDS } from '../cli.js'

describe('resolveServiceLifecycleIntent', () => {
  it('treats serve as a friendly open-and-start path with a cwd launch hint', () => {
    const intent = resolveServiceLifecycleIntent('serve', [], {
      cwd: '/tmp/example-project',
    })

    expect(intent).toMatchObject({
      kind: 'serve',
      port: 7777,
      openBrowser: true,
      launchProjectPath: '/tmp/example-project',
    })
  })

  it('treats start as a fleet-level background service command', () => {
    const intent = resolveServiceLifecycleIntent('start', [], {
      cwd: '/tmp/not-a-project',
    })

    expect(intent).toMatchObject({
      kind: 'start',
      port: 7777,
      launchProjectPath: null,
      openBrowser: false,
    })
  })

  it('lets serve preserve an explicit project launch hint without rebinding service identity', () => {
    const intent = resolveServiceLifecycleIntent('serve', ['~/work/demo', '--port', '9001'], {
      cwd: '/tmp/elsewhere',
      homeDir: '/Users/tester',
    })

    expect(intent).toMatchObject({
      kind: 'serve',
      port: 7777,
      launchProjectPath: '/Users/tester/work/demo',
      openBrowser: true,
    })
  })

  it('recognizes open and stop as service lifecycle helpers', () => {
    expect(resolveServiceLifecycleIntent('open', [], { cwd: '/tmp/x' })?.kind).toBe('open')
    expect(resolveServiceLifecycleIntent('stop', [], { cwd: '/tmp/x' })?.kind).toBe('stop')
  })
})

describe('Guildhall CLI surface', () => {
  it('keeps the shipped command list focused on service, project registry, and debug run controls', () => {
    expect(SHIPPED_CLI_COMMANDS).toEqual([
      'init',
      'register',
      'unregister',
      'list',
      'run',
      'serve',
      'start',
      'stop',
      'open',
      'config',
    ])
  })

  it('does not expose task mutation commands in help', () => {
    const help = renderHelpText()

    for (const command of SHIPPED_CLI_COMMANDS) {
      expect(help).toContain(`guildhall ${command}`)
    }

    expect(help).not.toContain('guildhall intake')
    expect(help).not.toContain('guildhall approve-spec')
    expect(help).not.toContain('guildhall resume')
    expect(help).not.toContain('guildhall meta-intake')
    expect(help).not.toContain('guildhall approve-meta-intake')
  })
})
