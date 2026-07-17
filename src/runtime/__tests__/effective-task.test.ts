import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Task } from '@guildhall/core'
import { buildEffectiveTask, effectiveTaskStatus, legacyEvidenceFromTask, legacyRuntimeFromTask, legacyWorkspaceFromTask, stripLegacyRuntimeFields } from '../effective-task.js'
import { appendTaskEvidence, taskEvidencePath, upsertTaskRuntimeState, upsertTaskWorkspaceState } from '../task-state-store.js'
import { promoteProjectStateDatabaseAuthority, projectStateDatabasePath } from '@guildhall/sessions'

function legacyTask(overrides: Partial<Task> = {}): Task {
  const now = '2026-05-24T20:00:00.000Z'
  return {
    id: 'task-auth-complete',
    title: 'Complete auth',
    description: 'Finish the auth flow',
    domain: 'frontend',
    projectPath: 'frontend/',
    status: 'ready',
    priority: 'normal',
    spec: 'Build auth callback behavior.',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    assignedTo: null,
    notes: [{
      agentId: 'worker-agent',
      role: 'worker',
      content: 'Implemented callback handling.',
      timestamp: now,
    }],
    gateResults: [],
    reviewVerdicts: [{
      verdict: 'approve',
      reviewerPath: 'llm',
      reason: 'The TypeScript Engineer approved',
      reasoning: 'Looks type-safe.',
      failingSignals: [],
      recordedAt: now,
    }],
    adjudications: [],
    escalations: [{
      id: 'esc-task-auth-complete-1',
      taskId: 'task-auth-complete',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'Need verification evidence.',
      raisedAt: now,
    }],
    agentIssues: [],
    revisionCount: 6,
    retryWindow: {
      startedAt: now,
      baseRevisionCount: 6,
    },
    remediationAttempts: 1,
    worktreePath: '~/.guildhall/worktrees/fair-labor-license/task-auth-complete',
    branchName: 'guildhall/task-task-auth-complete',
    baseBranch: 'main',
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('effective task projection', () => {
  it('extracts runtime and workspace state from legacy task fields', () => {
    const task = legacyTask()

    expect(legacyRuntimeFromTask(task)).toMatchObject({
      taskId: 'task-auth-complete',
      assignedTo: null,
      revisionCount: 6,
      remediationAttempts: 1,
      openEscalationIds: ['esc-task-auth-complete-1'],
    })
    expect(legacyWorkspaceFromTask(task)).toMatchObject({
      taskId: 'task-auth-complete',
      worktreePath: '~/.guildhall/worktrees/fair-labor-license/task-auth-complete',
      branchName: 'guildhall/task-task-auth-complete',
      baseBranch: 'main',
    })
  })

  it('extracts evidence records from legacy task arrays', () => {
    const evidence = legacyEvidenceFromTask(legacyTask())
    expect(evidence.map((event) => event.kind)).toEqual(['note', 'review_verdict', 'escalation'])
    expect(evidence[0]?.payload).toMatchObject({
      content: 'Implemented callback handling.',
    })
  })

  it('strips legacy runtime and evidence fields from task definitions', () => {
    const stripped = stripLegacyRuntimeFields(legacyTask())

    expect(stripped).not.toHaveProperty('notes')
    expect(stripped).not.toHaveProperty('reviewVerdicts')
    expect(stripped).not.toHaveProperty('escalations')
    expect(stripped).not.toHaveProperty('worktreePath')
    expect(stripped).not.toHaveProperty('branchName')
    expect(stripped).not.toHaveProperty('revisionCount')
    expect(stripped).not.toHaveProperty('shelveReason')
    expect(stripped).not.toHaveProperty('proofRecovery')
    expect(stripped).toMatchObject({
      id: 'task-auth-complete',
      title: 'Complete auth',
      projectPath: 'frontend/',
    })
  })

  it('lets system-local state win over legacy fields when building effective task', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))
    await upsertTaskRuntimeState(projectRoot, 'task-auth-complete', {
      assignedTo: 'reviewer-agent',
      revisionCount: 8,
      updatedAt: '2026-05-24T21:00:00.000Z',
    })
    await upsertTaskWorkspaceState(projectRoot, 'task-auth-complete', {
      worktreePath: '/Users/matthew/.guildhall/worktrees/fair-labor-license/task-auth-complete',
      branchName: 'guildhall/task-task-auth-complete-v2',
      baseBranch: 'main',
      updatedAt: '2026-05-24T21:00:00.000Z',
    })
    await appendTaskEvidence(projectRoot, 'task-auth-complete', {
      id: 'note-new',
      kind: 'note',
      recordedAt: '2026-05-24T21:00:00.000Z',
      payload: { content: 'New evidence store note.' },
    })

    const effective = await buildEffectiveTask(projectRoot, legacyTask())

    expect(effective.runtime).toMatchObject({
      assignedTo: 'reviewer-agent',
      revisionCount: 8,
    })
    expect(effective.workspace).toMatchObject({
      branchName: 'guildhall/task-task-auth-complete-v2',
    })
    expect(effective.evidence.map((event) => event.id)).toEqual(['note-new'])
    expect(effective.notes).toEqual([expect.objectContaining({ content: 'New evidence store note.' })])
    expect(effective.worktreePath).toBe('/Users/matthew/.guildhall/worktrees/fair-labor-license/task-auth-complete')
    expect(effective.branchName).toBe('guildhall/task-task-auth-complete-v2')
    expect(effective.assignedTo).toBe('reviewer-agent')
    expect(effective.revisionCount).toBe(8)
  })

  it('does not resurrect legacy task overlays after the database boundary', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-authority-'))
    await upsertTaskRuntimeState(projectRoot, 'task-auth-complete', {
      assignedTo: 'database-worker',
      updatedAt: '2026-05-24T21:00:00.000Z',
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      assignedTo: 'stale-task-field',
      worktreePath: '/stale/task/worktree',
      branchName: 'stale-task-branch',
    }))

    expect(effective.assignedTo).toBe('database-worker')
    expect(effective.worktreePath).toBeUndefined()
    expect(effective.branchName).toBeUndefined()
  })

  it('accepts a valid promoted project with empty normalized overlays', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-empty-overlay-'))
    try {
      promoteProjectStateDatabaseAuthority(projectRoot)

      const effective = await buildEffectiveTask(projectRoot, legacyTask())

      expect(effective.runtime).toBeUndefined()
      expect(effective.workspace).toBeUndefined()
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when a promoted normalized overlay table is missing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-missing-overlay-'))
    try {
      promoteProjectStateDatabaseAuthority(projectRoot)
      const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
      database.exec('DROP TABLE task_execution')
      database.close()

      await expect(buildEffectiveTask(projectRoot, legacyTask()))
        .rejects.toThrow(/Normalized task state is unavailable/)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when a promoted normalized current-evidence table is missing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-missing-current-evidence-'))
    try {
      promoteProjectStateDatabaseAuthority(projectRoot)
      const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
      database.exec('DROP TABLE task_evidence_current')
      database.close()

      await expect(buildEffectiveTask(projectRoot, legacyTask()))
        .rejects.toThrow(/Normalized task state is unavailable/)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when a promoted normalized overlay payload is malformed', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-malformed-overlay-'))
    try {
      promoteProjectStateDatabaseAuthority(projectRoot)
      await upsertTaskRuntimeState(projectRoot, 'task-auth-complete', {
        assignedTo: 'worker-agent',
        updatedAt: '2026-07-15T00:00:00.000Z',
      })
      const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
      database.prepare('UPDATE task_execution SET payload_json = ? WHERE task_id = ?')
        .run('{malformed', 'task-auth-complete')
      database.close()

      await expect(buildEffectiveTask(projectRoot, legacyTask()))
        .rejects.toThrow(/Corrupt normalized runtime overlay/)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('can build current task state without reopening historical evidence files', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-current-'))
    await appendTaskEvidence(projectRoot, 'task-auth-complete', {
      id: 'note-current',
      kind: 'note',
      recordedAt: '2026-05-24T21:00:00.000Z',
      payload: { content: 'Current projection note.' },
    })
    await appendTaskEvidence(projectRoot, 'task-auth-complete', {
      id: 'gate-current',
      kind: 'gate_result',
      recordedAt: '2026-05-24T21:01:00.000Z',
      payload: {
        gateId: 'build',
        type: 'hard',
        passed: true,
        checkedAt: '2026-05-24T21:01:00.000Z',
      },
    })
    await fs.rm(path.dirname(taskEvidencePath(projectRoot, 'task-auth-complete', 'note')), { recursive: true, force: true })
    promoteProjectStateDatabaseAuthority(projectRoot)

    const effective = await buildEffectiveTask(projectRoot, legacyTask(), { evidence: 'current' })

    expect(effective.evidence.map(event => event.kind)).toEqual(['note', 'gate_result'])
    expect(effective.notes).toEqual([expect.objectContaining({ content: 'Current projection note.' })])
    expect(effective.gateResults).toEqual([{
      gateId: 'build',
      type: 'hard',
      passed: true,
      checkedAt: '2026-05-24T21:01:00.000Z',
    }])
  })

  it('uses bounded current evidence by default after the database boundary', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-current-default-'))
    promoteProjectStateDatabaseAuthority(projectRoot)
    await appendTaskEvidence(projectRoot, 'task-auth-complete', {
      id: 'note-old',
      kind: 'note',
      recordedAt: '2026-05-24T21:00:00.000Z',
      payload: { content: 'Older operational note.' },
    })
    await appendTaskEvidence(projectRoot, 'task-auth-complete', {
      id: 'note-new',
      kind: 'note',
      recordedAt: '2026-05-24T21:01:00.000Z',
      payload: { content: 'Latest operational note.' },
    })

    const current = await buildEffectiveTask(projectRoot, legacyTask())
    const historical = await buildEffectiveTask(projectRoot, legacyTask(), { evidence: 'full' })

    expect(current.notes).toEqual([expect.objectContaining({ content: 'Latest operational note.' })])
    expect(historical.notes).toEqual([
      expect.objectContaining({ content: 'Older operational note.' }),
      expect.objectContaining({ content: 'Latest operational note.' }),
    ])
  })

  it('repairs older Guildhall bootstrap verification ellipses in effective evidence', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))
    await appendTaskEvidence(projectRoot, 'task-auth-complete', {
      id: 'note-bootstrap-truncated',
      kind: 'note',
      recordedAt: '2026-07-06T21:31:31.829Z',
      payload: {
        agentId: 'coordinator',
        role: 'bootstrap-verification',
        content:
          'worktree bootstrap failed on gate `pnpm build` (exit 1). The task worktree already has edits, so Guildhall is handing the failing verification back to the worker instead of blocking setup.\n' +
          'Verification output:\nstack line\n...',
        timestamp: '2026-07-06T21:31:31.829Z',
      },
    })

    const effective = await buildEffectiveTask(projectRoot, legacyTask())

    expect(effective.notes).toHaveLength(1)
    expect(effective.notes[0]?.content).toContain('full output is unavailable')
    expect(effective.notes[0]?.content).not.toContain('\n...')
    expect(String(effective.evidence[0]?.payload.content)).toContain('full output is unavailable')
    expect(String(effective.evidence[0]?.payload.content)).not.toContain('\n...')
  })

  it('recovers a clipped imported title before exposing the effective task', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      id: 'task-import-1v8sume',
      title: 'Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the',
      description: 'looma/PROJECT_STATE.md: 3. Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the primitive normalization wave continues in Knit.',
    }))

    expect(effective.title).toBe('Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the primitive normalization wave continues in Knit.')
  })

  it('treats durable completion evidence as done when stored status drifted active', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      status: 'ready',
      assignedTo: 'worker-agent',
      completedAt: '2026-07-04T09:16:20.780Z',
      doneSummaryBundle: {
        taskId: 'task-auth-complete',
        status: 'done',
        completedAt: '2026-07-04T09:16:20.780Z',
        summary: {
          journey: 'worker completed the task',
          decision: 'Task finished as done.',
          evidence: 'npm build passed.',
          learningCandidates: [],
          openResidue: 'No open residue recorded.',
        },
      },
      mergeRecord: {
        result: 'merged',
        mergedAt: '2026-07-04T09:18:47.938Z',
        fromBranch: 'guildhall/task-task-auth-complete',
        toBranch: 'main',
      },
    } as Partial<Task>))

    expect(effective.status).toBe('done')
    expect(effective.assignedTo).toBeNull()
    expect(effective.completedAt).toBe('2026-07-04T09:16:20.780Z')
  })

  it('uses one current-status rule when completion proof settles or fails to settle a block', () => {
    const settled = {
      id: 'task-settled-block',
      status: 'blocked',
      escalations: [{ id: 'esc-1', reason: 'human_judgment_required', raisedAt: '2026-07-01T10:00:00.000Z' }],
      evidence: [{
        id: 'gate-1',
        taskId: 'task-settled-block',
        kind: 'gate_result',
        recordedAt: '2026-07-02T10:00:00.000Z',
        payload: { gateId: 'build', passed: true, checkedAt: '2026-07-02T10:00:00.000Z' },
      }],
    }
    const reopened = {
      ...settled,
      escalations: [{ id: 'esc-2', reason: 'human_judgment_required', raisedAt: '2026-07-03T10:00:00.000Z' }],
    }

    expect(effectiveTaskStatus(settled)).toBe('done')
    expect(effectiveTaskStatus(reopened)).toBe('blocked')
  })

  it('does not treat a merge record alone as completed proof for a ready task', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      status: 'ready',
      assignedTo: 'worker-agent',
      completedAt: '2026-07-04T09:16:20.780Z',
      reviewVerdicts: [],
      gateResults: [{
        gateId: 'gate-1',
        type: 'hard',
        passed: true,
        output: 'pnpm typecheck passed',
        checkedAt: '2026-07-04T09:17:00.000Z',
      }],
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'Mobile smoke proof is reviewed.',
        verifiedBy: 'review',
        met: false,
      }],
      mergeRecord: {
        result: 'merged',
        mergedAt: '2026-07-04T09:18:47.938Z',
        fromBranch: 'guildhall/task-task-auth-complete',
        toBranch: 'main',
      },
    } as Partial<Task>))

    expect(effective.status).toBe('ready')
    expect(effective.assignedTo).toBe('worker-agent')
    expect(effective.completedAt).toBe('2026-07-04T09:16:20.780Z')
  })

  it('does not resurrect archived tasks from older durable completion evidence', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      status: 'archived',
      releaseIds: [],
      completedAt: '2026-07-04T09:16:20.780Z',
      doneSummaryBundle: {
        taskId: 'task-auth-complete',
        status: 'done',
        completedAt: '2026-07-04T09:16:20.780Z',
        summary: {
          journey: 'worker completed the task',
          decision: 'Task finished as done.',
          evidence: 'npm build passed.',
          learningCandidates: [],
          openResidue: 'No open residue recorded.',
        },
      },
    } as Partial<Task>))

    expect(effective.status).toBe('archived')
    expect(effective.releaseIds).toEqual([])
  })

  it('projects statusless proof paths on completed tasks as verified when evidence satisfies them', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      status: 'done',
      acceptanceCriteria: [{ id: 'ac-1', description: 'Chapter draft exists.', verifiedBy: 'review', met: true }],
      proofPaths: [{
        title: 'Chapter draft proof',
        expectedEvidence: ['chapter draft exists'],
      }],
      doneSummaryBundle: {
        taskId: 'task-auth-complete',
        status: 'done',
        completedAt: '2026-07-04T09:16:20.780Z',
        summary: {
          journey: 'worker completed the task',
          decision: 'Task finished as done.',
          evidence: 'Chapter draft exists and was reviewed.',
          learningCandidates: [],
          openResidue: 'No open residue recorded.',
        },
      },
    } as Partial<Task>))

    expect(effective.proofPaths?.[0]).toMatchObject({
      title: 'Chapter draft proof',
      status: 'verified',
    })
  })

  it('projects statusless proof paths on completed tasks as blocked when evidence is still missing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-task-'))

    const effective = await buildEffectiveTask(projectRoot, legacyTask({
      status: 'done',
      proofPaths: [{
        title: 'Provider proof',
        expectedEvidence: ['deepinfra latency and model choice recorded'],
      }],
      doneSummaryBundle: {
        taskId: 'task-auth-complete',
        status: 'done',
        completedAt: '2026-07-04T09:16:20.780Z',
        summary: {
          journey: 'worker completed the task',
          decision: 'Task finished as done.',
          evidence: 'Chapter draft exists.',
          learningCandidates: [],
          openResidue: 'No open residue recorded.',
        },
      },
    } as Partial<Task>))

    expect(effective.proofPaths?.[0]).toMatchObject({
      title: 'Provider proof',
      status: 'blocked',
    })
  })
})
