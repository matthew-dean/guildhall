import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const REQUIRED_MVP_STAGES = [
  'authorIntent',
  'synopsis',
  'storyRecords',
  'contextPlan',
  'draft',
  'reviewPlan',
  'reviewRun',
  'evaluation',
]

export const REQUIRED_REVIEW_COVERAGE = [
  'character-voice-dialogue',
  'world-object-state',
  'temporal-continuity',
  'spatial-geographic-continuity',
  'movement-plausibility',
  'plot-causality',
  'point-of-view',
  'tense',
  'pacing',
  'chapter-purpose',
  'reader-knowledge-and-revelation',
  'theme-and-meaning',
]

export const REQUIRED_REVIEW_GROUPS = ['voice', 'continuity', 'structure', 'reader', 'meaning']

const REQUIRED_FIXTURES = [
  'last-lighthouse-literary',
  'cartographers-oath-fantasy',
  'europa-orchard-science-fiction',
  'borrowed-season-romance',
  'after-rain-adult-romance',
]

const REQUIRED_PNPM_SCRIPTS = ['build', 'typecheck', 'proof', 'proof:live', 'run-mvp', 'model-bakeoff']
const REQUIRED_BAKEOFF_RUBRIC = 'stage1-structured-contract-rubric-v2'
const REQUIRED_BAKEOFF_EVALUATION_MODE = 'structured_contract'
const REQUIRED_BAKEOFF_PROSE_POLICY = 'audit_only'

function addCheck(checks, name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) })
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function hasStructuredJobEvaluation(job) {
  const evaluation = job?.evaluation
  if (!evaluation || evaluation.mode !== REQUIRED_BAKEOFF_EVALUATION_MODE) return false
  if (evaluation.prosePolicy !== REQUIRED_BAKEOFF_PROSE_POLICY) return false
  if (!Array.isArray(evaluation.checks) || evaluation.checks.length === 0) return false
  const ids = evaluation.checks.map(check => check?.id).filter(id => typeof id === 'string' && id.trim())
  return ids.length === evaluation.checks.length && new Set(ids).size === ids.length && evaluation.checks.every(check => (
    check &&
    check.status === 'pass' &&
    Array.isArray(check.evidenceRefs) &&
    check.evidenceRefs.every(ref => typeof ref === 'string' && ref.trim())
  ))
}

function hasStructuredCandidateQuality(candidate, successfulJobCheckIds) {
  const quality = candidate?.qualityEvidence
  if (!quality || quality.mode !== REQUIRED_BAKEOFF_EVALUATION_MODE || quality.prosePolicy !== REQUIRED_BAKEOFF_PROSE_POLICY) return false
  if (!Array.isArray(quality.checkIds) || quality.checkIds.length === 0) return false
  if (!quality.scores || typeof quality.scores !== 'object' || Array.isArray(quality.scores)) return false
  return quality.checkIds.every(id =>
    typeof id === 'string' &&
    id.trim() &&
    successfulJobCheckIds.has(id) &&
    Number.isFinite(quality.scores[id]) &&
    quality.scores[id] >= 0 &&
    quality.scores[id] <= 1,
  )
}

function latestLiveBakeoffPath(root) {
  const directory = join(root, 'runs', 'proof', 'model-bakeoff')
  if (!existsSync(directory)) return null
  const paths = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name, 'model-bakeoff.json'))
    .filter(existsSync)
  const live = paths
    .map(path => {
      try {
        const artifact = readJson(path)
        return artifact?.run?.mode === 'live' ? { path, generatedAt: artifact.run.generatedAt || '' } : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
  return live[0]?.path ?? null
}

function latestLiveMvpPath(root) {
  const directory = join(root, 'runs', 'proof', 'live')
  if (!existsSync(directory)) return null
  const paths = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(directory, entry.name))
    .filter(existsSync)
  const live = paths
    .map(path => {
      try {
        const artifact = readJson(path)
        return artifact?.mode === 'live-model' ? { path, generatedAt: artifact.completedAt || artifact.startedAt || '' } : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
  return live[0]?.path ?? null
}

export function resolveNarrativeHarnessProofPaths(root, bakeoffPath, mvpPath) {
  const resolvedRoot = resolve(root)
  return {
    root: resolvedRoot,
    packageJson: join(resolvedRoot, 'package.json'),
    mvp: mvpPath
      ? resolve(mvpPath)
      : latestLiveMvpPath(resolvedRoot) || join(resolvedRoot, 'runs', 'proof', 'mvp.json'),
    bakeoff: bakeoffPath
      ? resolve(bakeoffPath)
      : latestLiveBakeoffPath(resolvedRoot),
  }
}

export function evaluateNarrativeHarnessProof({ packageJson, mvp, bakeoff, expectedReleaseLabel }) {
  const checks = []
  const packageScripts = packageJson?.scripts ?? {}
  addCheck(checks, 'NH package declares pnpm', typeof packageJson?.packageManager === 'string' && packageJson.packageManager.startsWith('pnpm@'), packageJson?.packageManager)
  for (const script of REQUIRED_PNPM_SCRIPTS) {
    addCheck(checks, `NH exposes pnpm ${script}`, typeof packageScripts[script] === 'string', packageScripts[script])
  }

  const releaseProof = mvp?.releaseProof ?? {}
  addCheck(checks, 'NH MVP proof has the selected Guildhall release', releaseProof.release === expectedReleaseLabel, {
    expected: expectedReleaseLabel,
    actual: releaseProof.release ?? null,
  })
  addCheck(checks, 'NH MVP proof is frontend-independent', releaseProof.frontendRequired === false, releaseProof.frontendRequired)
  addCheck(checks, 'NH MVP run is provider-backed', mvp?.mode === 'live-model' && releaseProof.modelQualityClaim !== 'not_proven_offline', {
    mode: mvp?.mode ?? null,
    modelQualityClaim: releaseProof.modelQualityClaim ?? null,
  })
  const modelInvocations = Array.isArray(mvp?.modelInvocations) ? mvp.modelInvocations : []
  addCheck(checks, 'NH MVP run records model invocations', modelInvocations.length >= 3, modelInvocations.length)
  const reviewStages = new Set(modelInvocations.map((invocation) => invocation?.stage).filter((stage) => typeof stage === 'string'))
  addCheck(checks, 'NH MVP run invokes every grouped review role', REQUIRED_REVIEW_GROUPS.every((group) => reviewStages.has(`review-${group}`)), {
    required: REQUIRED_REVIEW_GROUPS.map((group) => `review-${group}`),
    actual: [...reviewStages].filter((stage) => stage.startsWith('review-')),
  })

  const stages = mvp?.stages ?? {}
  addCheck(checks, 'NH MVP proof contains the complete stage chain', REQUIRED_MVP_STAGES.every(stage => stages[stage] && typeof stages[stage] === 'object'), Object.keys(stages))
  addCheck(checks, 'NH MVP evaluation passed', stages.evaluation?.outcome === 'passed', stages.evaluation?.outcome ?? null)

  const mvpCoverage = new Set(stages.reviewPlan?.coverage ?? stages.reviewPlan?.lanes?.map(lane => lane.id) ?? [])
  addCheck(checks, 'NH MVP review plan covers every required lens', REQUIRED_REVIEW_COVERAGE.every(lens => mvpCoverage.has(lens)), {
    missing: REQUIRED_REVIEW_COVERAGE.filter(lens => !mvpCoverage.has(lens)),
  })
  addCheck(checks, 'NH MVP review run covers every required lens', stages.reviewRun?.summary?.requiredCoverage === REQUIRED_REVIEW_COVERAGE.length && stages.evaluation?.reviewerCoverage?.complete === true, stages.reviewRun?.summary)

  const contextBoundary = stages.evaluation?.contextBoundary ?? {}
  addCheck(checks, 'NH context proof excludes raw transcript history', contextBoundary.rawTranscriptBytes === 0 && contextBoundary.privateNotesIncluded === false && (contextBoundary.excludedKeys ?? []).includes('raw-agent-transcripts'), contextBoundary)
  addCheck(checks, 'NH essential history is compact', mvp?.essentialHistory?.retentionPolicy === 'essential-only' && mvp.essentialHistory.rawTranscriptsRetained === false, mvp?.essentialHistory)

  const bakeoffRun = bakeoff?.run ?? {}
  addCheck(checks, 'NH live bakeoff exists', bakeoffRun.mode === 'live', { mode: bakeoffRun.mode ?? null, id: bakeoffRun.id ?? null })
  addCheck(checks, 'NH bakeoff uses the structured contract rubric', bakeoffRun.reproducibility?.rubricVersion === REQUIRED_BAKEOFF_RUBRIC, bakeoffRun.reproducibility?.rubricVersion ?? null)
  addCheck(checks, 'NH bakeoff treats prose as audit-only', bakeoffRun.reproducibility?.evaluationMode === REQUIRED_BAKEOFF_EVALUATION_MODE && bakeoffRun.reproducibility?.prosePolicy === REQUIRED_BAKEOFF_PROSE_POLICY, {
    evaluationMode: bakeoffRun.reproducibility?.evaluationMode ?? null,
    prosePolicy: bakeoffRun.reproducibility?.prosePolicy ?? null,
  })
  const fixtureIds = new Set(bakeoffRun.reproducibility?.fixtureIds ?? [])
  addCheck(checks, 'NH bakeoff covers the complete genre fixture set', REQUIRED_FIXTURES.every(fixture => fixtureIds.has(fixture)), {
    missing: REQUIRED_FIXTURES.filter(fixture => !fixtureIds.has(fixture)),
  })
  const bakeoffLensIds = (bakeoff?.reviewerPlan?.lenses ?? []).map(lens => lens.id).filter(Boolean)
  const bakeoffCoverage = new Set(bakeoffLensIds)
  addCheck(checks, 'NH bakeoff reviewer plan covers every required lens', REQUIRED_REVIEW_COVERAGE.every(lens => bakeoffCoverage.has(lens)), {
    missing: REQUIRED_REVIEW_COVERAGE.filter(lens => !bakeoffCoverage.has(lens)),
    supplied: bakeoffLensIds,
  })
  addCheck(checks, 'NH bakeoff records explicit job outcomes', Array.isArray(bakeoff?.jobs) && bakeoff.jobs.length > 0 && bakeoff.jobs.every(job => typeof job.status === 'string' && 'failure' in job && 'refusal' in job && 'costBasis' in job), {
    jobCount: bakeoff?.jobs?.length ?? 0,
  })
  addCheck(checks, 'NH bakeoff records structured job checks', Array.isArray(bakeoff?.jobs) && bakeoff.jobs.length > 0 && bakeoff.jobs.every(hasStructuredJobEvaluation), {
    invalidJobs: (bakeoff?.jobs ?? []).filter(job => !hasStructuredJobEvaluation(job)).map(job => ({ fixtureId: job?.fixtureId ?? null, stage: job?.stage ?? null })),
  })
  const successfulJobCheckIds = new Set((bakeoff?.jobs ?? []).flatMap(job =>
    Array.isArray(job?.evaluation?.checks)
      ? job.evaluation.checks
        .filter(check => check?.status === 'pass' && typeof check.id === 'string' && check.id.trim())
        .map(check => check.id)
      : [],
  ))

  const decision = bakeoff?.decision ?? {}
  const selected = (bakeoff?.candidates ?? []).find(candidate => candidate.candidateId === decision.selectedCandidateId)
  addCheck(checks, 'NH bakeoff has an eligible model decision', decision.status === 'provisional-winner' && typeof decision.selectedCandidateId === 'string' && Boolean(selected), {
    status: decision.status ?? null,
    selectedCandidateId: decision.selectedCandidateId ?? null,
  })
  addCheck(checks, 'NH selected model clears every quality and safety gate', Boolean(selected) && Object.keys(selected.gates ?? {}).length > 0 && Object.values(selected.gates ?? {}).every(Boolean) && selected.promotion === 'eligible-by-calibration-gates', selected?.gates ?? null)
  addCheck(checks, 'NH selected model quality is represented by successful structured checks', Boolean(selected) && hasStructuredCandidateQuality(selected, successfulJobCheckIds), selected?.qualityEvidence ?? null)
  addCheck(checks, 'NH selected model records complete cost evidence', Boolean(selected) && selected.costIsComplete === true && Number.isFinite(selected.estimatedCostUsd), {
    costIsComplete: selected?.costIsComplete ?? null,
    estimatedCostUsd: selected?.estimatedCostUsd ?? null,
  })
  const adultJobs = (bakeoff?.jobs ?? []).filter(job => job.fixtureId === 'after-rain-adult-romance' && job.model === selected?.model)
  addCheck(checks, 'NH selected model completes the adult-compatible fixture', adultJobs.length >= 2 && adultJobs.every(job => job.status === 'success' && job.refusal === null), adultJobs.map(job => ({ stage: job.stage, status: job.status, refusal: job.refusal })))

  return { pass: checks.every(check => check.pass), checks }
}

export function auditNarrativeHarnessProof({ root, expectedReleaseLabel, bakeoffPath, mvpPath } = {}) {
  const paths = resolveNarrativeHarnessProofPaths(root, bakeoffPath, mvpPath)
  const checks = []
  let packageJson
  let mvp
  let bakeoff
  try {
    packageJson = readJson(paths.packageJson)
  } catch (error) {
    addCheck(checks, 'NH package proof is readable', false, error instanceof Error ? error.message : String(error))
  }
  try {
    mvp = readJson(paths.mvp)
  } catch (error) {
    addCheck(checks, 'NH MVP proof is readable', false, error instanceof Error ? error.message : String(error))
  }
  if (!paths.bakeoff) {
    addCheck(checks, 'NH live bakeoff proof is discoverable', false, 'No live model-bakeoff artifact found under runs/proof/model-bakeoff/')
  } else {
    try {
      bakeoff = readJson(paths.bakeoff)
    } catch (error) {
      addCheck(checks, 'NH live bakeoff proof is readable', false, error instanceof Error ? error.message : String(error))
    }
  }
  if (packageJson && mvp && bakeoff) {
    checks.push(...evaluateNarrativeHarnessProof({ packageJson, mvp, bakeoff, expectedReleaseLabel }).checks)
  }
  return { ...paths, pass: checks.every(check => check.pass), checks }
}
