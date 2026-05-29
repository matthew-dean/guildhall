/**
 * Regression: enum codes must not leak into the UI. These helpers map the
 * raw backend schema strings (`gate_hard_failure`, `worker-agent`, etc.) to
 * human-readable labels.
 */

import { describe, it, expect } from 'vitest'
import {
  escalationReasonLabel,
  roleLabel,
  roleBlurb,
  escalationPrimaryAction,
  escalationRecoveryCopy,
  escalationUserGuidance,
} from '../escalation-labels.js'

describe('escalationReasonLabel', () => {
  it.each([
    ['spec_ambiguous', 'Spec unclear'],
    ['max_revisions_exceeded', 'Too many revisions'],
    ['human_judgment_required', 'Needs human call'],
    ['decision_required', 'Decision needed'],
    ['gate_hard_failure', 'Gate failed'],
    ['scope_boundary', 'Out of scope'],
  ])('maps %s → %s', (code, label) => {
    expect(escalationReasonLabel(code)).toBe(label)
  })

  it('returns "Unknown" for empty/null input', () => {
    expect(escalationReasonLabel(null)).toBe('Unknown')
    expect(escalationReasonLabel(undefined)).toBe('Unknown')
    expect(escalationReasonLabel('')).toBe('Unknown')
  })

  it('humanizes unknown codes through the shared identifier label map', () => {
    expect(escalationReasonLabel('future_new_reason')).toBe('Future New Reason')
  })
})

describe('escalationPrimaryAction', () => {
  it('uses gate retry only for gate failures', () => {
    expect(escalationPrimaryAction({ reason: 'gate_hard_failure' })).toMatchObject({
      label: 'Retry gates',
      nextStatus: 'gate_check',
    })
  })

  it('retries worker turn-limit failures instead of sending them to gates', () => {
    expect(
      escalationPrimaryAction({
        reason: 'human_judgment_required',
        agentId: 'worker-agent',
        summary: 'Worker stopped after hitting its turn limit.',
      }),
    ).toMatchObject({
      label: 'Retry worker',
      nextStatus: 'in_progress',
    })
  })
})

describe('escalationRecoveryCopy', () => {
  it('separates useful transcript context from durable progress failures', () => {
    expect(
      escalationRecoveryCopy({
        agentId: 'spec-agent',
        summary: 'Spec agent made no visible progress after 3 passes.',
        details: 'Task remained in exploring with no saved spec.',
      }),
    ).toEqual({
      headline: 'Guildhall found context but did not save the next draft.',
      detail: 'The transcript may contain useful observations. Retry from those notes or resolve the blocker after reviewing them.',
    })
  })
})

describe('escalationUserGuidance', () => {
  it('turns internal acceptance-criteria evidence blockers into actionable user copy', () => {
    const guidance = escalationUserGuidance({
      agentId: 'worker-agent',
      summary: 'Cannot satisfy required AC-8 evidence command under current authoritative verification gate.',
      details: 'Coordinator scoped instructions require an AC-8 evidence block with the exact pnpm --dir frontend test result (timestamp + exit code) and concrete auth test specs.',
    })

    expect(guidance.title).toBe('Guildhall needs to run one missing check.')
    expect(guidance.detail).toContain('auth')
    expect(guidance.detail).toContain('not asking you to prove anything')
    expect(guidance.nextStep).toContain('Guildhall action')
    expect(guidance.actionOwner).toBe('guildhall')
    expect(`${guidance.title} ${guidance.detail} ${guidance.nextStep}`).not.toMatch(/\bAC-8\b/)
    expect(guidance.technicalNote).toBeUndefined()
    expect(escalationPrimaryAction({
      agentId: 'worker-agent',
      summary: 'Cannot satisfy required AC-8 evidence command under current authoritative verification gate.',
      details: 'Coordinator scoped instructions require an AC-8 evidence block with the exact pnpm --dir frontend test result (timestamp + exit code) and concrete auth test specs.',
    })).toMatchObject({
      label: 'Let Guildhall run the check',
      nextStatus: 'ready',
    })
  })

  it('explains workspace build recovery without asking for an unnamed decision', () => {
    const guidance = escalationUserGuidance({
      agentId: 'worker-agent',
      summary: 'Required authoritative verification is blocked by upstream workspace build failure outside checkpoint-touched editor files.',
      details: 'Reran authoritative command pnpm build in the task worktree.',
    })

    expect(guidance.title).toBe('The project build is failing outside this task.')
    expect(guidance.detail).toContain('nearby workspace code')
    expect(guidance.nextStep).toContain('Reframe task')
    expect(guidance.nextStep).toContain('retry gates')
    expect(guidance.actionOwner).toBe('user')
    expect(guidance.technicalNote).toBeUndefined()
    expect(`${guidance.title} ${guidance.detail} ${guidance.nextStep}`).not.toMatch(/authoritative|checkpoint-touched|worktree/i)
  })

  it('treats worker timeouts as Guildhall-owned recovery instead of an unnamed human decision', () => {
    const guidance = escalationUserGuidance({
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'Worker timed out after failing to mutate the likely target file.',
      details: 'worker-agent timed out after 120000ms of inactivity',
    })

    expect(guidance.title).toBe('Guildhall can retry the worker.')
    expect(guidance.detail).toContain('not something you need to solve by hand')
    expect(guidance.nextStep).toContain('Retry worker')
    expect(guidance.actionOwner).toBe('guildhall')
    expect(`${guidance.title} ${guidance.detail} ${guidance.nextStep}`).not.toMatch(/recovery decision/i)
    expect(escalationPrimaryAction({
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'Worker timed out after failing to mutate the likely target file.',
    })).toMatchObject({
      label: 'Retry worker',
      nextStatus: 'in_progress',
    })
  })

  it('treats gate failures as Guildhall-owned retries', () => {
    const guidance = escalationUserGuidance({
      agentId: 'gate-checker',
      reason: 'gate_hard_failure',
      summary: 'Verification failed.',
    })

    expect(guidance.title).toBe('Guildhall can retry the gates.')
    expect(guidance.nextStep).toContain('Retry gates')
    expect(guidance.actionOwner).toBe('guildhall')
  })
})

describe('roleLabel', () => {
  it('maps known agent ids to human labels (not raw ids)', () => {
    expect(roleLabel('worker-agent')).toBe('Worker')
    expect(roleLabel('gate-checker')).toBe('Gate checker')
    expect(roleLabel('spec-agent')).toBe('Spec author')
    expect(roleLabel('reviewer-agent')).toBe('Reviewer')
    expect(roleLabel('coordinator-agent')).toBe('Coordinator')
  })

  it('returns "Unknown" for empty/null input', () => {
    expect(roleLabel(null)).toBe('Unknown')
    expect(roleLabel(undefined)).toBe('Unknown')
  })

  it('does not emit the raw agent id for a known role', () => {
    // Guards the regression the user filed: UI used to show literal
    // "gate-checker" instead of "Gate checker".
    expect(roleLabel('gate-checker')).not.toBe('gate-checker')
  })
})

describe('roleBlurb', () => {
  it('returns a non-empty explainer for known roles', () => {
    expect(roleBlurb('worker-agent').length).toBeGreaterThan(0)
    expect(roleBlurb('gate-checker')).toContain('lint')
  })

  it('returns empty string for unknown/empty ids', () => {
    expect(roleBlurb('')).toBe('')
    expect(roleBlurb('unknown-agent')).toBe('')
  })
})
