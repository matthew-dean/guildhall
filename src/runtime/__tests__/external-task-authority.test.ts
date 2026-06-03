import { describe, expect, it } from 'vitest'

import {
  createExternalTaskMirror,
  externalIssueIdentity,
  refreshExternalTaskMirror,
  updateExternalTaskMirrorLocalStatus,
  type ExternalIssueRef,
} from '../external-task-authority.js'

const shapedAt = '2026-06-02T12:00:00.000Z'

describe('external task authority mirrors', () => {
  it('creates provider-neutral local execution mirrors from external issue refs', () => {
    const jiraRef: ExternalIssueRef = {
      provider: 'jira',
      cloudOrWorkspaceId: 'acme',
      projectKey: 'LC',
      issueKey: 'LC-201',
      stableId: '100201',
      url: 'https://jira.example/browse/LC-201',
      issueType: 'Story',
      title: 'Choice page enrichment metrics',
      status: { name: 'In Progress', category: 'in_progress' },
      priority: 'High',
      sprint: 'Growth 12',
      assignee: { id: 'u-1', label: 'Avery' },
      updatedAt: '2026-06-02T11:30:00.000Z',
      version: '7',
      rawProviderFields: { customfield_123: 'USER framing required' },
    }

    const linearRef: ExternalIssueRef = {
      provider: 'linear',
      cloudOrWorkspaceId: 'acme-linear',
      projectKey: 'Growth',
      issueKey: 'GRO-42',
      stableId: 'lin-42',
      url: 'https://linear.app/acme/issue/GRO-42',
      issueType: 'Feature',
      title: 'Expose enrichment metrics',
      status: { name: 'Started', category: 'in_progress' },
      updatedAt: '2026-06-02T11:40:00.000Z',
      version: '3',
    }

    const jiraMirror = createExternalTaskMirror({
      id: 'mirror-lc-201',
      projectPath: '/repo/linkcore',
      externalRef: jiraRef,
      localTaskId: 'task-lc-201',
      authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment', 'pr_link'] },
      contextRoute: { domain: 'choice-page', handles: ['docs/99-context/TASK_CONTEXT.yaml#LC-29'] },
      contextBudget: { included: 8, summarized: 4, handleOnly: 6, omitted: 2 },
      mirroredBy: 'owner',
      now: shapedAt,
    })

    const linearMirror = createExternalTaskMirror({
      id: 'mirror-gro-42',
      projectPath: '/repo/linkcore',
      externalRef: linearRef,
      localTaskId: 'task-gro-42',
      authorityPolicy: { mode: 'read_only', allowedWrites: [] },
      mirroredBy: 'owner',
      now: shapedAt,
    })

    expect(externalIssueIdentity(jiraRef)).toBe('jira:acme:LC:100201')
    expect(externalIssueIdentity(linearRef)).toBe('linear:acme-linear:Growth:lin-42')
    expect(jiraMirror.mirrorStatus).toBe('mirrored')
    expect(jiraMirror.stateMachine.state).toBe('mirrored')
    expect(jiraMirror.localTaskId).toBe('task-lc-201')
    expect(jiraMirror.lastExternalVersion).toBe('7')
    expect(jiraMirror.sourceSnapshot).toEqual(expect.objectContaining({
      identity: 'jira:acme:LC:100201',
      title: 'Choice page enrichment metrics',
      status: 'In Progress',
      version: '7',
    }))
    expect(jiraMirror.externalRef.rawProviderFields).toEqual({ customfield_123: 'USER framing required' })
    expect(linearMirror.externalRef.provider).toBe('linear')
    expect(linearMirror.authorityPolicy.mode).toBe('read_only')
  })

  it('marks external issue changes as inspectable stale state without claiming a conflict for harmless drift', () => {
    const mirror = createExternalTaskMirror({
      id: 'mirror-lc-201',
      projectPath: '/repo/linkcore',
      externalRef: issueRef({ version: '7', updatedAt: '2026-06-02T11:30:00.000Z' }),
      localTaskId: 'task-lc-201',
      authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment'] },
      mirroredBy: 'owner',
      now: shapedAt,
    })

    const refreshed = refreshExternalTaskMirror(mirror, {
      latestExternalRef: issueRef({
        version: '8',
        updatedAt: '2026-06-02T12:30:00.000Z',
        status: { name: 'In Progress', category: 'in_progress' },
        labels: ['metrics', 'needs-user-framing'],
      }),
      refreshedBy: 'connector:jira',
      now: '2026-06-02T12:31:00.000Z',
    })

    expect(refreshed.mirrorStatus).toBe('stale')
    expect(refreshed.stateMachine.state).toBe('stale')
    expect(refreshed.staleState).toEqual(expect.objectContaining({
      detectedAt: '2026-06-02T12:31:00.000Z',
      externalVersion: '8',
      localVersion: '7',
    }))
    expect(refreshed.staleState?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'labels',
        status: 'stale',
        reason: 'external_changed_after_local_shape',
      }),
    ]))
    expect(refreshed.conflictState).toBeUndefined()
    expect(refreshed.syncState).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'labels',
        direction: 'external_to_local',
        status: 'stale',
        sourceVersion: '8',
        targetVersion: '7',
      }),
    ]))
  })

  it('marks authority-sensitive changes and stale proposed writes as conflicts', () => {
    const mirror = updateExternalTaskMirrorLocalStatus(
      createExternalTaskMirror({
        id: 'mirror-lc-201',
        projectPath: '/repo/linkcore',
        externalRef: issueRef({ version: '7', priority: 'High', assignee: { id: 'u-1', label: 'Avery' } }),
        localTaskId: 'task-lc-201',
        authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment', 'status'] },
        mirroredBy: 'owner',
        now: shapedAt,
      }),
      {
        localStatus: 'done',
        localVersion: 'local-2',
        proposedExternalWrite: {
          field: 'status',
          value: 'Ready for review',
          evidenceRefs: ['proof:pnpm-vitest'],
          proposedAt: '2026-06-02T12:20:00.000Z',
        },
        updatedBy: 'coordinator',
        now: '2026-06-02T12:20:00.000Z',
      },
    )

    const refreshed = refreshExternalTaskMirror(mirror, {
      latestExternalRef: issueRef({
        version: '9',
        updatedAt: '2026-06-02T12:45:00.000Z',
        priority: 'Critical',
        assignee: { id: 'u-2', label: 'Blair' },
        status: { name: 'Blocked', category: 'blocked' },
      }),
      refreshedBy: 'connector:jira',
      now: '2026-06-02T12:46:00.000Z',
    })

    expect(refreshed.mirrorStatus).toBe('conflict')
    expect(refreshed.stateMachine.state).toBe('conflict')
    expect(refreshed.conflictState).toEqual(expect.objectContaining({
      detectedAt: '2026-06-02T12:46:00.000Z',
      reason: 'external_authority_changed_completion_or_ownership',
    }))
    expect(refreshed.conflictState?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'priority', status: 'conflict' }),
      expect.objectContaining({ field: 'assignee', status: 'conflict' }),
      expect.objectContaining({ field: 'status', status: 'conflict', proposedWrite: expect.objectContaining({ field: 'status' }) }),
    ]))
    expect(refreshed.syncState.filter(item => item.status === 'conflict').map(item => item.field)).toEqual(
      expect.arrayContaining(['priority', 'assignee', 'status']),
    )
  })
})

function issueRef(overrides: Partial<ExternalIssueRef> = {}): ExternalIssueRef {
  return {
    provider: 'jira',
    cloudOrWorkspaceId: 'acme',
    projectKey: 'LC',
    issueKey: 'LC-201',
    stableId: '100201',
    url: 'https://jira.example/browse/LC-201',
    issueType: 'Story',
    title: 'Choice page enrichment metrics',
    status: { name: 'In Progress', category: 'in_progress' },
    priority: 'High',
    sprint: 'Growth 12',
    assignee: { id: 'u-1', label: 'Avery' },
    updatedAt: '2026-06-02T11:30:00.000Z',
    version: '7',
    labels: ['metrics'],
    ...overrides,
  }
}
