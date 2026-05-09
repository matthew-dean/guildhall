import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardGate } from '@guildhall/core'
import { reconcileRequestedGatesWithAuthority, runGatesTool } from '../run-gates-tool.js'

vi.mock('../gate-runner.js', () => ({
  runGates: vi.fn(),
}))

const { runGates } = await import('../gate-runner.js')

const gate = (overrides: Partial<HardGate> = {}): HardGate => ({
  id: 'gate',
  label: 'Gate',
  command: 'true',
  timeoutMs: 120_000,
  ...overrides,
})

describe('reconcileRequestedGatesWithAuthority', () => {
  it('uses authoritative task-scoped commands when the request carries stale equivalents', () => {
    const requested = [
      gate({
        id: 'typecheck',
        label: 'TypeScript typecheck',
        command: 'pnpm --filter @knit-app typecheck',
      }),
      gate({
        id: 'build',
        label: 'Build',
        command: 'pnpm --filter @knit-app build',
      }),
      gate({
        id: 'playwright-e2e',
        label: 'Playwright E2E test',
        command: 'pnpm exec playwright test tests/e2e/authoring-flow.spec.ts',
      }),
      gate({
        id: 'lint',
        label: 'Lint',
        command: 'pnpm lint',
      }),
    ]

    const authoritative = [
      'pnpm --dir web typecheck',
      'pnpm --dir web build',
      'pnpm --dir web exec playwright test tests/e2e/authoring-flow.spec.ts',
      'pnpm lint',
    ]

    const out = reconcileRequestedGatesWithAuthority(requested, authoritative)

    expect(out.usedAuthority).toBe(true)
    expect(out.gates).toEqual([
      expect.objectContaining({
        id: 'typecheck',
        command: 'pnpm --dir web typecheck',
      }),
      expect.objectContaining({
        id: 'build',
        command: 'pnpm --dir web build',
      }),
      expect.objectContaining({
        id: 'playwright-e2e',
        command: 'pnpm --dir web exec playwright test tests/e2e/authoring-flow.spec.ts',
      }),
      expect.objectContaining({
        id: 'lint',
        command: 'pnpm lint',
      }),
    ])
  })

  it('passes requested gates through unchanged when no authoritative list exists', () => {
    const requested = [gate({ id: 'typecheck', command: 'pnpm typecheck' })]
    const out = reconcileRequestedGatesWithAuthority(requested, null)
    expect(out.usedAuthority).toBe(false)
    expect(out.gates).toEqual(requested)
  })
})

describe('runGatesTool scoped exceptions', () => {
  beforeEach(() => {
    vi.mocked(runGates).mockReset()
  })

  it('reports scoped unrelated typecheck failures as effective pass', async () => {
    vi.mocked(runGates).mockResolvedValue({
      allPassed: false,
      results: [
        {
          gateId: 'typecheck',
          type: 'hard',
          passed: false,
          checkedAt: '2026-05-05T20:07:42.704Z',
          output: [
            '> web@ typecheck /tmp/project/web',
            "app/composables/use-presence.test.ts(3,23): error TS2305: Module '\"./use-presence\"' has no exported member 'buildPayload'.",
          ].join('\n'),
        },
        {
          gateId: 'test',
          type: 'hard',
          passed: true,
          checkedAt: '2026-05-05T20:07:52.834Z',
          output: 'focused test passed',
        },
      ],
    } as any)

    const result = await runGatesTool.execute(
      {
        cwd: '/tmp/project',
        gates: [
          { id: 'typecheck', label: 'Typecheck', command: 'pnpm --dir web typecheck' },
          { id: 'test', label: 'Test', command: 'cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts' },
        ],
      },
      {
        cwd: '/tmp/project',
        metadata: {
          current_task_project_path: '/tmp/project',
          current_task_likely_target_files: ['web/tests/unit/composables/use-presence.test.ts'],
          current_task_resolved_scope_decisions: [
            'Treat AC13 as scoped to this task changed target for now. Continue the task by relying on the focused unit-test verification and keep any broader unrelated repo-red findings out of scope unless the same file set is touched.',
          ],
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Scoped exception:')
    expect(result.output).toContain('Gates: ALL PASS')
    expect((result.metadata as Record<string, unknown>).effectiveAllPassed).toBe(true)
  })

  it('reports unrelated hard test failures as effective pass when they are outside the task target files', async () => {
    vi.mocked(runGates).mockResolvedValue({
      allPassed: false,
      results: [
        {
          gateId: 'test',
          type: 'hard',
          passed: false,
          checkedAt: '2026-05-08T17:47:25.289Z',
          output: [
            '> web@ test /tmp/project/web',
            'FAIL tests/unit/components/app-shell.render.test.ts > app shell organism rendering > AppTopBar emits drawer event and opens search on workspace pages',
            'FAIL tests/unit/pages/login-callback-index.flow.test.ts > login/callback/index flow > moves login to Google sign-in step from workspace entry',
          ].join('\n'),
        },
      ],
    } as any)

    const result = await runGatesTool.execute(
      {
        cwd: '/tmp/project',
        gates: [
          { id: 'test', label: 'Test', command: 'pnpm -F web test' },
        ],
      },
      {
        cwd: '/tmp/project',
        metadata: {
          current_task_project_path: '/tmp/project',
          current_task_likely_target_files: ['web/app/composables/use-workspace.ts', 'web/app/types/supabase.ts'],
          current_task_resolved_scope_decisions: [],
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Scoped exception:')
    expect(result.output).toContain('Gates: ALL PASS')
    expect((result.metadata as Record<string, unknown>).effectiveAllPassed).toBe(true)
  })
})
