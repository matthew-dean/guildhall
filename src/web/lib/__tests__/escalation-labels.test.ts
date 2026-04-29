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

  it('passes through unknown codes unchanged (graceful degradation)', () => {
    expect(escalationReasonLabel('future_new_reason')).toBe('future_new_reason')
  })
})

describe('escalationPrimaryAction', () => {
  it('uses gate retry only for gate failures', () => {
    expect(escalationPrimaryAction({ reason: 'gate_hard_failure' })).toMatchObject({
      label: 'Retry gates',
      nextStatus: 'gate_check',
    })
  })

  it('resumes worker turn-limit failures instead of sending them to gates', () => {
    expect(
      escalationPrimaryAction({
        reason: 'human_judgment_required',
        agentId: 'worker-agent',
        summary: 'Worker stopped after hitting its turn limit.',
      }),
    ).toMatchObject({
      label: 'Resume worker',
      nextStatus: 'in_progress',
    })
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
