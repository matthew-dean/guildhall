import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { buildEffectiveTask, legacyEvidenceFromTask, legacyRuntimeFromTask, legacyWorkspaceFromTask, stripLegacyRuntimeFields } from '../effective-task.js'
import { appendTaskEvidence, upsertTaskRuntimeState, upsertTaskWorkspaceState } from '../task-state-store.js'

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
    expect(effective.notes).toEqual([{ content: 'New evidence store note.' }])
    expect(effective.worktreePath).toBe('/Users/matthew/.guildhall/worktrees/fair-labor-license/task-auth-complete')
    expect(effective.branchName).toBe('guildhall/task-task-auth-complete-v2')
    expect(effective.assignedTo).toBe('reviewer-agent')
    expect(effective.revisionCount).toBe(8)
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
})
