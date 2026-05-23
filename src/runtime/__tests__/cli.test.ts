import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  semanticCompletionBudget,
  semanticRepairCompletionBudget,
  clearServiceRuntimeState,
  clearServiceRuntimeStateIfOwnedByPid,
  discoverServiceRuntimeState,
  isPidAlive,
  launchRouteForProject,
  parseArgs,
  persistServiceRuntimeState,
  probeLiveService,
  readServiceRuntimeState,
  renderHelpText,
  resolveServiceLifecycleIntent,
  serviceStatePath,
  serviceUrlForPort,
  SHIPPED_CLI_COMMANDS,
  writeModelBakeoffReport,
} from '../cli.js'

const tmpHomes: string[] = []

function tmpHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'guildhall-cli-test-'))
  tmpHomes.push(home)
  return home
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const home of tmpHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

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

describe('CLI service lifecycle helpers', () => {
  it('parses flags and positionals without letting boolean flags consume paths', () => {
    const parsed = parseArgs(['--no-open', '/tmp/project', '--port', '9001', '--verbose'])

    expect(parsed.positionals).toEqual(['/tmp/project'])
    expect(parsed.getFlag('--port')).toBe('9001')
    expect(parsed.getFlag('--missing')).toBeUndefined()
  })

  it('persists, reads, clears, and owner-clears service runtime state', () => {
    const home = tmpHome()
    const state = {
      pid: process.pid,
      port: 7777,
      url: serviceUrlForPort(7777),
      startedAt: '2026-05-19T16:00:00.000Z',
    }

    expect(serviceStatePath(home)).toBe(join(home, '.guildhall', 'service.json'))
    expect(readServiceRuntimeState(home)).toBeNull()

    persistServiceRuntimeState(state, home)
    expect(readServiceRuntimeState(home)).toEqual(state)

    clearServiceRuntimeStateIfOwnedByPid(process.pid + 100_000, home)
    expect(readServiceRuntimeState(home)).toEqual(state)

    clearServiceRuntimeStateIfOwnedByPid(process.pid, home)
    expect(readServiceRuntimeState(home)).toBeNull()

    persistServiceRuntimeState(state, home)
    clearServiceRuntimeState(home)
    expect(readServiceRuntimeState(home)).toBeNull()
  })

  it('ignores malformed service state files and drops stale recorded processes', async () => {
    const home = tmpHome()
    mkdirSync(join(home, '.guildhall'), { recursive: true })
    writeFileSync(serviceStatePath(home), JSON.stringify({ pid: 'bad', port: 7777, url: 'x', startedAt: 'now' }))
    expect(readServiceRuntimeState(home)).toBeNull()

    writeFileSync(serviceStatePath(home), '{not json')
    expect(readServiceRuntimeState(home)).toBeNull()

    persistServiceRuntimeState({
      pid: process.pid + 100_000,
      port: 7777,
      url: serviceUrlForPort(7777),
      startedAt: '2026-05-19T16:00:00.000Z',
    }, home)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))

    expect(await discoverServiceRuntimeState(7777, home)).toBeNull()
    expect(readServiceRuntimeState(home)).toBeNull()
  })

  it('discovers a live service over HTTP and caches it for later calls', async () => {
    const home = tmpHome()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      pid: process.pid,
      startedAt: '2026-05-19T16:00:00.000Z',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(probeLiveService(7788)).resolves.toEqual({
      pid: process.pid,
      port: 7788,
      url: 'http://localhost:7788',
      startedAt: '2026-05-19T16:00:00.000Z',
    })

    await expect(discoverServiceRuntimeState(7788, home)).resolves.toEqual({
      pid: process.pid,
      port: 7788,
      url: 'http://localhost:7788',
      startedAt: '2026-05-19T16:00:00.000Z',
    })
    expect(readServiceRuntimeState(home)?.pid).toBe(process.pid)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7788/api/service')
  })

  it('handles failed probes and exposes pid liveness checks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(process.pid + 100_000)).toBe(false)
    await expect(probeLiveService(7799)).resolves.toBeNull()
  })

  it('chooses setup or project routes from the launch path instead of ambient project state', () => {
    const initialized = tmpHome()
    writeFileSync(join(initialized, 'guildhall.yaml'), 'name: Initialized\nid: initialized\ncoordinators: []\n')
    const uninitialized = tmpHome()

    expect(launchRouteForProject(null)).toBe('/projects')
    expect(launchRouteForProject(initialized)).toBe('/project')
    expect(launchRouteForProject(uninitialized)).toBe('/setup')
  })
})

describe('Guildhall CLI surface', () => {
  it('derives semantic context-indexer budgets from prompt size instead of fixed magic caps', () => {
    const small = semanticCompletionBudget('short prompt')
    const large = semanticCompletionBudget('x'.repeat(16_000))

    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
    expect(large).toBeGreaterThanOrEqual(4_000)
  })

  it('gives semantic repair its own budget because repair includes raw output plus map context', () => {
    const prompt = 'x'.repeat(16_000)
    const raw = 'y'.repeat(6_000)

    expect(semanticRepairCompletionBudget(prompt, raw)).toBeGreaterThan(semanticCompletionBudget(prompt))
  })

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
      'corpus-map',
      'model-bakeoff',
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

  it('writes a model bakeoff report as json plus markdown', () => {
    const dir = tmpHome()
    const jsonPath = join(dir, 'reports', 'bakeoff.json')

    const result = writeModelBakeoffReport(jsonPath)

    expect(result.jsonPath).toBe(jsonPath)
    expect(result.markdownPath).toBe(join(dir, 'reports', 'bakeoff.md'))
    expect(existsSync(result.jsonPath)).toBe(true)
    expect(existsSync(result.markdownPath)).toBe(true)
    expect(JSON.parse(readFileSync(result.jsonPath, 'utf8'))).toMatchObject({
      scenarioCount: expect.any(Number),
      recommendation: expect.stringContaining('Recommend'),
    })
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('# Guildhall Model Bakeoff')
  })

  it('writes the context-indexer bakeoff report when requested', () => {
    const dir = tmpHome()
    const jsonPath = join(dir, 'reports', 'context-indexer.json')

    const result = writeModelBakeoffReport(jsonPath, { contextIndexer: true })
    const report = JSON.parse(readFileSync(result.jsonPath, 'utf8'))

    expect(report.scenarioCount).toBe(4)
    expect(report.recommendation).toContain('deepinfra-deepseek-v4-flash-context')
    expect(report.scenarios.every((scenario: { origin: string }) => scenario.origin === 'context-indexer')).toBe(true)
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('Context indexer')
  })
})
