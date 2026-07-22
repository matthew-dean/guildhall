import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { HardGate } from '@guildhall/core'
import { readTaskEvidence } from '@guildhall/sessions'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  readProjectStateDatabaseTask,
  readProjectStateDatabaseTaskEvidenceCurrent,
  readProjectStateDatabaseTaskEvidenceHistory,
  readProjectStateDatabaseQueueRevision,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
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
          current_task_gate_scope_exceptions: [{
            id: 'gate-exception-1',
            gateId: 'typecheck',
            disposition: 'exclude_unrelated_failure',
            createdAt: '2026-07-21T00:00:00.000Z',
            createdBy: 'human',
          }],
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Scoped exception:')
    expect(result.output).toContain('Gates: ALL PASS')
    expect((result.metadata as Record<string, unknown>).effectiveAllPassed).toBe(true)
  })

  it('runs gates in the matching isolated worktree path for nested task projects', async () => {
    vi.mocked(runGates).mockResolvedValue({
      allPassed: true,
      results: [
        {
          gateId: 'build',
          type: 'hard',
          passed: true,
          checkedAt: '2026-05-14T00:00:00.000Z',
          output: 'built',
        },
      ],
    } as any)

    await runGatesTool.execute(
      {
        cwd: '/repo/fair-labor-license',
        gates: [
          { id: 'build', label: 'Build', command: 'pnpm build' },
        ],
      },
      {
        cwd: '/repo/fair-labor-license',
        metadata: {
          current_task_project_path: '/repo/fair-labor-license/frontend',
          current_task_workspace_project_path: '/repo/fair-labor-license',
          current_task_worktree_path: '/tmp/worktrees/fll/task-003',
          current_task_worktree_project_path: '/tmp/worktrees/fll/task-003/frontend',
          current_task_verification_commands: ['pnpm --dir frontend build'],
        },
      },
    )

    expect(runGates).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/worktrees/fll/task-003',
        gates: [
          expect.objectContaining({
            command: 'pnpm --dir frontend build',
          }),
        ],
      }),
    )
  })

  it('persists current task gate results to task state and evidence', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-gates-task-state-'))
    const guildhallDir = path.join(projectRoot, '.guildhall')
    const tasksPath = path.join(guildhallDir, 'TASKS.json')
    await fs.mkdir(guildhallDir, { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-06-03T00:00:00.000Z',
      tasks: [{
        id: 'task-001',
        title: 'Run gates',
        description: 'A task with command evidence.',
        domain: 'test',
        projectPath: projectRoot,
        status: 'gate_check',
        priority: 'normal',
        dependsOn: [],
        outOfScope: [],
        acceptanceCriteria: [],
        notes: [],
        gateResults: [],
        proofPaths: [{
          kind: 'command',
          command: 'pnpm test',
          expectedEvidence: ['runner-smoke'],
          status: 'planned',
          verificationRecords: [],
        }],
        reviewVerdicts: [],
        adjudications: [],
        escalations: [],
        revisionCount: 0,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      }],
    }), 'utf-8')

    vi.mocked(runGates).mockResolvedValue({
      allPassed: true,
      results: [
        {
          gateId: 'test',
          type: 'hard',
          passed: true,
          checkedAt: '2026-06-03T00:01:00.000Z',
          output: 'ok',
        },
      ],
    } as any)

    try {
      const result = await runGatesTool.execute(
        {
          cwd: projectRoot,
          gates: [{ id: 'test', label: 'Test', command: 'pnpm test' }],
        },
        {
          cwd: projectRoot,
          metadata: {
            current_task_id: 'task-001',
            tasks_path: tasksPath,
          },
        },
      )

      expect(result.is_error).toBe(false)
      expect((result.metadata as Record<string, unknown>).persistedTaskGateResults).toBe(true)
      const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
      expect(raw.tasks[0].gateResults).toEqual([
        {
          gateId: 'test',
          type: 'hard',
          passed: true,
          checkedAt: '2026-06-03T00:01:00.000Z',
          output: 'ok',
        },
      ])
      expect(raw.tasks[0].proofPaths[0]).toMatchObject({ id: 'command-proof-path', status: 'verified', updatedBy: 'run-gates' })
      expect(raw.tasks[0].proofPaths[0].verificationRecords).toEqual([
        expect.objectContaining({ evidenceId: 'command-proof-path-evidence-0', status: 'passed', command: 'pnpm test' }),
      ])
      const evidence = await readTaskEvidence(projectRoot, 'task-001', { kind: 'gate_result' })
      expect(evidence.map((event) => event.payload)).toEqual([
        {
          gateId: 'test',
          type: 'hard',
          passed: true,
          checkedAt: '2026-06-03T00:01:00.000Z',
          output: 'ok',
        },
      ])
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('stores promoted gate proof as current evidence without gateResults in task detail', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-gates-promoted-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, '{}', 'utf8')
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: '2026-06-03T00:00:00.000Z',
        tasks: [{
          id: 'task-001',
          title: 'Run gates',
          status: 'gate_check',
          projectPath: projectRoot,
          proofPaths: [{
            kind: 'command',
            command: 'pnpm test',
            expectedEvidence: ['gate output'],
            status: 'planned',
            verificationRecords: [],
          }],
          createdAt: '2026-06-03T00:00:00.000Z',
          updatedAt: '2026-06-03T00:00:00.000Z',
        }],
      },
      summary: {
        generatedAt: '2026-06-03T00:00:00.000Z',
        freshness: 'current',
        counts: { total: 1 },
        releaseSummary: { release: null },
      },
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    vi.mocked(runGates).mockResolvedValue({
      allPassed: true,
      results: [{ gateId: 'test', type: 'hard', passed: true, checkedAt: '2026-06-03T00:01:00.000Z', output: 'ok' }],
    } as any)

    try {
      const before = readProjectStateDatabaseQueueRevision(tasksPath)
      const result = await runGatesTool.execute(
        { cwd: projectRoot, gates: [{ id: 'test', label: 'Test', command: 'pnpm test' }] },
        { cwd: projectRoot, metadata: { current_task_id: 'task-001', tasks_path: tasksPath } },
      )

      expect(result.is_error).toBe(false)
      expect((result.metadata as Record<string, unknown>).persistedTaskGateResults).toBe(true)
      expect(readProjectStateDatabaseQueueRevision(tasksPath)).toBeGreaterThan(before!)
      expect(readProjectStateDatabaseTask(tasksPath, 'task-001')?.definition).toMatchObject({
        proofPaths: [expect.objectContaining({ status: 'verified', updatedBy: 'run-gates' })],
      })
      expect(readProjectStateDatabaseTask(tasksPath, 'task-001')?.definition).not.toHaveProperty('gateResults')
      expect(readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-001')).toMatchObject({
        byKind: { gate_result: [expect.objectContaining({ payload: expect.objectContaining({ gateId: 'test', passed: true }) })] },
      })
      expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-001', 'gate_result')).toHaveLength(1)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
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
          current_task_gate_scope_exceptions: [],
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Scoped exception:')
    expect(result.output).toContain('Gates: ALL PASS')
    expect((result.metadata as Record<string, unknown>).effectiveAllPassed).toBe(true)
  })
})
