import { describe, expect, it } from 'vitest'

import { summarizeCurrentProof } from '../current-proof.js'

describe('summarizeCurrentProof', () => {
  it('does not call a blocked inferred command path executable', () => {
    const summary = summarizeCurrentProof({
      status: 'done',
      proofPaths: [{
        kind: 'command',
        source: 'inferred',
        launchSteps: [{ kind: 'blocked_until_setup', setupRequirement: 'Name the command first.' }],
        expectedEvidence: [{ id: 'proof-1', required: true }],
        verificationRecords: [],
      }],
    })

    expect(summary.state).toBe('needed')
    expect(summary).not.toHaveProperty('hasExecutablePath')
  })
  it('uses passed records on current proof paths instead of only top-level gates', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [
        {
          kind: 'review',
          title: 'Review the coherence boundary',
          status: 'verified',
          expectedEvidence: [{ id: 'boundary', required: true }],
          verificationRecords: [{ evidenceId: 'boundary', status: 'passed' }],
        },
        {
          kind: 'command',
          title: 'Run the focused proof',
          command: 'pnpm test -- focused',
          status: 'planned',
          expectedEvidence: [{ id: 'focused', required: true }],
          verificationRecords: [],
        },
      ],
    })).toEqual({
      state: 'partial',
      expectationCount: 2,
      hasExecutablePath: true,
      verified: ['Review approved: Review the coherence boundary'],
      missing: ['Required proof evidence is missing for pnpm test -- focused.'],
    })
  })

  it('does not carry historical top-level proof into a reopened task with no contract', () => {
    expect(summarizeCurrentProof({
      status: 'spec_review',
      gateResults: [{ gateId: 'old-proof', passed: true }],
      proofPaths: [],
    })).toEqual({
      state: 'needed',
      expectationCount: 0,
      verified: [],
      missing: ['Current proof contract has not been attached yet.'],
    })
  })

  it('settles a current command path from its matching passed gate', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{ kind: 'command', command: 'pnpm test -- current' }],
      gateResults: [{ gateId: 'pnpm test -- current', command: 'pnpm test -- current', passed: true }],
    })).toMatchObject({
      state: 'proven',
      verified: ['Proof passed: pnpm test -- current'],
      missing: [],
    })
  })

  it('uses current evidence records when the task index has not copied them to top-level fields', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{ kind: 'command', command: 'pnpm test -- current' }],
      evidence: [{
        kind: 'gate_result',
        payload: { gateId: 'pnpm test -- current', command: 'pnpm test -- current', passed: true },
      }],
    })).toMatchObject({
      state: 'proven',
      verified: ['Proof passed: pnpm test -- current'],
      missing: [],
    })
  })

  it('requires an observed command identity instead of matching gate prose', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{ kind: 'command', command: 'pnpm test -- acceptance' }],
      evidence: [{
        kind: 'gate_result',
        payload: {
          gateId: 'AC-1',
          command: 'pnpm test -- acceptance',
          output: 'Run AC-1 passed; all expected prose appeared.',
          passed: true,
        },
      }],
    })).toMatchObject({
      state: 'proven',
      verified: ['Proof passed: pnpm test -- acceptance'],
      missing: [],
    })
  })

  it('does not let passing output prose stand in for the observed command', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{ kind: 'command', command: 'pnpm test -- acceptance' }],
      gateResults: [{
        gateId: 'AC-1',
        output: 'pnpm test -- acceptance passed.',
        passed: true,
      }],
    })).toMatchObject({
      state: 'needed',
      missing: ['Required proof evidence is missing for pnpm test -- acceptance.'],
    })
  })

  it('settles a command path from its stable evidence id when the gate omits a command copy', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{
        kind: 'command',
        command: 'node scripts/proof.mjs && printf proof-marker',
        expectedEvidence: [{ id: 'ac-1', required: true }],
      }],
      evidence: [{
        kind: 'gate_result',
        payload: { gateId: 'ac-1', passed: true },
      }],
    })).toMatchObject({
      state: 'proven',
      missing: [],
    })
  })

  it('counts a passed current evidence gate for a completed task without a proof path', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      acceptanceCriteria: [{ id: 'ac-1', met: false }],
      evidence: [{
        kind: 'gate_result',
        payload: { gateId: 'ac-1', passed: true },
      }],
    })).toMatchObject({
      state: 'proven',
      expectationCount: 0,
      missing: [],
    })
  })

  it('settles a current review path from recorded evidence without reading reviewer prose', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{
        kind: 'review',
        expectedEvidence: [{ id: 'review-evidence', kind: 'manual', description: 'Review evidence.' }],
        verificationRecords: [{ evidenceId: 'review-evidence', status: 'passed' }],
      }],
      latestReviewerSummary: [
        '**Verdict:** Approved',
        'The reviewer catches elapsed-time changes.',
      ].join('\n'),
    })).toMatchObject({
      state: 'proven',
      verified: ['Review approved: review evidence'],
      missing: [],
    })
  })

  it('does not let prose satisfy a review evidence contract', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{
        kind: 'review',
        expectedEvidence: [{ id: 'review-evidence', kind: 'manual', description: 'Review evidence.' }],
        verificationRecords: [],
      }],
      latestReviewerSummary: '**Verdict:** Approved\nReview evidence.',
    })).toMatchObject({
      state: 'needed',
      missing: ['Required proof evidence is missing for review evidence.'],
    })
  })
  it('uses structured reviewer evidence ids without inspecting reviewer prose', () => {
    const base = {
      status: 'done',
      proofPaths: [{
        kind: 'review',
        expectedEvidence: [{ id: 'draft-shape', required: true }],
      }],
      evidence: [{
        kind: 'review_verdict',
        payload: {
          verdict: 'approve',
          proofEvidenceIds: ['draft-shape'],
          reasoning: 'This wording is allowed to vary completely.',
        },
      }],
    }
    const alternate = {
      ...base,
      evidence: [{
        kind: 'review_verdict',
        payload: {
          verdict: 'approve',
          proofEvidenceIds: ['draft-shape'],
          reasoning: 'A different model used entirely different prose and phrase order.',
        },
      }],
    }

    expect(summarizeCurrentProof(base)).toEqual(summarizeCurrentProof(alternate))
    expect(summarizeCurrentProof(base)).toMatchObject({
      state: 'proven',
      expectationCount: 1,
    })
  })
})
