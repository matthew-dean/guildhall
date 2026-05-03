import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveEffectiveTaskSuccessGates,
  resolveEffectiveTaskProjectPath,
} from '../task-gates.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-gates-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('resolveEffectiveTaskProjectPath', () => {
  it('prefers the task project path when provided', () => {
    expect(
      resolveEffectiveTaskProjectPath(
        { projectPath: '/tmp/subproject', acceptanceCriteria: [] as any[] },
        '/tmp/workspace',
      ),
    ).toBe('/tmp/subproject')
  })
})

describe('resolveEffectiveTaskSuccessGates', () => {
  it('uses automated acceptance commands to override broader project defaults', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'tests/unit/pages'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: 'web',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'tests/unit/pages/login-callback-index.flow.test.ts'),
      '// test placeholder\n',
      'utf8',
    )
    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'targeted auth callback flow passes',
            verifiedBy: 'automated',
            command: 'pnpm test --filter @knit-app -- --run login-callback-index.flow.test.ts',
            met: true,
          },
          {
            id: 'ac-2',
            description: 'broader command appears too',
            verifiedBy: 'automated',
            command: 'pnpm test --filter @knit-app -- --run',
            met: true,
          },
          {
            id: 'ac-3',
            description: 'typecheck passes',
            verifiedBy: 'automated',
            command: 'pnpm --filter @knit-app typecheck',
            met: true,
          },
        ],
      } as any,
      workspaceProjectPath: tmpDir,
      workspaceBootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          typecheck: { command: 'pnpm typecheck', available: true },
          build: { command: 'pnpm build', available: true },
          test: { command: 'pnpm test', available: true },
          lint: { command: 'pnpm lint', available: true },
        },
      } as any,
    })

    expect(result).toEqual([
      'pnpm --dir web typecheck',
      'pnpm build',
      'cd web && pnpm vitest --run tests/unit/pages/login-callback-index.flow.test.ts',
      'pnpm lint',
    ])
  })

  it('falls back to bootstrap gates when the task does not define automated commands', () => {
    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: '/workspace',
        acceptanceCriteria: [],
      } as any,
      workspaceProjectPath: '/workspace',
      workspaceBootstrap: {
        commands: [],
        successGates: ['pnpm typecheck', 'pnpm build'],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          typecheck: { command: 'pnpm typecheck', available: true },
          build: { command: 'pnpm build', available: true },
          test: { command: 'pnpm test', available: true },
          lint: { command: 'pnpm lint', available: true },
        },
      } as any,
    })

    expect(result).toEqual(['pnpm typecheck', 'pnpm build'])
  })

  it('drops invalid automated pnpm commands and falls back to project defaults for that category', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        scripts: {
          typecheck: 'tsc --noEmit',
          build: 'vite build',
        },
      }),
      'utf8',
    )
    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'bad test command',
            verifiedBy: 'automated',
            command: 'pnpm --filter @missing test -- --run target.spec.ts',
            met: true,
          },
        ],
      } as any,
      workspaceProjectPath: tmpDir,
      workspaceBootstrap: {
        commands: [],
        successGates: ['pnpm typecheck', 'pnpm build', 'pnpm test'],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          typecheck: { command: 'pnpm typecheck', available: true },
          build: { command: 'pnpm build', available: true },
          test: { command: 'pnpm test', available: true },
          lint: { command: 'pnpm lint', available: true },
        },
      } as any,
    })

    expect(result).toEqual(['pnpm typecheck', 'pnpm build', 'pnpm test'])
  })

  it('infers a task-scoped playwright command from automated acceptance prose when command is missing', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'tests/e2e'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: 'web',
        scripts: {
          build: 'nuxt build',
          typecheck: 'nuxt typecheck',
          'test:e2e': 'playwright test',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'tests/e2e/authoring-flow.spec.ts'),
      '// playwright placeholder\n',
      'utf8',
    )

    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description:
              'Given the new test file exists at knit/web/tests/e2e/authoring-flow.spec.ts, when the Playwright runner runs against this file, then it passes with zero errors and zero console violations.',
            verifiedBy: 'automated',
            met: false,
          },
          {
            id: 'ac-2',
            description: 'Given pnpm typecheck runs in knit/web, then it passes with zero errors related to the new test file.',
            verifiedBy: 'automated',
            met: true,
          },
        ],
      } as any,
      workspaceProjectPath: tmpDir,
      workspaceBootstrap: {
        commands: [],
        successGates: ['pnpm typecheck', 'pnpm build', 'pnpm test', 'pnpm lint'],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          typecheck: { command: 'pnpm typecheck', available: true },
          build: { command: 'pnpm build', available: true },
          test: { command: 'pnpm test', available: true },
          lint: { command: 'pnpm lint', available: true },
        },
      } as any,
    })

    expect(result).toEqual([
      'pnpm --dir web typecheck',
      'pnpm build',
      'pnpm --dir web exec playwright test tests/e2e/authoring-flow.spec.ts',
      'pnpm lint',
    ])
  })
})
