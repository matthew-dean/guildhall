import { describe, expect, it } from 'vitest'
import {
  applyRuntimeExecutionToProjectDecision,
  buildProjectDecisionProjection,
  projectDecisionInFlight,
  reconcileRegisteredProjectStateObservation,
  resolveRegisteredProjectStateClaimSet,
  reconcileProjectStateObservation,
  resolveProjectStateClaimSet,
  resolveProjectStateClaims,
} from '../project-decision-projection.js'

describe('project decision projection', () => {
  it('does not present a stale blocked plan focus as live work between workers', () => {
    const decision = buildProjectDecisionProjection({
      projectRevision: 42,
      generatedAt: '2026-07-23T12:00:00.000Z',
      start: {
        canStart: false,
        code: 'no_unattended_progress',
        focusTaskId: 'task-blocked',
        focusTaskTitle: 'Blocked plan task',
        focusKind: 'blocked_work',
        message: 'Blocked plan task needs recovery.',
      },
      release: { scopeMode: 'named_release', release: { id: 'release-1' }, state: 'blocked', blockers: [] },
      runStatus: 'running',
    })

    expect(decision).toMatchObject({
      execution: {
        state: 'running',
        message: 'Guildhall is advancing the selected work.',
      },
      primaryAction: { kind: 'open_work', reasonCode: 'running' },
    })
    expect(decision.execution).not.toHaveProperty('focusTaskId')
  })

  it('uses the supervisor runtime task as the sole live execution focus', () => {
    const saved = buildProjectDecisionProjection({
      projectRevision: 42,
      generatedAt: '2026-07-23T12:00:00.000Z',
      start: {
        canStart: true,
        code: 'ready_work',
        focusTaskId: 'task-next',
        focusTaskTitle: 'Planned next task',
        focusKind: 'ready_work',
        message: 'Planned next task is ready.',
      },
      release: { scopeMode: 'named_release', release: { id: 'release-1' }, state: 'blocked', blockers: [] },
    })

    expect(applyRuntimeExecutionToProjectDecision(saved, {
      status: 'running',
      activeTaskId: 'task-live',
      activeTaskTitle: 'Live proof worker',
    })).toMatchObject({
      execution: {
        state: 'running',
        focusTaskId: 'task-live',
        focusTaskTitle: 'Live proof worker',
        focusKind: 'active_work',
      },
      primaryAction: { kind: 'open_work', targetId: 'task-live', reasonCode: 'running' },
    })
  })

  it('restores the retained plan execution after a supervisor stops', () => {
    const planned = buildProjectDecisionProjection({
      projectRevision: 42,
      generatedAt: '2026-07-23T12:00:00.000Z',
      start: {
        canStart: true,
        code: 'ready_work',
        focusTaskId: 'task-next',
        focusTaskTitle: 'Planned next task',
        focusKind: 'ready_work',
        message: 'Planned next task is ready.',
      },
      release: { scopeMode: 'named_release', release: { id: 'release-1' }, state: 'blocked', blockers: [] },
    })
    const running = applyRuntimeExecutionToProjectDecision(planned, {
      status: 'running',
      activeTaskId: 'task-live',
      activeTaskTitle: 'Live proof worker',
    })

    expect(applyRuntimeExecutionToProjectDecision(running, { status: 'stopped' })).toMatchObject({
      planExecution: {
        state: 'runnable',
        code: 'ready_work',
        focusTaskId: 'task-next',
      },
      execution: {
        state: 'runnable',
        code: 'ready_work',
        focusTaskId: 'task-next',
      },
      primaryAction: { kind: 'open_work', targetId: 'task-next', reasonCode: 'ready_work' },
    })
  })

  it('resolves any registered agent fact through one closed field policy', () => {
    const claims = [
      {
        id: 'reviewer-a:criterion-voice',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-chapter' },
        field: 'task.reviewCriterionDisposition',
        value: { criterionId: 'criterion-voice', disposition: 'satisfied' },
        authority: 'agent_derivation' as const,
        actor: 'reviewer-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['review:reviewer-a'],
      },
      {
        id: 'reviewer-b:criterion-voice',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-chapter' },
        field: 'task.reviewCriterionDisposition',
        value: { criterionId: 'criterion-voice', disposition: 'unsatisfied' },
        authority: 'agent_derivation' as const,
        actor: 'reviewer-b',
        observedAt: '2026-07-23T12:00:01.000Z',
        evidenceRefs: ['review:reviewer-b'],
      },
      {
        id: 'agent-made-up-action',
        projectRevision: 42,
        subject: { kind: 'project', id: 'project' },
        field: 'project.primaryAction',
        value: { kind: 'resume' },
        authority: 'agent_derivation' as const,
        actor: 'reviewer-c',
        observedAt: '2026-07-23T12:00:02.000Z',
        evidenceRefs: ['review:reviewer-c'],
      },
    ]

    const resolution = resolveRegisteredProjectStateClaimSet({ projectRevision: 42, claims })

    expect(resolution.resolved).toEqual([expect.objectContaining({
      subject: { kind: 'task', id: 'task-chapter' },
      field: 'task.reviewCriterionDisposition',
      conflict: expect.objectContaining({ reconciliation: 'inspect_canonical_state' }),
    })])
    expect(resolution.disagreements).toEqual([expect.objectContaining({
      state: 'unresolved',
      contradictoryClaimIds: ['reviewer-a:criterion-voice', 'reviewer-b:criterion-voice'],
    })])
    expect(resolution.rejected).toEqual([{ claimId: 'agent-made-up-action', code: 'unregistered_field' }])
  })

  it('resolves canonical release membership over a contradictory agent-derived observation', () => {
    const resolution = resolveRegisteredProjectStateClaimSet({ projectRevision: 42, claims: [
      {
        id: 'canonical-release-membership',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.membershipTaskIds',
        value: ['task-outline', 'task-synopsis'],
        authority: 'canonical_mutation',
        actor: 'release-membership-store',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['release:release-1'],
      },
      {
        id: 'agent-derived-release-membership',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.membershipTaskIds',
        value: ['task-synopsis', 'task-chapter'],
        authority: 'agent_derivation',
        actor: 'scope-agent',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['agent-run:scope-agent'],
      },
    ] })

    expect(resolution).toEqual({
      resolved: [expect.objectContaining({
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.membershipTaskIds',
        value: ['task-outline', 'task-synopsis'],
        claimIds: ['canonical-release-membership'],
      })],
      rejected: [],
      disagreements: [expect.objectContaining({
        canonicalClaimIds: ['canonical-release-membership'],
        contradictoryClaimIds: ['agent-derived-release-membership'],
        state: 'resolved_by_authority',
        reconciliation: 'inspect_canonical_state',
      })],
    })
  })

  it('keeps a coordinator execution report visible when canonical eligibility disagrees', () => {
    const resolution = resolveRegisteredProjectStateClaimSet({ projectRevision: 42, claims: [
      {
        id: 'canonical-execution-eligibility',
        projectRevision: 42,
        subject: { kind: 'project', id: 'project' },
        field: 'project.executionEligibility',
        value: { state: 'owner_review', taskIds: ['task-spec'] },
        authority: 'canonical_mutation',
        actor: 'project-summary',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['task:task-spec'],
      },
      {
        id: 'coordinator-execution-eligibility',
        projectRevision: 42,
        subject: { kind: 'project', id: 'project' },
        field: 'project.executionEligibility',
        value: { state: 'runnable', taskIds: ['task-ready'] },
        authority: 'agent_derivation',
        actor: 'coordinator',
        observedAt: '2026-07-23T12:00:01.000Z',
        evidenceRefs: ['run:coordinator'],
      },
    ] })

    expect(resolution.resolved).toEqual([expect.objectContaining({
      field: 'project.executionEligibility',
      value: { state: 'owner_review', taskIds: ['task-spec'] },
      claimIds: ['canonical-execution-eligibility'],
    })])
    expect(resolution.disagreements).toEqual([expect.objectContaining({
      state: 'resolved_by_authority',
      canonicalClaimIds: ['canonical-execution-eligibility'],
      contradictoryClaimIds: ['coordinator-execution-eligibility'],
      reconciliation: 'inspect_canonical_state',
    })])
  })

  it('leaves contradictory canonical release membership claims unresolved', () => {
    const resolution = resolveRegisteredProjectStateClaimSet({ projectRevision: 42, claims: [
      {
        id: 'canonical-release-membership-a',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.membershipTaskIds',
        value: ['task-outline'],
        authority: 'canonical_mutation',
        actor: 'release-membership-store-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['release:release-1:a'],
      },
      {
        id: 'canonical-release-membership-b',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.membershipTaskIds',
        value: ['task-synopsis'],
        authority: 'canonical_mutation',
        actor: 'release-membership-store-b',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['release:release-1:b'],
      },
    ] })

    expect(resolution).toEqual({
      resolved: [expect.objectContaining({
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.membershipTaskIds',
        claimIds: ['canonical-release-membership-a', 'canonical-release-membership-b'],
        conflict: expect.objectContaining({ reconciliation: 'inspect_canonical_state' }),
      })],
      rejected: [],
      disagreements: [expect.objectContaining({
        canonicalClaimIds: [],
        contradictoryClaimIds: ['canonical-release-membership-a', 'canonical-release-membership-b'],
        state: 'unresolved',
        reconciliation: 'inspect_canonical_state',
      })],
    })
  })

  it('does not let the route choose a custom policy for a registered observation', () => {
    const agreement = reconcileRegisteredProjectStateObservation({
      projectRevision: 42,
      canonicalClaim: {
        id: 'runtime-canonical',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { status: 'running' },
        authority: 'runtime_observation',
        actor: 'runtime-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['runtime:a'],
      },
      observationClaim: {
        id: 'runtime-observation',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { status: 'stopped' },
        authority: 'runtime_observation',
        actor: 'runtime-b',
        observedAt: '2026-07-23T12:00:01.000Z',
        evidenceRefs: ['runtime:b'],
      },
    })

    expect(agreement).toMatchObject({ state: 'contradictory', reconciliation: 'refresh_runtime' })
  })

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

  it('returns the same resolved fact regardless of claim producer order', () => {
    const claims = [
      {
        id: 'runtime-b',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { workers: ['a', 'b'], status: 'running' },
        authority: 'runtime_observation' as const,
        actor: 'coordinator-b',
        observedAt: '2026-07-23T12:00:01.000Z',
        evidenceRefs: ['runtime:b'],
      },
      {
        id: 'runtime-a',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { status: 'running', workers: ['a', 'b'] },
        authority: 'runtime_observation' as const,
        actor: 'coordinator-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['runtime:a'],
      },
    ]
    const policies = [{
      field: 'runtime.status',
      authorities: ['runtime_observation'] as const,
      reconciliation: 'refresh_runtime' as const,
    }]

    expect(resolveProjectStateClaimSet({ projectRevision: 42, claims, policies }))
      .toEqual(resolveProjectStateClaimSet({ projectRevision: 42, claims: [...claims].reverse(), policies }))
  })

  it('retires a matching predecessor only through an explicit authorized supersession', () => {
    const resolution = resolveProjectStateClaimSet({ projectRevision: 42, claims: [
      {
        id: 'old-runtime',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { status: 'stopped' },
        authority: 'runtime_observation',
        actor: 'coordinator-a',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['runtime:old'],
      },
      {
        id: 'new-runtime',
        projectRevision: 42,
        subject: { kind: 'runtime', id: 'project' },
        field: 'runtime.status',
        value: { status: 'running' },
        authority: 'runtime_observation',
        actor: 'coordinator-b',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['runtime:new'],
        supersedes: 'old-runtime',
      },
    ], policies: [{
      field: 'runtime.status',
      authorities: ['runtime_observation'],
      reconciliation: 'refresh_runtime',
    }] })

    expect(resolution).toEqual({
      resolved: [expect.objectContaining({ value: { status: 'running' }, claimIds: ['new-runtime'] })],
      rejected: [],
      disagreements: [],
    })
  })

  it('rejects duplicate claim identities instead of choosing an arbitrary payload', () => {
    const resolution = resolveProjectStateClaimSet({ projectRevision: 42, claims: [
      {
        id: 'same-claim',
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
        id: 'same-claim',
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
      authorities: ['verified_observation'],
      reconciliation: 'rerun_verification',
    }] })

    expect(resolution).toEqual({
      resolved: [],
      rejected: [{ claimId: 'same-claim', code: 'duplicate_claim_id' }],
      disagreements: [],
    })
  })

  it('treats an exact replay as idempotent and rejects self-supersession', () => {
    const replayedClaim = {
      id: 'runtime-current',
      projectRevision: 42,
      subject: { kind: 'runtime', id: 'project' },
      field: 'runtime.status',
      value: { status: 'running' },
      authority: 'runtime_observation' as const,
      actor: 'coordinator-a',
      observedAt: '2026-07-23T12:00:00.000Z',
      evidenceRefs: ['runtime:current'],
    }
    const policy = {
      field: 'runtime.status',
      authorities: ['runtime_observation'] as const,
      reconciliation: 'refresh_runtime' as const,
    }
    expect(resolveProjectStateClaimSet({
      projectRevision: 42,
      claims: [replayedClaim, replayedClaim],
      policies: [policy],
    })).toEqual({
      resolved: [expect.objectContaining({ claimIds: ['runtime-current'], value: { status: 'running' } })],
      rejected: [],
      disagreements: [],
    })
    expect(resolveProjectStateClaimSet({
      projectRevision: 42,
      claims: [{ ...replayedClaim, supersedes: 'runtime-current' }],
      policies: [policy],
    })).toEqual({
      resolved: [],
      rejected: [{ claimId: 'runtime-current', code: 'invalid_supersession' }],
      disagreements: [],
    })
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
      disagreement: expect.objectContaining({
        canonicalClaimIds: ['summary-release-blockers'],
        contradictoryClaimIds: ['diagnostic-release-blockers'],
        state: 'resolved_by_authority',
      }),
    })
  })

  it('keeps a lower-authority contradiction in the shared resolution instead of hiding it behind the winner', () => {
    const resolution = resolveProjectStateClaimSet({ projectRevision: 42, claims: [
      {
        id: 'canonical-running',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-1' },
        field: 'task.execution',
        value: { state: 'running' },
        authority: 'canonical_mutation',
        actor: 'coordinator',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['task:task-1'],
      },
      {
        id: 'agent-stopped',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-1' },
        field: 'task.execution',
        value: { state: 'stopped' },
        authority: 'agent_derivation',
        actor: 'reviewer',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['agent-run:reviewer'],
      },
    ], policies: [{
      field: 'task.execution',
      authorities: ['canonical_mutation', 'agent_derivation'],
      reconciliation: 'refresh_runtime',
    }] })

    expect(resolution).toMatchObject({
      resolved: [expect.objectContaining({ value: { state: 'running' }, claimIds: ['canonical-running'] })],
      rejected: [],
      disagreements: [expect.objectContaining({
        canonicalClaimIds: ['canonical-running'],
        contradictoryClaimIds: ['agent-stopped'],
        state: 'resolved_by_authority',
        reconciliation: 'refresh_runtime',
      })],
    })
  })

  it('fails closed when agents make a claim for a field with no declared authority policy', () => {
    const resolution = resolveProjectStateClaimSet({ projectRevision: 42, claims: [{
      id: 'unregistered-agent-claim',
      projectRevision: 42,
      subject: { kind: 'task', id: 'task-1' },
      field: 'task.unspecifiedAgentConclusion',
      value: { state: 'ready' },
      authority: 'agent_derivation',
      actor: 'reviewer',
      observedAt: '2026-07-23T12:00:00.000Z',
      evidenceRefs: ['agent-run:reviewer'],
    }], policies: [] })

    expect(resolution).toEqual({
      resolved: [],
      rejected: [{ claimId: 'unregistered-agent-claim', code: 'unregistered_field' }],
      disagreements: [],
    })
  })

  it('fails closed rather than choosing an arrival-ordered policy when callers register conflicting policies', () => {
    const claim = {
      id: 'review-claim',
      projectRevision: 42,
      subject: { kind: 'task', id: 'task-1' },
      field: 'task.reviewDisposition',
      value: { state: 'revise' },
      authority: 'agent_derivation' as const,
      actor: 'reviewer',
      observedAt: '2026-07-23T12:00:00.000Z',
      evidenceRefs: ['agent-run:reviewer'],
    }
    const first = { field: 'task.reviewDisposition', authorities: ['agent_derivation'] as const, reconciliation: 'rerun_verification' as const }
    const second = { field: 'task.reviewDisposition', authorities: ['canonical_mutation'] as const, reconciliation: 'inspect_canonical_state' as const }

    expect(resolveProjectStateClaimSet({ projectRevision: 42, claims: [claim], policies: [first, second] }))
      .toEqual(resolveProjectStateClaimSet({ projectRevision: 42, claims: [claim], policies: [second, first] }))
    expect(resolveProjectStateClaimSet({ projectRevision: 42, claims: [claim], policies: [first, second] }))
      .toMatchObject({ rejected: [{ claimId: 'review-claim', code: 'ambiguous_policy' }] })
  })

  it('compares declared blocker sets independently of producer ordering', () => {
    const agreement = reconcileProjectStateObservation({
      projectRevision: 42,
      canonicalClaim: {
        id: 'summary-release-blockers',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.blockerTaskIds',
        value: ['task-proof-a', 'task-proof-b'],
        authority: 'canonical_mutation',
        actor: 'project-summary',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['task:task-proof-a', 'task:task-proof-b'],
      },
      observationClaim: {
        id: 'diagnostic-release-blockers',
        projectRevision: 42,
        subject: { kind: 'release', id: 'release-1' },
        field: 'release.blockerTaskIds',
        value: ['task-proof-b', 'task-proof-a'],
        authority: 'agent_derivation',
        actor: 'diagnostic-projector',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['task:task-proof-b', 'task:task-proof-a'],
      },
      policy: {
        field: 'release.blockerTaskIds',
        authorities: ['canonical_mutation', 'agent_derivation'],
        reconciliation: 'inspect_canonical_state',
        valueSemantics: 'unordered_string_set',
      },
    })

    expect(agreement).toEqual({
      state: 'confirmed',
      canonicalClaimIds: ['summary-release-blockers'],
      observationClaimId: 'diagnostic-release-blockers',
    })
  })

  it('does not call claims about different facts an agreement', () => {
    const agreement = reconcileProjectStateObservation({
      projectRevision: 42,
      canonicalClaim: {
        id: 'canonical-release-blockers',
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
        id: 'wrong-task-observation',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-proof' },
        field: 'task.status',
        value: ['task-proof'],
        authority: 'agent_derivation',
        actor: 'diagnostic-projector',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['diagnostic:42'],
      },
      policy: {
        field: 'release.blockerTaskIds',
        authorities: ['canonical_mutation', 'agent_derivation'],
        reconciliation: 'inspect_canonical_state',
        valueSemantics: 'unordered_string_set',
      },
    })

    expect(agreement).toEqual({
      state: 'unavailable',
      reconciliation: 'inspect_canonical_state',
      reason: 'incomparable_subject_or_field',
      canonicalClaimIds: ['canonical-release-blockers'],
      observationClaimId: 'wrong-task-observation',
    })
  })

  it('treats a different worktree attempt as stale evidence rather than a competing agent opinion', () => {
    const agreement = reconcileProjectStateObservation({
      projectRevision: 42,
      canonicalClaim: {
        id: 'workspace-attempt-two',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-proof' },
        field: 'workspace.syncState',
        value: { state: 'current', baseSha: 'base-b', headSha: 'head-b' },
        authority: 'verified_observation',
        actor: 'git-driver',
        observedAt: '2026-07-23T12:01:00.000Z',
        evidenceRefs: ['git:head-b'],
        basis: { kind: 'workspace_attempt', id: 'task-proof:attempt-2' },
      },
      observationClaim: {
        id: 'workspace-attempt-one-conflict',
        projectRevision: 42,
        subject: { kind: 'task', id: 'task-proof' },
        field: 'workspace.syncState',
        value: { state: 'conflicted', baseSha: 'base-a', headSha: 'head-a' },
        authority: 'verified_observation',
        actor: 'git-driver',
        observedAt: '2026-07-23T12:00:00.000Z',
        evidenceRefs: ['git:head-a'],
        basis: { kind: 'workspace_attempt', id: 'task-proof:attempt-1' },
      },
      policy: {
        field: 'workspace.syncState',
        authorities: ['verified_observation'],
        reconciliation: 'refresh_runtime',
      },
    })

    expect(agreement).toEqual({
      state: 'stale',
      reconciliation: 'refresh_runtime',
      canonicalClaimIds: ['workspace-attempt-two'],
      observationClaimId: 'workspace-attempt-one-conflict',
    })
  })

  it('puts the supervisor-owned active task ahead of stale compact in-flight rows', () => {
    const decision = buildProjectDecisionProjection({
      generatedAt: '2026-07-23T12:00:00.000Z',
      start: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'stale-task',
        focusTaskTitle: 'Old task',
        message: 'Old task is paused.',
      },
      release: { scopeMode: 'unreleased', state: 'active', release: null, blockers: [] },
      runStatus: 'running',
      runtimeExecution: { activeTaskId: 'live-task', activeTaskTitle: 'Live task' },
    })
    expect(projectDecisionInFlight(decision, [{
      id: 'stale-task',
      title: 'Old task',
      status: 'review',
      domain: 'docs',
      lastActivityAt: '2026-07-23T11:00:00.000Z',
    }])).toEqual([
      {
        id: 'live-task',
        title: 'Live task',
        status: 'in_progress',
        domain: '',
        lastActivityAt: '2026-07-23T12:00:00.000Z',
      },
      {
        id: 'stale-task',
        title: 'Old task',
        status: 'review',
        domain: 'docs',
        lastActivityAt: '2026-07-23T11:00:00.000Z',
      },
    ])
  })
})
