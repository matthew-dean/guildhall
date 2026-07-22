import { describe, expect, it } from 'vitest'

import {
  ProofPath,
  buildProofPathContext,
  buildTaskProofPath,
  commandResultSatisfiesProofContract,
  ensureCommandProofPathsFromAcceptanceCriteria,
  recordCommandProofPathResults,
  recordProofPath,
} from '../proof-paths.js'

describe('proof paths', () => {
  it('fails a clean command when output does not identify the bounded task', () => {
    const task = {
      proofPaths: [ProofPath.parse({
        id: 'task-world-proof',
        scope: { type: 'task', id: 'task-world-proof' },
        title: 'Run world proof',
        summary: 'The bounded world proof.',
        kind: 'command',
        command: 'pnpm proof:world-object-state',
        status: 'planned',
        expectedEvidence: [{
          id: 'ac-1',
          kind: 'automated',
          description: 'The world proof identifies its task.',
          required: true,
          expectedOutputIncludes: ['guildhall-proof:task-world'],
        }],
        verificationRecords: [],
        launchSteps: [],
        relatedTaskIds: ['task-world-proof'],
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
        createdBy: 'test',
      })],
    }
    const result = {
      gateId: 'ac-1',
      type: 'hard' as const,
      passed: true,
      output: 'World/object-state proof completed.',
      checkedAt: '2026-07-21T00:01:00.000Z',
    }

    expect(commandResultSatisfiesProofContract(task, [{ id: 'ac-1', command: 'pnpm proof:world-object-state' }], result)).toBe(false)
    recordCommandProofPathResults(
      task,
      [{ id: 'ac-1', command: 'pnpm proof:world-object-state' }],
      [result],
      'run-gates',
      'project_checkout',
    )
    expect(task.proofPaths[0]).toMatchObject({
      status: 'blocked',
      verificationRecords: [{ status: 'failed', executionRoot: 'project_checkout' }],
    })
  })

  it('refreshes an existing command path when its acceptance expectation changes', () => {
    const task = {
      id: 'task-negative-fixture',
      acceptanceCriteria: [{
        id: 'ac-missing',
        description: 'Missing files produce a clear error.',
        verifiedBy: 'automated' as const,
        command: 'pnpm exec node scripts/validate-fixture.mjs fixtures/missing',
        expectedExit: 'non_zero' as const,
        met: false,
      }],
      proofPaths: [ProofPath.parse({
        id: 'task-negative-fixture-ac-missing-command-proof',
        scope: { type: 'task', id: 'task-negative-fixture' },
        title: 'Run ac-missing',
        summary: 'Missing files produce a clear error.',
        kind: 'command',
        command: 'pnpm exec node scripts/validate-fixture.mjs fixtures/missing',
        source: 'documented',
        status: 'blocked',
        expectedEvidence: [{
          id: 'ac-3',
          kind: 'automated',
          description: 'The old criterion should disappear.',
          required: true,
        }, {
          id: 'ac-missing',
          kind: 'automated',
          description: 'Missing files produce a clear error.',
          required: true,
        }],
        verificationRecords: [{
          id: 'old-run',
          evidenceId: 'ac-missing',
          kind: 'automated',
          status: 'failed',
          summary: 'Expected exit was wrong.',
          recordedAt: '2026-07-18T00:00:00.000Z',
          recordedBy: 'gate-checker-agent',
          evidenceRefs: [],
        }],
        launchSteps: [],
        relatedTaskIds: ['task-negative-fixture'],
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        createdBy: 'test',
      })],
    } as Parameters<typeof ensureCommandProofPathsFromAcceptanceCriteria>[0]

    task.proofPaths![0]!.title = 'Run ac-3'
    task.proofPaths![0]!.summary = 'The old criterion should disappear.'
    task.proofPaths![0]!.launchSteps = [{
      id: 'old-launch',
      kind: 'copy_command',
      title: 'Run ac-3',
      command: 'pnpm exec node scripts/validate-fixture.mjs fixtures/missing',
      expectedOutcome: 'The old criterion should disappear.',
    }]

    ensureCommandProofPathsFromAcceptanceCriteria(task, '2026-07-18T01:00:00.000Z', 'test')

    expect(task.proofPaths?.[0]).toMatchObject({
      status: 'planned',
      title: 'Run ac-missing',
      summary: 'Missing files produce a clear error.',
      expectedEvidence: [{ id: 'ac-missing', expectedExit: 'non_zero' }],
      launchSteps: [{
        id: 'old-launch',
        title: 'Run ac-missing',
        command: 'pnpm exec node scripts/validate-fixture.mjs fixtures/missing',
        expectedOutcome: 'Missing files produce a clear error.',
      }],
      verificationRecords: [],
      updatedAt: '2026-07-18T01:00:00.000Z',
      updatedBy: 'test',
    })
  })

  it('defines task and project scoped proof paths with explicit launch steps and evidence classes', () => {
    const proofPath = ProofPath.parse({
      id: 'proof-task-link-editor',
      scope: { type: 'task', id: 'task-link-editor' },
      title: 'Verify link editor controls',
      summary: 'Open the editor, edit selected text, and prove the controls hold state.',
      status: 'planned',
      launchSteps: [
        {
          id: 'serve',
          kind: 'copy_command',
          title: 'Start the app',
          command: 'pnpm dev --filter web',
          cwd: 'frontend',
          expectedOutcome: 'The dev server prints a local URL.',
        },
        {
          id: 'open',
          kind: 'open_url',
          title: 'Open editor',
          url: 'http://localhost:5173/editor',
        },
        {
          id: 'dashboard',
          kind: 'external_dashboard',
          title: 'Check deploy preview',
          service: 'Vercel',
          url: 'https://vercel.test/deployments/12',
        },
        {
          id: 'manual',
          kind: 'manual_step',
          title: 'Exercise selected-text editing',
          instructions: 'Select text and confirm the URL/display text controls update the preview.',
        },
        {
          id: 'blocked',
          kind: 'blocked_until_setup',
          title: 'Needs provider token',
          setupRequirement: 'Editor preview token',
          ownerAction: 'Add the token in the provider dashboard.',
        },
      ],
      expectedEvidence: [
        {
          id: 'unit',
          kind: 'automated',
          description: 'Focused editor tests pass.',
          required: true,
          sourceRef: 'pnpm test -- editor',
        },
        {
          id: 'browser',
          kind: 'manual',
          description: 'The toolbar works in the browser.',
          required: true,
        },
        {
          id: 'deploy',
          kind: 'provider',
          description: 'Deploy preview is healthy.',
          required: false,
        },
      ],
      verificationRecords: [
        {
          id: 'unit-run',
          evidenceId: 'unit',
          kind: 'automated',
          status: 'passed',
          summary: 'Editor tests passed.',
          command: 'pnpm test -- editor',
          recordedAt: '2026-05-27T12:00:00.000Z',
          recordedBy: 'worker-agent',
        },
      ],
      createdAt: '2026-05-27T11:50:00.000Z',
      updatedAt: '2026-05-27T12:00:00.000Z',
      createdBy: 'spec-agent',
    })

    expect(proofPath.launchSteps.map((step) => step.kind)).toEqual([
      'copy_command',
      'open_url',
      'external_dashboard',
      'manual_step',
      'blocked_until_setup',
    ])
    expect(proofPath.expectedEvidence.map((evidence) => evidence.kind)).toEqual([
      'automated',
      'manual',
      'provider',
    ])
  })

  it('builds a default task proof path from acceptance criteria without creating executable long-running buttons', () => {
    const proofPath = buildTaskProofPath({
      task: {
        id: 'task-doc-nav',
        title: 'Fix docs navigation snapshots',
        description: 'Docs versions should render navigation.',
        status: 'ready',
        domain: 'docs',
        projectPath: '/repo/guildhall',
        priority: 'normal',
        spec: 'Fix versioned docs nav.',
        acceptanceCriteria: [
          { id: 'ac-1', description: '0.8 docs nav renders.', verifiedBy: 'human', met: false },
          { id: 'ac-2', description: 'Snapshot tests pass.', verifiedBy: 'automated', met: false },
        ],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        escalations: [],
        agentIssues: [],
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: '2026-05-27T11:00:00.000Z',
        updatedAt: '2026-05-27T11:00:00.000Z',
      },
      createdAt: '2026-05-27T11:05:00.000Z',
      createdBy: 'spec-agent',
    })

    expect(proofPath).toMatchObject({
      id: 'task-doc-nav-proof-path',
      scope: { type: 'task', id: 'task-doc-nav' },
      status: 'planned',
      expectedEvidence: [
        expect.objectContaining({ id: 'ac-1', description: '0.8 docs nav renders.' }),
        expect.objectContaining({ id: 'ac-2', description: 'Snapshot tests pass.' }),
      ],
    })
    expect(proofPath.expectedEvidence.map((evidence) => evidence.kind)).toEqual(['manual', 'automated'])
    expect(proofPath.launchSteps.map((step) => step.kind)).not.toContain('run_server')
  })

  it('does not infer evidence kind from criterion ids or descriptions', () => {
    const proofPath = buildTaskProofPath({
      task: {
        id: 'task-prose-independent-proof',
        title: 'Preserve the proof contract',
        description: 'The provider may use any wording.',
        status: 'ready',
        domain: 'core',
        projectPath: '/repo/guildhall',
        priority: 'normal',
        acceptanceCriteria: [{
          id: 'automated-regression-test',
          description: 'A provider called this a test, but the typed verifier is review.',
          verifiedBy: 'review',
          met: false,
        }],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        escalations: [],
        agentIssues: [],
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: '2026-05-27T11:00:00.000Z',
        updatedAt: '2026-05-27T11:00:00.000Z',
      },
    })

    expect(proofPath.expectedEvidence.map((evidence) => evidence.kind)).toEqual(['manual'])
  })

  it('records proof paths as committed user-visible project records', async () => {
    const writes: unknown[] = []
    const proofPath = buildTaskProofPath({
      task: {
        id: 'task-1',
        title: 'Ship it',
        description: 'Ship the thing.',
        status: 'ready',
        domain: 'web',
        projectPath: '/repo/product',
        priority: 'normal',
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        escalations: [],
        agentIssues: [],
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: '2026-05-27T11:00:00.000Z',
        updatedAt: '2026-05-27T11:00:00.000Z',
      },
      createdAt: '2026-05-27T11:01:00.000Z',
      createdBy: 'spec-agent',
    })

    await recordProofPath({
      projectRoot: '/repo/product',
      proofPath,
      persistence: {
        async writeRecord(input) {
          writes.push(input)
          return { payload: input.payload, ref: { path: '/x' } } as never
        },
      },
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      projectRoot: '/repo/product',
      collection: 'proof-paths',
      id: 'task-1-proof-path',
      schemaName: 'proof-path',
      schemaVersion: 1,
      sourceRefs: ['task:task-1'],
      placement: {
        scope: 'shared_project',
        retention: 'active',
        visibility: 'user_visible',
        commitPolicy: 'committed',
      },
    })
  })

  it('renders proof path context that separates planned proof from actual verification', () => {
    const proofPath = ProofPath.parse({
      id: 'project-readiness-proof',
      scope: { type: 'project', id: 'guildhall' },
      title: 'Project readiness',
      summary: 'Prove the project can launch.',
      status: 'in_progress',
      launchSteps: [
        { id: 'copy', kind: 'copy_command', title: 'Start docs', command: 'pnpm docs:dev' },
        { id: 'url', kind: 'open_url', title: 'Open docs', url: 'http://localhost:5173' },
      ],
      expectedEvidence: [
        { id: 'browser-proof', kind: 'manual', description: 'Browser renders the docs nav.', required: true },
      ],
      verificationRecords: [],
      createdAt: '2026-05-27T11:00:00.000Z',
      updatedAt: '2026-05-27T11:00:00.000Z',
      createdBy: 'spec-agent',
    })

    const context = buildProofPathContext([proofPath])

    expect(context).toContain('## Proof Paths')
    expect(context).toContain('Project readiness')
    expect(context).toContain('copy command: pnpm docs:dev')
    expect(context).toContain('manual required: Browser renders the docs nav.')
    expect(context).toContain('No verification records yet')
  })
})
