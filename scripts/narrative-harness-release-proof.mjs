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

const REQUIRED_FIXTURES = [
  'last-lighthouse-literary',
  'cartographers-oath-fantasy',
  'europa-orchard-science-fiction',
  'borrowed-season-romance',
  'after-rain-adult-romance',
]

const REQUIRED_PNPM_SCRIPTS = ['build', 'typecheck', 'proof', 'run-mvp', 'model-bakeoff']

function normalizeLensIds(ids) {
  const normalized = new Set()
  for (const id of ids) {
    if (id === 'character-voice') normalized.add('character-voice-dialogue')
    else if (id === 'causal-chain') normalized.add('plot-causality')
    else if (id === 'pacing-chapter-purpose') {
      normalized.add('pacing')
      normalized.add('chapter-purpose')
    } else if (id === 'reader-knowledge') normalized.add('reader-knowledge-and-revelation')
    else normalized.add(id)
  }
  return normalized
}

function addCheck(checks, name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) })
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
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

export function resolveNarrativeHarnessProofPaths(root, bakeoffPath) {
  const resolvedRoot = resolve(root)
  return {
    root: resolvedRoot,
    packageJson: join(resolvedRoot, 'package.json'),
    mvp: join(resolvedRoot, 'runs', 'proof', 'mvp.json'),
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
  addCheck(checks, 'NH MVP run records model invocations', Array.isArray(mvp?.modelInvocations) && mvp.modelInvocations.length >= 3, mvp?.modelInvocations?.length ?? null)

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
  const fixtureIds = new Set(bakeoffRun.reproducibility?.fixtureIds ?? [])
  addCheck(checks, 'NH bakeoff covers the complete genre fixture set', REQUIRED_FIXTURES.every(fixture => fixtureIds.has(fixture)), {
    missing: REQUIRED_FIXTURES.filter(fixture => !fixtureIds.has(fixture)),
  })
  const bakeoffLensIds = (bakeoff?.reviewerPlan?.lenses ?? []).map(lens => lens.id).filter(Boolean)
  const bakeoffCoverage = normalizeLensIds(bakeoffLensIds)
  addCheck(checks, 'NH bakeoff reviewer plan covers every required lens', REQUIRED_REVIEW_COVERAGE.every(lens => bakeoffCoverage.has(lens)), {
    missing: REQUIRED_REVIEW_COVERAGE.filter(lens => !bakeoffCoverage.has(lens)),
    supplied: bakeoffLensIds,
  })
  addCheck(checks, 'NH bakeoff records explicit job outcomes', Array.isArray(bakeoff?.jobs) && bakeoff.jobs.length > 0 && bakeoff.jobs.every(job => typeof job.status === 'string' && 'failure' in job && 'refusal' in job && 'costBasis' in job), {
    jobCount: bakeoff?.jobs?.length ?? 0,
  })

  const decision = bakeoff?.decision ?? {}
  const selected = (bakeoff?.candidates ?? []).find(candidate => candidate.candidateId === decision.selectedCandidateId)
  addCheck(checks, 'NH bakeoff has an eligible model decision', decision.status === 'provisional-winner' && typeof decision.selectedCandidateId === 'string' && Boolean(selected), {
    status: decision.status ?? null,
    selectedCandidateId: decision.selectedCandidateId ?? null,
  })
  addCheck(checks, 'NH selected model clears every quality and safety gate', Boolean(selected) && Object.values(selected.gates ?? {}).every(Boolean) && selected.promotion === 'eligible-by-calibration-gates', selected?.gates ?? null)
  addCheck(checks, 'NH selected model records complete cost evidence', Boolean(selected) && selected.costIsComplete === true && Number.isFinite(selected.estimatedCostUsd), {
    costIsComplete: selected?.costIsComplete ?? null,
    estimatedCostUsd: selected?.estimatedCostUsd ?? null,
  })
  const adultJobs = (bakeoff?.jobs ?? []).filter(job => job.fixtureId === 'after-rain-adult-romance' && job.model === selected?.model)
  addCheck(checks, 'NH selected model completes the adult-compatible fixture', adultJobs.length >= 2 && adultJobs.every(job => job.status === 'success' && job.refusal === null), adultJobs.map(job => ({ stage: job.stage, status: job.status, refusal: job.refusal })))

  return { pass: checks.every(check => check.pass), checks }
}

export function auditNarrativeHarnessProof({ root, expectedReleaseLabel, bakeoffPath } = {}) {
  const paths = resolveNarrativeHarnessProofPaths(root, bakeoffPath)
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
