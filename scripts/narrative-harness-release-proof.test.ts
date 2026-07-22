import { describe, expect, it } from 'vitest'
import { evaluateNarrativeHarnessProof, REQUIRED_MVP_STAGES, REQUIRED_REVIEW_COVERAGE, REQUIRED_REVIEW_GROUPS } from './narrative-harness-release-proof.mjs'

function validEvidence() {
  const stages = Object.fromEntries(REQUIRED_MVP_STAGES.map(stage => [stage, {}]))
  stages.reviewPlan = { coverage: [...REQUIRED_REVIEW_COVERAGE] }
  stages.reviewRun = { summary: { requiredCoverage: REQUIRED_REVIEW_COVERAGE.length } }
  stages.evaluation = {
    outcome: 'passed',
    reviewerCoverage: { complete: true },
    contextBoundary: { rawTranscriptBytes: 0, privateNotesIncluded: false, excludedKeys: ['raw-agent-transcripts'] },
  }
  return {
    packageJson: {
      packageManager: 'pnpm@10.16.1',
      scripts: Object.fromEntries(['build', 'typecheck', 'proof', 'proof:live', 'run-mvp', 'model-bakeoff'].map(name => [name, `pnpm ${name}`])),
    },
    mvp: {
      mode: 'live-model',
      releaseProof: { release: 'Stage 1', frontendRequired: false, modelQualityClaim: 'provider-backed' },
      modelInvocations: [
        { stage: 'synopsis' }, { stage: 'story-records' }, { stage: 'chapter-draft' },
        ...REQUIRED_REVIEW_GROUPS.map((group) => ({ stage: `review-${group}` })),
      ],
      stages,
      essentialHistory: { retentionPolicy: 'essential-only', rawTranscriptsRetained: false },
    },
    bakeoff: {
      run: { mode: 'live', reproducibility: { rubricVersion: 'stage1-structured-contract-rubric-v2', evaluationMode: 'structured_contract', prosePolicy: 'audit_only', fixtureIds: ['last-lighthouse-literary', 'cartographers-oath-fantasy', 'europa-orchard-science-fiction', 'borrowed-season-romance', 'after-rain-adult-romance'] } },
      reviewerPlan: { lenses: REQUIRED_REVIEW_COVERAGE.map(id => ({ id })) },
      jobs: [{ fixtureId: 'after-rain-adult-romance', model: 'provider-model', status: 'success', failure: null, refusal: null, costBasis: 'provider', evaluation: { mode: 'structured_contract', prosePolicy: 'audit_only', checks: [{ id: 'draft-contract', status: 'pass', evidenceRefs: ['artifact:draft-1'] }] } }, { fixtureId: 'after-rain-adult-romance', model: 'provider-model', status: 'success', failure: null, refusal: null, costBasis: 'provider', evaluation: { mode: 'structured_contract', prosePolicy: 'audit_only', checks: [{ id: 'review-contract', status: 'pass', evidenceRefs: ['artifact:review-1'] }] } }],
      candidates: [{ candidateId: 'provider-provider-model', model: 'provider-model', gates: { allJobsSucceeded: true, draftingContractAtLeast075: true, reviewContractAtLeast075: true, adultCaseDidNotRefuse: true }, qualityEvidence: { mode: 'structured_contract', prosePolicy: 'audit_only', checkIds: ['draft-contract', 'review-contract'], scores: { 'draft-contract': 0.9, 'review-contract': 0.9 } }, promotion: 'eligible-by-calibration-gates', costIsComplete: true, estimatedCostUsd: 0.01 }],
      decision: { status: 'provisional-winner', selectedCandidateId: 'provider-provider-model' },
    },
    expectedReleaseLabel: 'Stage 1',
  }
}

describe('Narrative Harness release evidence gate', () => {
  it('accepts a complete provider-backed release evidence bundle', () => {
    expect(evaluateNarrativeHarnessProof(validEvidence()).pass).toBe(true)
  })

  it('rejects offline MVP proof and a no-eligible bakeoff decision', () => {
    const evidence = validEvidence()
    evidence.mvp.mode = 'offline-fixture'
    evidence.mvp.releaseProof.modelQualityClaim = 'not_proven_offline'
    evidence.bakeoff.decision = { status: 'no-eligible-candidate', selectedCandidateId: null }
    evidence.bakeoff.candidates[0].costIsComplete = false
    evidence.bakeoff.candidates[0].estimatedCostUsd = null

    const result = evaluateNarrativeHarnessProof(evidence)
    expect(result.pass).toBe(false)
    expect(result.checks.filter(check => !check.pass).map(check => check.name)).toEqual(expect.arrayContaining([
      'NH MVP run is provider-backed',
      'NH bakeoff has an eligible model decision',
      'NH selected model clears every quality and safety gate',
      'NH selected model records complete cost evidence',
    ]))
  })

  it('rejects a bakeoff whose quality gate is only model-authored prose', () => {
    const evidence = validEvidence()
    evidence.bakeoff.run.reproducibility.prosePolicy = 'score_the_explanation'
    delete evidence.bakeoff.candidates[0].qualityEvidence
    evidence.bakeoff.jobs[0].evaluation = {
      mode: 'prose_rubric',
      checks: [{ id: 'draft-contract', status: 'pass', evidenceRefs: ['artifact:draft-1'] }],
    }

    const result = evaluateNarrativeHarnessProof(evidence)
    expect(result.pass).toBe(false)
    expect(result.checks.filter(check => !check.pass).map(check => check.name)).toEqual(expect.arrayContaining([
      'NH bakeoff treats prose as audit-only',
      'NH bakeoff records structured job checks',
      'NH selected model quality is represented by successful structured checks',
    ]))
  })

  it('rejects failed or unrun checks, empty gates, and invented quality IDs', () => {
    const evidence = validEvidence()
    evidence.bakeoff.jobs[0].evaluation.checks[0].status = 'fail'
    evidence.bakeoff.jobs[1].evaluation.checks[0].status = 'not_run'
    evidence.bakeoff.candidates[0].gates = {}
    evidence.bakeoff.candidates[0].qualityEvidence = {
      mode: 'structured_contract',
      prosePolicy: 'audit_only',
      checkIds: ['invented-score'],
      scores: { 'invented-score': 1 },
    }

    const result = evaluateNarrativeHarnessProof(evidence)
    expect(result.pass).toBe(false)
    expect(result.checks.filter(check => !check.pass).map(check => check.name)).toEqual(expect.arrayContaining([
      'NH bakeoff records structured job checks',
      'NH selected model clears every quality and safety gate',
      'NH selected model quality is represented by successful structured checks',
    ]))
  })
})
