import { describe, expect, it } from 'vitest'

import {
  approveExternalWriteProposal,
  buildExternalTaskExecutionPacket,
  createExternalTaskMirror,
  externalIssueIdentity,
  recordExternalWriteProposal,
  rejectExternalWriteProposal,
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

  it('shapes deterministic execution packets from external issue truth and repo-local context', () => {
    const mirror = createExternalTaskMirror({
      id: 'mirror-lc-201',
      projectPath: '/repo/linkcore',
      externalRef: issueRef({
        childRefs: [
          { provider: 'jira', issueKey: 'LC-203', relationship: 'child' },
          { provider: 'jira', issueKey: 'LC-202', relationship: 'child' },
        ],
        linkedRefs: [
          { provider: 'github_issues', stableId: '88', relationship: 'tracks', url: 'https://github.example/issues/88' },
        ],
      }),
      localTaskId: 'task-lc-201',
      authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment', 'pr_link'] },
      contextRoute: { domain: 'choice-page', handles: ['docs/99-context/TASK_CONTEXT.yaml#LC-201'] },
      contextBudget: { included: 4, summarized: 2, handleOnly: 3, omitted: 1 },
      contextManifest: {
        alwaysIncluded: ['START_HERE.md', 'IMPLEMENTATION_STATE.yaml'],
        summarized: ['WORK_LOG.md#LC-201'],
        handleOnly: ['docs/99-context/FOLDER_CONTEXT.yaml#src/web'],
        omitted: [{ ref: 'jira:comments:older-than-30-days', reason: 'older history outside current route' }],
      },
      evidenceRefs: ['external:jira:LC-201'],
      mirroredBy: 'owner',
      now: shapedAt,
    })

    const packet = buildExternalTaskExecutionPacket(mirror, {
      shapedAt: '2026-06-02T12:05:00.000Z',
      localTask: {
        id: 'task-lc-201',
        title: 'Choice page enrichment metrics',
        status: 'in_progress',
        acceptedOutcome: 'Expose metrics without changing enrichment authority.',
        definitionOfDone: ['Focused metrics test passes', 'No Jira status mutation without approval'],
        blockerState: 'none',
        branchName: 'feature/lc-201-choice-metrics',
        worktreePath: '/repo/linkcore/.worktrees/task-lc-201',
      },
      repoContext: {
        activeBranch: 'feature/lc-201-choice-metrics',
        activeWorktree: '/repo/linkcore/.worktrees/task-lc-201',
        structuralContext: 'choice-page owns enrichment display; api owns enrichment source truth',
        contextHandles: ['docs/99-context/START_HERE.md', 'docs/99-context/TASK_BOARD.yaml#LC-201'],
        policyConstraints: ['do not force-push shared branches', 'propose Jira status changes for owner approval'],
        proofPathRefs: ['proof:metrics-vitest'],
        prRefs: [{ url: 'https://github.example/pulls/44', title: 'LC-201 metrics', state: 'open' }],
        reviewThreadRefs: [{ id: 'thread-1', summary: 'Reviewer requested USER framing evidence.' }],
      },
    })

    expect(packet).toEqual(expect.objectContaining({
      id: 'external-task-packet:mirror-lc-201:7:7',
      shapedAt: '2026-06-02T12:05:00.000Z',
      providerNeutral: true,
      mirrorId: 'mirror-lc-201',
      localTaskId: 'task-lc-201',
      projectPath: '/repo/linkcore',
      readiness: 'ready',
    }))
    expect(packet.externalIssue).toEqual(expect.objectContaining({
      identity: 'jira:acme:LC:100201',
      provider: 'jira',
      issueKey: 'LC-201',
      title: 'Choice page enrichment metrics',
      status: { name: 'In Progress', category: 'in_progress' },
      priority: 'High',
      assignee: { id: 'u-1', label: 'Avery' },
      version: '7',
    }))
    expect(packet.externalIssue.relationships.childRefs.map(ref => ref.issueKey)).toEqual(['LC-202', 'LC-203'])
    expect(packet.localContext).toEqual(expect.objectContaining({
      activeBranch: 'feature/lc-201-choice-metrics',
      activeWorktree: '/repo/linkcore/.worktrees/task-lc-201',
      structuralContext: 'choice-page owns enrichment display; api owns enrichment source truth',
    }))
    expect(packet.localContext.policyConstraints).toEqual([
      'do not force-push shared branches',
      'propose Jira status changes for owner approval',
    ])
    expect(packet.contextManifest).toEqual({
      alwaysIncluded: ['IMPLEMENTATION_STATE.yaml', 'START_HERE.md'],
      summarized: ['WORK_LOG.md#LC-201'],
      handleOnly: ['docs/99-context/FOLDER_CONTEXT.yaml#src/web'],
      omitted: [{ ref: 'jira:comments:older-than-30-days', reason: 'older history outside current route' }],
    })
    expect(packet.authority).toEqual(expect.objectContaining({
      policy: { mode: 'propose_only', allowedWrites: ['comment', 'pr_link'] },
      pendingProposals: [],
    }))
  })

  it('marks execution packets stale or conflicted when external truth changed after shaping', () => {
    const staleMirror = refreshExternalTaskMirror(
      createExternalTaskMirror({
        id: 'mirror-lc-201',
        projectPath: '/repo/linkcore',
        externalRef: issueRef({ version: '7', labels: ['metrics'] }),
        localTaskId: 'task-lc-201',
        authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment'] },
        mirroredBy: 'owner',
        now: shapedAt,
      }),
      {
        latestExternalRef: issueRef({ version: '8', labels: ['metrics', 'ux-copy'] }),
        refreshedBy: 'connector:jira',
        now: '2026-06-02T12:30:00.000Z',
      },
    )

    const stalePacket = buildExternalTaskExecutionPacket(staleMirror, { shapedAt: '2026-06-02T12:31:00.000Z' })

    expect(stalePacket.readiness).toBe('recheck_required')
    expect(stalePacket.syncWarnings).toEqual([
      expect.objectContaining({
        kind: 'stale',
        field: 'labels',
        reason: 'external_changed_after_local_shape',
      }),
    ])

    const conflictedMirror = refreshExternalTaskMirror(staleMirror, {
      latestExternalRef: issueRef({ version: '9', assignee: { id: 'u-2', label: 'Blair' } }),
      refreshedBy: 'connector:jira',
      now: '2026-06-02T12:40:00.000Z',
    })

    const conflictedPacket = buildExternalTaskExecutionPacket(conflictedMirror, { shapedAt: '2026-06-02T12:41:00.000Z' })

    expect(conflictedPacket.readiness).toBe('blocked_by_external_conflict')
    expect(conflictedPacket.syncWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conflict',
        field: 'assignee',
        reason: 'external_authority_changed_completion_or_ownership',
      }),
    ]))
  })

  it('records evidence-backed proposed writes as approval-gated without silently mutating external truth', () => {
    const mirror = createExternalTaskMirror({
      id: 'mirror-lc-201',
      projectPath: '/repo/linkcore',
      externalRef: issueRef({ version: '7', status: { name: 'In Progress', category: 'in_progress' } }),
      localTaskId: 'task-lc-201',
      authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment', 'pr_link', 'status'] },
      mirroredBy: 'owner',
      now: shapedAt,
    })

    const proposed = recordExternalWriteProposal(mirror, {
      id: 'proposal-status-ready',
      field: 'status',
      value: { name: 'Ready for review', category: 'in_progress' },
      reason: 'Local proof passed and PR is open.',
      evidenceRefs: ['proof:pnpm-vitest', 'pr:https://github.example/pulls/44'],
      proposedBy: 'coordinator',
      now: '2026-06-02T13:00:00.000Z',
    })

    expect(proposed.proposedExternalWrites).toEqual([
      expect.objectContaining({
        id: 'proposal-status-ready',
        field: 'status',
        approvalStatus: 'pending_approval',
        evidenceRefs: ['pr:https://github.example/pulls/44', 'proof:pnpm-vitest'],
      }),
    ])
    expect(proposed.externalWriteApprovals).toEqual([
      expect.objectContaining({
        proposalId: 'proposal-status-ready',
        status: 'pending_approval',
        policyDecision: 'requires_explicit_approval',
        reason: 'Local proof passed and PR is open.',
      }),
    ])
    expect(proposed.externalRef.status).toEqual({ name: 'In Progress', category: 'in_progress' })
    expect(proposed.lastExternalVersion).toBe('7')

    const approved = approveExternalWriteProposal(proposed, {
      proposalId: 'proposal-status-ready',
      approvedBy: 'owner',
      evidenceRefs: ['owner:approved-in-thread'],
      now: '2026-06-02T13:05:00.000Z',
    })

    expect(approved.proposedExternalWrites[0]).toEqual(expect.objectContaining({
      approvalStatus: 'approved',
      decidedBy: 'owner',
      decidedAt: '2026-06-02T13:05:00.000Z',
    }))
    expect(approved.syncState).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: 'local_to_external',
        field: 'status',
        status: 'pending',
        reason: 'external_write_approved_waiting_for_connector',
      }),
    ]))
    expect(approved.externalRef.status).toEqual({ name: 'In Progress', category: 'in_progress' })
    expect(approved.lastExternalVersion).toBe('7')
  })

  it('rejects proposed writes that policy disallows or evidence cannot support', () => {
    const mirror = createExternalTaskMirror({
      id: 'mirror-lc-201',
      projectPath: '/repo/linkcore',
      externalRef: issueRef({ version: '7' }),
      localTaskId: 'task-lc-201',
      authorityPolicy: { mode: 'read_only', allowedWrites: ['comment'] },
      mirroredBy: 'owner',
      now: shapedAt,
    })

    const readOnlyRejected = recordExternalWriteProposal(mirror, {
      id: 'proposal-comment',
      field: 'comment',
      value: 'Tests passed.',
      evidenceRefs: ['proof:pnpm-vitest'],
      proposedBy: 'coordinator',
      now: '2026-06-02T13:00:00.000Z',
    })

    expect(readOnlyRejected.proposedExternalWrites).toEqual([
      expect.objectContaining({
        id: 'proposal-comment',
        approvalStatus: 'rejected',
        rejectionReason: 'policy_read_only',
      }),
    ])

    const missingEvidenceRejected = recordExternalWriteProposal({
      ...mirror,
      authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment'] },
    }, {
      id: 'proposal-comment-without-proof',
      field: 'comment',
      value: 'Tests passed.',
      evidenceRefs: [],
      proposedBy: 'coordinator',
      now: '2026-06-02T13:01:00.000Z',
    })

    expect(missingEvidenceRejected.proposedExternalWrites).toEqual([
      expect.objectContaining({
        id: 'proposal-comment-without-proof',
        approvalStatus: 'rejected',
        rejectionReason: 'missing_evidence',
      }),
    ])
  })

  it('records rejection decisions without removing the proposal audit trail', () => {
    const proposed = recordExternalWriteProposal(
      createExternalTaskMirror({
        id: 'mirror-lc-201',
        projectPath: '/repo/linkcore',
        externalRef: issueRef({ version: '7' }),
        localTaskId: 'task-lc-201',
        authorityPolicy: { mode: 'propose_only', allowedWrites: ['comment'] },
        mirroredBy: 'owner',
        now: shapedAt,
      }),
      {
        id: 'proposal-comment',
        field: 'comment',
        value: 'Focused tests passed.',
        evidenceRefs: ['proof:pnpm-vitest'],
        proposedBy: 'coordinator',
        now: '2026-06-02T13:00:00.000Z',
      },
    )

    const rejected = rejectExternalWriteProposal(proposed, {
      proposalId: 'proposal-comment',
      rejectedBy: 'owner',
      reason: 'Comment needs product framing before posting externally.',
      evidenceRefs: ['owner:thread-decision'],
      now: '2026-06-02T13:03:00.000Z',
    })

    expect(rejected.proposedExternalWrites).toEqual([
      expect.objectContaining({
        id: 'proposal-comment',
        approvalStatus: 'rejected',
        decidedBy: 'owner',
        rejectionReason: 'Comment needs product framing before posting externally.',
      }),
    ])
    expect(rejected.externalWriteApprovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        proposalId: 'proposal-comment',
        status: 'rejected',
        decidedBy: 'owner',
        decidedAt: '2026-06-02T13:03:00.000Z',
      }),
    ]))
    expect(rejected.syncState).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: 'local_to_external',
        field: 'comment',
        status: 'manual_required',
        reason: 'external_write_rejected',
      }),
    ]))
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
