import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveEffectiveTaskBootstrapBlock,
  resolveEffectiveTaskSuccessGates,
  resolveEffectiveTaskVerificationCommands,
  resolveEffectiveTaskProjectPath,
  renderTaskScopedGateInstructions,
  renderTaskScopedVerificationInstructions,
  rewriteWorkspaceCommandsForIsolatedTaskWorktree,
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
        { projectPath: '/tmp/subproject' },
        '/tmp/workspace',
      ),
    ).toBe('/tmp/subproject')
  })
})

describe('resolveEffectiveTaskBootstrapBlock', () => {
  it('rewrites workspace-scoped bootstrap commands relative to a subproject task root', () => {
    const result = resolveEffectiveTaskBootstrapBlock({
      task: {
        projectPath: path.join(tmpDir, 'knit'),
      } as any,
      workspaceProjectPath: tmpDir,
      workspaceBootstrap: {
        commands: ['cd knit && pnpm install'],
        successGates: [
          'cd knit/web && pnpm typecheck',
          'cd knit/web && pnpm build',
          'cd knit && pnpm lint',
        ],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'cd knit && pnpm install', status: 'ok' },
        gates: {
          typecheck: { command: 'cd knit/web && pnpm typecheck', available: true },
          build: { command: 'cd knit/web && pnpm build', available: true },
          test: { command: 'cd knit && pnpm test', available: false },
          lint: { command: 'cd knit && pnpm lint', available: true },
        },
      } as any,
    })

    expect(result).toEqual({
      commands: ['pnpm install'],
      successGates: ['cd web && pnpm typecheck', 'cd web && pnpm build', 'pnpm lint'],
      timeoutMs: 300_000,
    })
  })

  it('uses task-local bootstrap when workspace bootstrap points at a sibling project', async () => {
    const workspaceDir = tmpDir
    const loomaDir = path.join(workspaceDir, 'looma')
    const knitDir = path.join(workspaceDir, 'knit')
    await fs.mkdir(loomaDir, { recursive: true })
    await fs.mkdir(knitDir, { recursive: true })
    await fs.writeFile(path.join(loomaDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
    await fs.writeFile(
      path.join(loomaDir, 'package.json'),
      JSON.stringify({
        name: 'looma',
        scripts: {
          typecheck: 'tsc --noEmit',
          build: 'vite build',
          test: 'vitest',
          lint: 'eslint .',
        },
      }),
      'utf8',
    )

    const result = resolveEffectiveTaskBootstrapBlock({
      task: {
        projectPath: loomaDir,
      } as any,
      workspaceProjectPath: workspaceDir,
      workspaceBootstrap: {
        commands: ['cd knit && pnpm install'],
        successGates: [
          'cd knit/web && pnpm typecheck',
          'cd knit/web && pnpm build',
          'cd knit && pnpm lint',
        ],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'cd knit && pnpm install', status: 'ok' },
      } as any,
    })

    expect(result).toEqual({
      commands: ['pnpm install'],
      successGates: ['pnpm typecheck', 'pnpm build', 'pnpm lint'],
      timeoutMs: 300_000,
    })
  })

  it('uses a first-class workspace project bootstrap when present', async () => {
    const workspaceDir = tmpDir
    const loomaDir = path.join(workspaceDir, 'looma')
    await fs.mkdir(loomaDir, { recursive: true })

    const result = resolveEffectiveTaskBootstrapBlock({
      task: {
        projectPath: loomaDir,
      } as any,
      workspaceProjectPath: workspaceDir,
      workspaceBootstrap: {
        commands: ['cd knit && pnpm install'],
        successGates: ['cd knit/web && pnpm typecheck'],
        timeoutMs: 300_000,
      } as any,
      workspaceProjects: [
        {
          id: 'looma',
          path: loomaDir,
          bootstrap: {
            commands: ['pnpm install'],
            successGates: ['pnpm typecheck', 'pnpm build'],
            timeoutMs: 120_000,
          },
        } as any,
      ],
    })

    expect(result).toEqual({
      commands: ['pnpm install'],
      successGates: ['pnpm typecheck', 'pnpm build'],
      timeoutMs: 120_000,
    })
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

  it('rewrites pnpm test -- <file> vitest commands into direct single-file runs', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'tests/unit/shared'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'tests/unit/shared/subdomain.test.ts'),
      '// test placeholder\n',
      'utf8',
    )

    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'subdomain file passes',
            verifiedBy: 'automated',
            command: 'pnpm --filter @knit-app test -- tests/unit/shared/subdomain.test.ts',
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
      'pnpm typecheck',
      'pnpm build',
      'cd web && pnpm vitest --run tests/unit/shared/subdomain.test.ts',
      'pnpm lint',
    ])
  })

  it('rewrites wildcard vitest targets into concrete file arguments', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'tests/unit/composables'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'tests/unit/composables/use-collections.test.ts'),
      '// primary test placeholder\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'tests/unit/composables/use-collections-auth.test.ts'),
      '// auth test placeholder\n',
      'utf8',
    )

    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'use-collections tests pass',
            verifiedBy: 'automated',
            command: 'pnpm --filter @knit-app test -- tests/unit/composables/use-collections*.test.ts',
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
      'pnpm typecheck',
      'pnpm build',
      'cd web && pnpm vitest --run tests/unit/composables/use-collections-auth.test.ts tests/unit/composables/use-collections.test.ts',
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

  it('drops the broad success test gate for narrow non-test file work', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'app/components'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
          build: 'nuxt build',
          lint: 'oxlint -c .oxlintrc.json --ignore-path .gitignore',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'app/components/VersionHistoryDialog.vue'),
      '<template></template>\n',
      'utf8',
    )

    const result = resolveEffectiveTaskSuccessGates({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [],
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
      likelyTargetFiles: ['web/app/components/VersionHistoryDialog.vue'],
    })

    expect(result).toEqual([
      'pnpm typecheck',
      'pnpm build',
      'pnpm lint',
    ])
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

describe('resolveEffectiveTaskVerificationCommands', () => {
  it('strips the nested project prefix when commands run inside an already-isolated task worktree', async () => {
    const workspaceDir = tmpDir
    const taskProjectPath = path.join(workspaceDir, 'knit')
    const isolatedWorktreePath = path.join(os.tmpdir(), `guildhall-isolated-${Date.now()}`)
    await fs.mkdir(taskProjectPath, { recursive: true })
    await fs.mkdir(isolatedWorktreePath, { recursive: true })

    const result = rewriteWorkspaceCommandsForIsolatedTaskWorktree({
      commands: [
        'cd knit && pnpm install',
        'cd knit/web && pnpm typecheck',
        'pnpm --dir knit/web build',
        'pnpm --dir knit lint',
      ],
      workspaceProjectPath: workspaceDir,
      taskProjectPath,
      activeTaskWorktreeProjectPath: isolatedWorktreePath,
    })

    expect(result).toEqual([
      'pnpm install',
      'cd web && pnpm typecheck',
      'pnpm --dir web build',
      'pnpm lint',
    ])

    await fs.rm(isolatedWorktreePath, { recursive: true, force: true })
  })

  it('scopes nested package verification commands so they run from the isolated worktree root', async () => {
    const frontendDir = path.join(tmpDir, 'frontend')
    await fs.mkdir(frontendDir, { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'fair-labor-license',
        private: true,
        scripts: {
          'deploy:preview': 'wrangler pages deploy',
        },
      }),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
    await fs.writeFile(
      path.join(frontendDir, 'package.json'),
      JSON.stringify({
        name: 'fair-labor-license-frontend',
        private: true,
        scripts: {
          build: 'nuxt build',
        },
      }),
      'utf8',
    )
    await fs.writeFile(path.join(frontendDir, 'tsconfig.json'), '{}\n', 'utf8')

    const result = resolveEffectiveTaskVerificationCommands({
      task: {
        projectPath: frontendDir,
        acceptanceCriteria: [],
      } as any,
      workspaceProjectPath: tmpDir,
      workspaceBootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
      } as any,
    })

    expect(result).toEqual([
      'pnpm --dir frontend exec tsc --noEmit',
      'pnpm --dir frontend build',
    ])
  })

  it('scopes explicit direct-binary acceptance commands through pnpm exec for nested projects', async () => {
    const frontendDir = path.join(tmpDir, 'frontend')
    await fs.mkdir(frontendDir, { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
    await fs.writeFile(
      path.join(frontendDir, 'package.json'),
      JSON.stringify({
        name: 'fair-labor-license-frontend',
        private: true,
        scripts: {
          build: 'nuxt build',
        },
      }),
      'utf8',
    )

    const result = resolveEffectiveTaskVerificationCommands({
      task: {
        projectPath: frontendDir,
        acceptanceCriteria: [
          {
            id: 'ac-typecheck',
            description: 'TypeScript check passes',
            verifiedBy: 'automated',
            command: 'pnpm tsc --noEmit',
          },
        ],
      } as any,
      workspaceProjectPath: tmpDir,
    })

    expect(result).toEqual([
      'pnpm --dir frontend exec tsc --noEmit',
      'pnpm --dir frontend build',
    ])
  })

  it('prefers a focused vitest target for single-file test work instead of the broad test gate', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'tests/unit/composables'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
          build: 'nuxt build',
          lint: 'oxlint -c .oxlintrc.json --ignore-path .gitignore',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'tests/unit/composables/use-presence.test.ts'),
      '// test placeholder\n',
      'utf8',
    )

    const result = resolveEffectiveTaskVerificationCommands({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [],
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
      likelyTargetFiles: ['web/tests/unit/composables/use-presence.test.ts'],
    })

    expect(result).toEqual([
      'pnpm typecheck',
      'pnpm build',
      'cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts',
      'pnpm lint',
    ])
  })

  it('drops the broad test fallback for narrow non-test file work', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'app/composables'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
          build: 'nuxt build',
          lint: 'oxlint -c .oxlintrc.json --ignore-path .gitignore',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(webDir, 'app/composables/use-pages.ts'),
      '// source placeholder\n',
      'utf8',
    )

    const result = resolveEffectiveTaskVerificationCommands({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [],
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
      likelyTargetFiles: ['web/app/composables/use-pages.ts'],
    })

    expect(result).toEqual([
      'pnpm typecheck',
      'pnpm build',
      'pnpm lint',
    ])
  })

  it('prefers focused test commands over broad automated acceptance test commands for narrow file work', async () => {
    const converterDir = path.join(tmpDir, 'packages/converter')
    await fs.mkdir(path.join(converterDir, 'test'), { recursive: true })
    await fs.writeFile(
      path.join(converterDir, 'package.json'),
      JSON.stringify({
        name: '@t-minus-t/converter',
        scripts: {
          test: 'vitest run --reporter=verbose --no-coverage',
          build: 'tsc -p tsconfig.json',
          lint: 'eslint .',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(converterDir, 'test/ts-to-jsdoc.test.ts'),
      '// test placeholder\n',
      'utf8',
    )

    const result = resolveEffectiveTaskVerificationCommands({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'All existing tests pass.',
            verifiedBy: 'automated',
            command: 'vitest run',
          },
        ],
      } as any,
      workspaceProjectPath: tmpDir,
      workspaceBootstrap: {
        commands: [],
        successGates: ['pnpm run build', 'vitest run', 'pnpm run lint'],
        timeoutMs: 300_000,
        verifiedAt: '2026-05-03T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          build: { command: 'pnpm run build', available: true },
          test: { command: 'vitest run', available: true },
          lint: { command: 'pnpm run lint', available: true },
        },
      } as any,
      likelyTargetFiles: ['packages/converter/test/ts-to-jsdoc.test.ts'],
    })

    expect(result).toEqual([
      'pnpm run build',
      'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
      'pnpm run lint',
    ])
  })

  it('rewrites multi-file filtered Vitest acceptance commands to direct --run targets', async () => {
    const webDir = path.join(tmpDir, 'web')
    await fs.mkdir(path.join(webDir, 'tests/unit/composables'), { recursive: true })
    await fs.mkdir(path.join(webDir, 'tests/unit/shared'), { recursive: true })
    await fs.writeFile(
      path.join(webDir, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
          typecheck: 'nuxt typecheck',
          build: 'nuxt build',
        },
      }),
      'utf8',
    )
    await fs.writeFile(path.join(webDir, 'tests/unit/composables/use-collections.test.ts'), '// test\n', 'utf8')
    await fs.writeFile(path.join(webDir, 'tests/unit/composables/use-presence.test.ts'), '// test\n', 'utf8')
    await fs.writeFile(path.join(webDir, 'tests/unit/shared/subdomain.test.ts'), '// test\n', 'utf8')

    const result = resolveEffectiveTaskVerificationCommands({
      task: {
        projectPath: tmpDir,
        acceptanceCriteria: [
          {
            id: 'ac-all',
            description: 'All three focused files pass.',
            verifiedBy: 'automated',
            command:
              'pnpm --filter @knit-app test -- tests/unit/composables/use-collections*.test.ts tests/unit/composables/use-presence.test.ts tests/unit/shared/subdomain.test.ts',
          },
        ],
      } as any,
      workspaceProjectPath: tmpDir,
    })

    expect(result).toContain(
      'cd web && pnpm vitest --run tests/unit/composables/use-collections.test.ts tests/unit/composables/use-presence.test.ts tests/unit/shared/subdomain.test.ts',
    )
  })
})

describe('task-scoped instruction rendering', () => {
  it('renders explicit hard gates with the authoritative task path and command list', () => {
    const rendered = renderTaskScopedGateInstructions({
      projectPath: '/repo/apps/web',
      successGates: ['pnpm typecheck', 'pnpm test -- --run login.spec.ts'],
    })

    expect(rendered).toContain('Run hard gates against `/repo/apps/web`')
    expect(rendered).toContain('- `pnpm typecheck`')
    expect(rendered).toContain('- `pnpm test -- --run login.spec.ts`')
    expect(rendered).toContain('use these commands exactly')
  })

  it('distinguishes missing verification config from an explicitly empty command list', () => {
    const missing = renderTaskScopedVerificationInstructions({
      projectPath: '/repo/apps/web',
      successGates: undefined,
    })
    expect(missing).toContain('No task-scoped verification commands were derived')
    expect(missing).toContain('avoid inventing extra repo-wide gates')

    const empty = renderTaskScopedVerificationInstructions({
      projectPath: '/repo/apps/web',
      successGates: [],
    })
    expect(empty).toContain('No verified shell commands are currently configured')
    expect(empty).toContain('Only run verification that the task itself names explicitly')
  })
})
