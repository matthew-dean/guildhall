import { describe, expect, it } from 'vitest'
import { buildProjectDecisionProjection, reconcileProjectStateObservation, resolveProjectStateClaims } from '../project-decision-projection.js'

describe('project decision projection', () => {
  it('keeps runnable work distinct from release proof debt', () => {
    const decision = buildProjectDecisionProjection({
      projectRevision: 42,
      queueRevision: 17,
      generatedAt: '2026-07-23T12:00:00.000Z',
      start: {
        canStart: true,
        code: 'ready_work',
        focusTaskId: 'task-write-synopsis',
        focusTaskTitle: 'Write synopsis',
        focusKind: 'ready_work',
        message: '"Write synopsis" is ready to run.',
      },
      release: {
        scopeMode: 'named_release',
        release: { id: 'release-1' },
        state: 'blocked',
        blockers: [{ owningTaskId: 'task-proof', code: 'proof_evidence_missing' }],
      },
    })

    expect(decision).toMatchObject({
      projectRevision: 42,
      queueRevision: 17,
      execution: { state: 'runnable', focusTaskId: 'task-write-synopsis' },
      release: { state: 'not_ready', blockerTaskIds: ['task-proof'], proofBlockerTaskIds: ['task-proof'] },
      primaryAction: { kind: 'open_work', targetId: 'task-write-synopsis' },
    })
  })

  it('turns equally authoritative incompatible claims into an explicit conflict', () => {
    const resolved = resolveProjectStateClaims({ projectRevision: 42, claims: [
      {
        id: 'proof-pass',
        projectRevision: 42,
        subject: { kind: 'proof', id: 'task-proof' },
        field: 'proof.status',
        value: { state: 'proven' },
        authority: 'verified_observation',
        actor: 'reviewer-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['verification:pass'],
      },
      {
        id: 'proof-fail',
        projectRevision: 42,
        subject: { kind: 'proof', id: 'task-proof' },
        field: 'proof.status',
        value: { state: 'failed' },
        authority: 'verified_observation',
        actor: 'reviewer-b',
        observedAt: '2026-07-23T12:00:01.000Z',
        evidenceRefs: ['verification:fail'],
      },
    ], policies: [{
      field: 'proof.status',
      authorities: ['verified_observation', 'agent_derivation'],
      reconciliation: 'rerun_verification',
    }] })

    expect(resolved).toEqual([expect.objectContaining({
      subject: { kind: 'proof', id: 'task-proof' },
      field: 'proof.status',
      claimIds: ['proof-fail', 'proof-pass'],
      conflict: expect.objectContaining({ reconciliation: 'rerun_verification' }),
    })])
  })

  it('coalesces equal claims with the same canonical value and preserves their evidence identities', () => {
    const resolved = resolveProjectStateClaims({ projectRevision: 42, claims: [
      {
        id: 'runtime-a',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { status: 'running', workers: ['a', 'b'] },
        authority: 'runtime_observation',
        actor: 'coordinator-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['runtime:a'],
      },
      {
        id: 'runtime-b',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { workers: ['a', 'b'], status: 'running' },
        authority: 'runtime_observation',
        actor: 'coordinator-b',
        observedAt: '2026-07-23T12:00:01.000Z',
        evidenceRefs: ['runtime:b'],
      },
    ], policies: [{
      field: 'runtime.status',
      authorities: ['runtime_observation'],
      reconciliation: 'refresh_runtime',
    }] })

    expect(resolved).toEqual([expect.objectContaining({
      value: { status: 'running', workers: ['a', 'b'] },
      claimIds: ['runtime-a', 'runtime-b'],
    })])
    expect(resolved[0]).not.toHaveProperty('conflict')
  })

  it('makes a lower-authority diagnostic disagreement explicit without letting it replace canonical state', () => {
    const agreement = reconcileProjectStateObservation({
      projectRevision: 42,
      canonicalClaim: {
        id: 'summary-release-blockers',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.blockerTaskIds',
        value: ['task-proof'],
        authority: 'canonical_mutation',
        actor: 'project-summary',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['task:task-proof'],
      },
      observationClaim: {
        id: 'diagnostic-release-blockers',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.blockerTaskIds',
        value: [],
        authority: 'agent_derivation',
        actor: 'diagnostic-projector',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['diagnostic:42'],
      },
      policy: {
        field: 'release.blockerTaskIds',
        authorities: ['canonical_mutation', 'agent_derivation'],
        reconciliation: 'inspect_canonical_state',
      },
    })

    expect(agreement).toEqual({
      state: 'contradictory',
      reconciliation: 'inspect_canonical_state',
      canonicalClaimIds: ['summary-release-blockers'],
      observationClaimId: 'diagnostic-release-blockers',
    })
  })
})
