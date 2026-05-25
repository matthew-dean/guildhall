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
})
