import { describe, expect, it } from 'vitest'

import { backendEventSchema } from '@guildhall/backend-host'

import type { AgentIssue } from '@guildhall/core'

import { tickOutcomeToBackendEvent, agentIssueToBackendEvent } from '../wire-events.js'
import type { TickOutcome } from '../orchestrator.js'

describe('tickOutcomeToBackendEvent — FR-16 wire mapping', () => {
  it('returns null for idle outcomes', () => {
    const outcome: TickOutcome = {
      kind: 'idle',
      consecutiveIdleTicks: 1,
      allDone: false,
    }
    expect(tickOutcomeToBackendEvent(outcome)).toBeNull()
  })

  it('returns null for processed outcomes that did not transition', () => {
    const outcome: TickOutcome = {
      kind: 'processed',
      taskId: 't1',
      agent: 'worker-agent',
      beforeStatus: 'in_progress',
      afterStatus: 'in_progress',
      transitioned: false,
      revisionCount: 0,
    }
    expect(tickOutcomeToBackendEvent(outcome)).toBeNull()
  })

  it('maps a processed transition to a task_transition event', () => {
    const outcome: TickOutcome = {
      kind: 'processed',
      taskId: 't1',
      agent: 'worker-agent',
      beforeStatus: 'in_progress',
      afterStatus: 'review',
      transitioned: true,
      revisionCount: 1,
    }
    const evt = tickOutcomeToBackendEvent(outcome)
    expect(evt).not.toBeNull()
    // round-trip through the zod schema to catch wire drift
    const parsed = backendEventSchema.parse(evt)
    expect(parsed).toMatchObject({
      type: 'task_transition',
      task_id: 't1',
      from_status: 'in_progress',
      to_status: 'review',
      agent_name: 'worker-agent',
      revision_count: 1,
      transitioned: true,
    })
  })

  it('maps an escalated outcome to escalation_raised', () => {
    const outcome: TickOutcome = {
      kind: 'escalated',
      taskId: 't1',
      agent: 'reviewer-agent',
      reason: 'spec_ambiguous',
      escalationId: 'esc-123',
    }
    const evt = tickOutcomeToBackendEvent(outcome)
    const parsed = backendEventSchema.parse(evt)
    expect(parsed).toMatchObject({
      type: 'escalation_raised',
      task_id: 't1',
      agent_name: 'reviewer-agent',
      reason: 'spec_ambiguous',
      escalation_id: 'esc-123',
    })
  })

  it('maps a blocked-max-revisions outcome to escalation_raised with the canonical reason', () => {
    const outcome: TickOutcome = {
      kind: 'blocked-max-revisions',
      taskId: 't1',
      revisionCount: 3,
    }
    const evt = tickOutcomeToBackendEvent(outcome)
    const parsed = backendEventSchema.parse(evt)
    expect(parsed).toMatchObject({
      type: 'escalation_raised',
      task_id: 't1',
      reason: 'max_revisions_exceeded',
      revision_count: 3,
    })
  })

  it('maps agent-error to a wire error event carrying the agent name', () => {
    const outcome: TickOutcome = {
      kind: 'agent-error',
      taskId: 't1',
      agent: 'worker-agent',
      error: 'boom',
    }
    const evt = tickOutcomeToBackendEvent(outcome)
    const parsed = backendEventSchema.parse(evt)
    expect(parsed.type).toBe('error')
    expect(parsed.task_id).toBe('t1')
    expect(parsed.agent_name).toBe('worker-agent')
    expect(parsed.message).toContain('worker-agent')
    expect(parsed.message).toContain('boom')
  })

  it('maps no-coordinator to a wire error event', () => {
    const outcome: TickOutcome = {
      kind: 'no-coordinator',
      taskId: 't1',
      domain: 'backend',
    }
    const evt = tickOutcomeToBackendEvent(outcome)
    const parsed = backendEventSchema.parse(evt)
    expect(parsed.type).toBe('error')
    expect(parsed.message).toContain('backend')
  })
})

describe('agentIssueToBackendEvent — FR-31 wire mapping', () => {
  const mkIssue = (overrides: Partial<AgentIssue> = {}): AgentIssue => ({
    id: 'iss-t1-1',
    taskId: 't1',
    agentId: 'worker-agent',
    code: 'stuck',
    severity: 'warn',
    detail: 'No forward progress after three attempts',
    raisedAt: '2026-04-20T00:00:00Z',
    broadcast: false,
    ...overrides,
  })

  it('maps a fresh issue to an agent_issue backend event', () => {
    const evt = agentIssueToBackendEvent(mkIssue())
    const parsed = backendEventSchema.parse(evt)
    expect(parsed).toMatchObject({
      type: 'agent_issue',
      task_id: 't1',
      agent_name: 'worker-agent',
      issue_id: 'iss-t1-1',
      code: 'stuck',
      severity: 'warn',
      reason: 'No forward progress after three attempts',
    })
  })

  it('does NOT emit from_status/to_status (issues are not lifecycle transitions)', () => {
    const evt = agentIssueToBackendEvent(mkIssue())
    // from_status / to_status should be unset so subscribers rendering
    // lifecycle arrows do not misinterpret an issue as a transition.
    expect(evt.from_status).toBeUndefined()
    expect(evt.to_status).toBeUndefined()
    expect(evt.transitioned).toBeUndefined()
  })

  it('round-trips all severity levels through the zod schema', () => {
    for (const severity of ['info', 'warn', 'critical'] as const) {
      const evt = agentIssueToBackendEvent(mkIssue({ severity }))
      const parsed = backendEventSchema.parse(evt)
      expect(parsed.severity).toBe(severity)
    }
  })
})
