import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  inputAnswers: [] as string[],
  selectAnswers: [] as string[],
  confirmAnswers: [] as boolean[],
  existingConfig: null as any,
  globalConfig: { models: {} as Record<string, unknown> },
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  bootstrapWorkspace: vi.fn(),
  readWorkspaceConfig: vi.fn(),
  writeWorkspaceConfig: vi.fn(),
  readGlobalConfig: vi.fn(),
  resolveModelsForProvider: vi.fn(),
  updateGlobalConfig: vi.fn(),
  writeModelsForProvider: vi.fn(),
}))

vi.mock('@inquirer/prompts', () => ({
  input: mocks.input,
  select: mocks.select,
  confirm: mocks.confirm,
}))

vi.mock('@guildhall/config', () => ({
  FORGE_YAML_FILENAME: 'guildhall.yaml',
  bootstrapWorkspace: mocks.bootstrapWorkspace,
  slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  readWorkspaceConfig: mocks.readWorkspaceConfig,
  writeWorkspaceConfig: mocks.writeWorkspaceConfig,
  readGlobalConfig: mocks.readGlobalConfig,
  resolveModelsForProvider: mocks.resolveModelsForProvider,
  updateGlobalConfig: mocks.updateGlobalConfig,
  writeGlobalConfig: vi.fn(),
  writeModelsForProvider: mocks.writeModelsForProvider,
}))

const { runInit } = await import('../init.js')

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guildhall-init-'))
  mocks.inputAnswers = []
  mocks.selectAnswers = []
  mocks.confirmAnswers = []
  mocks.existingConfig = null
  mocks.globalConfig = { models: {} }
  mocks.input.mockImplementation(async (options: { default?: string }) => {
    const answer = mocks.inputAnswers.shift()
    return answer === undefined || answer === '__default' ? options.default ?? '' : answer
  })
  mocks.select.mockImplementation(async (options: { default?: string }) => {
    const answer = mocks.selectAnswers.shift()
    return answer === undefined || answer === '__default' ? options.default ?? '' : answer
  })
  mocks.confirm.mockImplementation(async (options: { default?: boolean }) => {
    const answer = mocks.confirmAnswers.shift()
    return answer === undefined ? options.default ?? false : answer
  })
  mocks.bootstrapWorkspace.mockReset()
  mocks.readWorkspaceConfig.mockReset()
  mocks.readWorkspaceConfig.mockImplementation(() => mocks.existingConfig)
  mocks.writeWorkspaceConfig.mockReset()
  mocks.readGlobalConfig.mockReset()
  mocks.readGlobalConfig.mockImplementation(() => mocks.globalConfig)
  mocks.resolveModelsForProvider.mockReset()
  mocks.resolveModelsForProvider.mockImplementation((models: unknown) => models ?? {})
  mocks.updateGlobalConfig.mockReset()
  mocks.writeModelsForProvider.mockReset()
  mocks.writeModelsForProvider.mockImplementation((_current: unknown, _provider: unknown, models: unknown) => models)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('runInit', () => {
  it('bootstraps a new workspace with global model defaults and no coordinators', async () => {
    mocks.inputAnswers = ['Looma + Knit', 'looma-knit', '']
    mocks.selectAnswers = ['global-default']
    mocks.confirmAnswers = [false, false, true]

    await runInit({ targetDir: dir })

    expect(mocks.bootstrapWorkspace).toHaveBeenCalledWith(dir, {
      name: 'Looma + Knit',
    })
    expect(mocks.writeWorkspaceConfig).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        name: 'Looma + Knit',
        id: 'looma-knit',
        coordinators: [],
        maxRevisions: 3,
        heartbeatInterval: 5,
        ignore: ['node_modules', 'dist', '.git', 'coverage'],
        tags: [],
      }),
    )
    expect(mocks.updateGlobalConfig).not.toHaveBeenCalled()
  })

  it('reconfigures an existing workspace with a project path, coordinator, advanced options, and workspace model overrides', async () => {
    writeFileSync(join(dir, 'guildhall.yaml'), 'name: Existing\nid: existing\n', 'utf8')
    mocks.existingConfig = {
      name: 'Existing',
      id: 'existing',
      projectPath: '',
      coordinators: [],
      maxRevisions: 2,
      heartbeatInterval: 4,
      ignore: ['node_modules'],
      tags: ['demo'],
    }
    mocks.inputAnswers = [
      '__default',
      '__default',
      dir,
      'frontend',
      'web',
      'Own frontend quality.',
      '6',
      '9',
    ]
    mocks.selectAnswers = [
      'workspace',
      'mixed',
      'qwen2.5-coder-7b-instruct',
      'qwen2.5-coder-7b-instruct',
      'claude-sonnet-4-6',
    ]
    mocks.confirmAnswers = [true, false, true, true]

    await runInit({ targetDir: dir, reconfigure: true })

    expect(mocks.bootstrapWorkspace).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceConfig).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        name: 'Existing',
        id: 'existing',
        projectPath: dir,
        maxRevisions: 6,
        heartbeatInterval: 9,
        ignore: ['node_modules'],
        tags: ['demo'],
        models: expect.objectContaining({
          worker: 'qwen2.5-coder-7b-instruct',
          reviewer: 'qwen2.5-coder-7b-instruct',
          gateChecker: 'qwen2.5-coder-7b-instruct',
          spec: 'claude-sonnet-4-6',
          coordinator: 'claude-sonnet-4-6',
        }),
        coordinators: [
          expect.objectContaining({
            id: 'frontend',
            domain: 'frontend',
            path: 'web',
            mandate: 'Own frontend quality.',
          }),
        ],
      }),
    )
  })

  it('writes machine-wide model defaults without adding workspace model overrides', async () => {
    mocks.inputAnswers = ['Model Defaults', 'model-defaults', '']
    mocks.selectAnswers = [
      'global',
      'cloud',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ]
    mocks.confirmAnswers = [false, false, true]

    await runInit({ targetDir: dir })

    const writtenConfig = mocks.writeWorkspaceConfig.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenConfig.models).toBeUndefined()
    expect(mocks.updateGlobalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.objectContaining({
          spec: 'claude-sonnet-4-6',
          coordinator: 'claude-sonnet-4-6',
          worker: 'claude-sonnet-4-6',
          reviewer: 'claude-haiku-4-5',
          gateChecker: 'claude-haiku-4-5',
        }),
      }),
    )
  })

  it('aborts cleanly before writing when the final confirmation is declined', async () => {
    mocks.inputAnswers = ['Nope', 'nope', '']
    mocks.selectAnswers = ['global-default']
    mocks.confirmAnswers = [false, false, false]

    await runInit({ targetDir: dir })

    expect(mocks.bootstrapWorkspace).not.toHaveBeenCalled()
    expect(mocks.writeWorkspaceConfig).not.toHaveBeenCalled()
  })
})
