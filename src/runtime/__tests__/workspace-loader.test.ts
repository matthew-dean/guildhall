import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadWorkspace, resolveWorkspace } from '../workspace-loader.js'

vi.mock('@guildhall/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@guildhall/config')>()
  return {
    ...actual,
    resolveConfig: vi.fn(({ workspacePath }: { workspacePath: string }) => ({
      id: 'test-workspace',
      name: 'Test Workspace',
      project: { path: workspacePath },
      memoryDir: `${workspacePath}/memory`,
      coordinators: [],
    })),
    findWorkspaceRoot: vi.fn(),
  }
})

const config = await import('@guildhall/config')

describe('workspace-loader', () => {
  const tmpRoots: string[] = []
  const previousWorkspace = process.env['FORGE_WORKSPACE']

  afterEach(() => {
    vi.mocked(config.findWorkspaceRoot).mockReset()
    vi.mocked(config.resolveConfig).mockClear()
    if (previousWorkspace === undefined) {
      delete process.env['FORGE_WORKSPACE']
    } else {
      process.env['FORGE_WORKSPACE'] = previousWorkspace
    }
    for (const root of tmpRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function workspaceDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-workspace-loader-'))
    tmpRoots.push(root)
    writeFileSync(join(root, config.FORGE_YAML_FILENAME), 'name: Test Workspace\n')
    return root
  }

  it('loads an explicit workspace directory that contains guildhall.yaml', () => {
    const root = workspaceDir()

    expect(loadWorkspace(root)).toMatchObject({
      root,
      memoryDir: `${root}/memory`,
      config: { id: 'test-workspace', name: 'Test Workspace' },
    })
    expect(config.resolveConfig).toHaveBeenCalledWith({ workspacePath: root })
  })

  it('rejects explicit paths that are not initialized workspaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-workspace-loader-empty-'))
    tmpRoots.push(root)

    expect(() => loadWorkspace(root)).toThrow(/guildhall.yaml not found/)
  })

  it('resolves explicit, environment, and discovered workspaces in priority order', () => {
    const explicit = workspaceDir()
    const env = workspaceDir()
    const discovered = workspaceDir()

    process.env['FORGE_WORKSPACE'] = env
    vi.mocked(config.findWorkspaceRoot).mockReturnValue(discovered)

    expect(resolveWorkspace(explicit).root).toBe(explicit)
    expect(resolveWorkspace().root).toBe(env)

    delete process.env['FORGE_WORKSPACE']
    expect(resolveWorkspace().root).toBe(discovered)
    expect(config.findWorkspaceRoot).toHaveBeenCalledWith(process.cwd())
  })

  it('explains how to recover when no workspace can be found', () => {
    delete process.env['FORGE_WORKSPACE']
    vi.mocked(config.findWorkspaceRoot).mockReturnValue(null)

    expect(() => resolveWorkspace()).toThrow(/No guildhall.yaml found/)
  })
})
