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
      run: { mode: 'live', reproducibility: { rubricVersion: 'stage1-structured-contract-rubric-v2', fixtureIds: ['last-lighthouse-literary', 'cartographers-oath-fantasy', 'europa-orchard-science-fiction', 'borrowed-season-romance', 'after-rain-adult-romance'] } },
      reviewerPlan: { lenses: REQUIRED_REVIEW_COVERAGE.map(id => ({ id })) },
      jobs: [{ fixtureId: 'after-rain-adult-romance', model: 'provider-model', status: 'success', failure: null, refusal: null, costBasis: 'provider' }, { fixtureId: 'after-rain-adult-romance', model: 'provider-model', status: 'success', failure: null, refusal: null, costBasis: 'provider' }],
      candidates: [{ candidateId: 'provider-provider-model', model: 'provider-model', gates: { allJobsSucceeded: true, draftingContractAtLeast075: true, reviewContractAtLeast075: true, adultCaseDidNotRefuse: true }, promotion: 'eligible-by-calibration-gates', costIsComplete: true, estimatedCostUsd: 0.01 }],
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
})
