import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeProjectStateJsonAsync, writeProjectStateTextAsync } from '@guildhall/sessions'
import {
  answerPressureTestQuestion,
  createPressureTestIntake,
  inspectPressureTestEvidence,
  listPressureTestIntakes,
  loadPressureTestIntake,
  renderPressureTestSpec,
} from '../pressure-test-intake.js'

interface AllocationWorkerRequest {
  rawRequest: string
  targetId: string
  targetTitle: string
  postBarrierDelayMs?: number
}

interface AllocationWorkerResult {
  id: string
  rawRequest: string
  createdAt: string
  target: { id: string; title: string }
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const allocationWorkerPath = 'src/runtime/__tests__/helpers/pressure-test-intake-process.test.ts'
const vitestCliPath = createRequire(import.meta.url).resolve('vitest/vitest.mjs')

async function waitForPath(filePath: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(filePath)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for allocation worker marker: ${filePath}`)
}

function startAllocationWorker(input: {
  memoryDir: string
  request: AllocationWorkerRequest
  readyPath: string
  startPath: string
  resultPath: string
}): Promise<{ ok: boolean; output: string }> {
  const child = spawn(process.execPath, [
    vitestCliPath,
    'run',
    allocationWorkerPath,
    '--maxWorkers=1',
    '--minWorkers=1',
    '--reporter=dot',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GUILDHALL_MP_MEMORY_DIR: input.memoryDir,
      GUILDHALL_MP_RAW_REQUEST: input.request.rawRequest,
      GUILDHALL_MP_TARGET_ID: input.request.targetId,
      GUILDHALL_MP_TARGET_TITLE: input.request.targetTitle,
      GUILDHALL_MP_READY_PATH: input.readyPath,
      GUILDHALL_MP_START_PATH: input.startPath,
      GUILDHALL_MP_RESULT_PATH: input.resultPath,
      GUILDHALL_MP_POST_BARRIER_DELAY_MS: String(input.request.postBarrierDelayMs ?? 0),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  return new Promise(resolve => {
    child.on('error', error => resolve({ ok: false, output: `${output}\n${error.message}` }))
    child.on('exit', code => resolve({ ok: code === 0, output }))
  })
}

async function runAllocationRace(
  memoryDir: string,
  requests: AllocationWorkerRequest[],
): Promise<AllocationWorkerResult[]> {
  const coordinationDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-race-'))
  const startPath = path.join(coordinationDir, 'start')
  const readyPaths = requests.map((_, index) => path.join(coordinationDir, `ready-${index}`))
  const resultPaths = requests.map((_, index) => path.join(coordinationDir, `result-${index}.json`))
  const workers = requests.map((request, index) => startAllocationWorker({
    memoryDir,
    request,
    readyPath: readyPaths[index]!,
    startPath,
    resultPath: resultPaths[index]!,
  }))
  try {
    await Promise.all(readyPaths.map(readyPath => waitForPath(readyPath)))
    await writeFile(startPath, 'start\n', 'utf-8')
    const outcomes = await Promise.all(workers)
    const failures = outcomes.filter(outcome => !outcome.ok)
    if (failures.length > 0) {
      throw new Error(failures.map(failure => failure.output).join('\n--- worker ---\n'))
    }
    return Promise.all(resultPaths.map(async resultPath =>
      JSON.parse(await readFile(resultPath, 'utf-8')) as AllocationWorkerResult,
    ))
  } finally {
    await writeFile(startPath, 'start\n', 'utf-8').catch(() => undefined)
    await Promise.all(workers)
    await rm(coordinationDir, { recursive: true, force: true })
  }
}

describe('pressure-test intake state', () => {
  it('keeps distinct slug-equivalent requests separate across Guildhall processes', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-multiprocess-'))
    try {
      const results = await runAllocationRace(memoryDir, [
        {
          rawRequest: 'Create the first packaged desktop release.',
          targetId: 'stage-2-desktop-ui',
          targetTitle: 'Stage 2: Desktop UI',
        },
        {
          rawRequest: 'Create a separate follow-up desktop release.',
          targetId: 'stage-2-desktop-ui',
          targetTitle: 'Stage 2 - Desktop UI',
          postBarrierDelayMs: 100,
        },
      ])

      expect(results.map(result => result.id).sort()).toEqual([
        'pti-stage-2-desktop-ui',
        'pti-stage-2-desktop-ui-2',
      ])
      expect(listPressureTestIntakes(memoryDir).map(intake => intake.rawRequest).sort()).toEqual([
        'Create a separate follow-up desktop release.',
        'Create the first packaged desktop release.',
      ])
    } finally {
      await rm(memoryDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('converges identical multiprocess retries on the persisted intake', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-multiprocess-'))
    try {
      const request = {
        rawRequest: 'Create the next packaged desktop release.',
        targetId: 'stage-3-desktop-ui',
        targetTitle: 'Stage 3: Desktop UI',
      }
      const results = await runAllocationRace(memoryDir, [
        request,
        { ...request, postBarrierDelayMs: 100 },
      ])
      const persisted = await loadPressureTestIntake({
        memoryDir,
        intakeId: 'pti-stage-3-desktop-ui',
      })

      expect(results[0]).toEqual(results[1])
      expect(results[0]).toMatchObject({
        id: persisted.id,
        rawRequest: persisted.rawRequest,
        createdAt: persisted.createdAt,
        target: persisted.target,
      })
      expect(listPressureTestIntakes(memoryDir)).toHaveLength(1)
    } finally {
      await rm(memoryDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('creates a release-level intake with seeded domains and one active question', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
      rawRequest: 'I want 0.8.0 to prioritize pressure-test intake.',
    })

    expect(intake.status).toBe('active')
    expect(intake.activeDomainId).toBe('product-goals')
    expect(intake.domains[0]).toMatchObject({
      id: 'product-goals',
      status: 'active',
      closeoutAsked: false,
    })
    expect(intake.domains.map(domain => domain.id)).toEqual([
      'product-goals',
      'workflows',
      'design-quality',
      'task-boundaries',
      'acceptance-criteria',
      'verification-tdd',
      'review-lenses',
      'risks',
    ])
    expect(intake.pendingQuestion?.domainId).toBe('product-goals')

    const saved = await loadPressureTestIntake({ memoryDir, intakeId: intake.id })
    expect(saved.rawRequest).toContain('pressure-test intake')
  })

  it('asks the first question about the actual pressure-test subject', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'release', id: 'commerce-project-0-9-0', title: 'Commerce Project 0.9.0' },
      rawRequest: 'Pressure-test Commerce Project 0.9.0 checkout wording assumptions.',
    })

    expect(intake.pendingQuestion?.prompt).toBe(
      'For "Commerce Project 0.9.0", what outcome should this request achieve?',
    )
  })

  it('regenerates stale first questions from the structured target instead of parsing raw prose', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await writeProjectStateJsonAsync(
      memoryDir,
      path.join('pressure-test-intake', 'pti-commerce-project-0-9-0.json'),
      {
        id: 'pti-commerce-project-0-9-0',
        rawRequest: 'Pressure-test Commerce Project 0.9.0 checkout wording assumptions.',
        target: { type: 'release', id: 'commerce-project-0-9-0', title: 'Commerce Project 0.9.0' },
        status: 'active',
        activeDomainId: 'product-goals',
        pendingQuestion: {
          id: 'product-goals-q-1',
          domainId: 'product-goals',
          prompt: 'What must Commerce Project 0.9.0 checkout wording assumptions get right first for product goals?',
          why: 'A clear goal helps Guildhall shape work around the result you actually want.',
          evidence: [],
          askedAt: '2026-05-24T00:00:00.000Z',
        },
        domains: [{
          id: 'product-goals',
          title: 'Product goals',
          whyItMatters: 'A clear goal helps Guildhall shape work around the result you actually want.',
          status: 'active',
          knownFacts: [],
          openUnknowns: [],
          askedQuestions: [],
          followUpCandidates: [],
          closeoutAsked: false,
        }],
        outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    )

    const intake = await loadPressureTestIntake({ memoryDir, intakeId: 'pti-commerce-project-0-9-0' })

    expect(intake.target.title).toBe('Commerce Project 0.9.0')
    expect(intake.pendingQuestion?.prompt).toBe(
      'For "Commerce Project 0.9.0", what outcome should this request achieve?',
    )
  })

  it('does not turn project check-in status copy into the question subject', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'project', id: 'looma-knit-project-check-in', title: 'Looma + Knit project check-in' },
      rawRequest: 'Project check-in needed before Guildhall treats this workspace as current.',
    })

    expect(intake.target.title).toBe('Looma + Knit project check-in')
    expect(intake.pendingQuestion?.prompt).toBe(
      'What should Guildhall use as the main direction for Looma + Knit when shaping work?',
    )
  })

  it('repairs stale project check-in intakes whose title was copied from status text', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await writeProjectStateJsonAsync(
      memoryDir,
      path.join('pressure-test-intake', 'pti-project-check-in.json'),
      {
        id: 'pti-project-check-in',
        rawRequest: 'Project check-in needed before Guildhall treats this workspace as current.',
        target: {
          type: 'project',
          id: 'looma-knit-project-check-in',
          title: 'Looma + Knit project check-in',
        },
        status: 'active',
        activeDomainId: 'product-goals',
        pendingQuestion: {
          id: 'product-goals-q-1',
          domainId: 'product-goals',
          prompt: 'What must Project check-in needed before Guildhall treats this workspace as current get right first for product goals?',
          why: 'A clear goal helps Guildhall shape work around the result you actually want.',
          evidence: [],
          askedAt: '2026-05-24T00:00:00.000Z',
        },
        domains: [{
          id: 'product-goals',
          title: 'Product goals',
          whyItMatters: 'A clear goal helps Guildhall shape work around the result you actually want.',
          status: 'active',
          knownFacts: [],
          openUnknowns: [],
          askedQuestions: [],
          followUpCandidates: [],
          closeoutAsked: false,
        }],
        outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    )

    const intake = await loadPressureTestIntake({ memoryDir, intakeId: 'pti-project-check-in' })

    expect(intake.target.title).toBe('Looma + Knit project check-in')
    expect(intake.pendingQuestion?.prompt).not.toContain('Project check-in needed before Guildhall treats this workspace as current')
  })

  it('starts project check-in with a typed direction question while retaining project evidence', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await writeProjectStateTextAsync(
      memoryDir,
      'project-brief.md',
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
      ].join('\n'),
    )

    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
      rawRequest: 'Start a project check-in for Narrative Harness.',
    })

    expect(intake.pendingQuestion?.prompt).toBe(
      'What should Guildhall use as the main direction for Narrative Harness when shaping work?',
    )
    expect(intake.pendingQuestion?.choices).toBeUndefined()
    expect(intake.pendingQuestion?.evidence).toEqual([])
    expect(intake.outputs.projectQuestionPlanner?.inferredFacts.map(fact => fact.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fiction-writing software'),
        expect.stringContaining('author voice'),
      ]),
    )
    expect(intake.pendingQuestion?.prompt).not.toMatch(/workflow|day-to-day|anything else/i)
  })

  it('records confused project-check-in answers as discarded and does not ask closeout questions', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await writeProjectStateTextAsync(
      memoryDir,
      'project-brief.md',
      'Narrative Harness is fiction-writing software for building and revising a coherent novel with author voice and reader knowledge reviewers.',
    )
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
      rawRequest: 'Start a project check-in for Narrative Harness.',
    })

    const next = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: intake.pendingQuestion!.id,
      answer: "Hmm I don't understand the nature of the question?",
    })

    expect(next.outputs.projectQuestionPlanner?.discardedAnswers).toContainEqual(expect.objectContaining({
      reason: 'confused',
      answer: "Hmm I don't understand the nature of the question?",
    }))
    expect(next.pendingQuestion?.prompt ?? '').not.toContain('anything else')
  })

  it('records answers and asks a follow-up before closing vague product goals', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
      rawRequest: 'I want better intake.',
    })

    const next = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: intake.pendingQuestion!.id,
      answer: 'It should feel rigorous but not annoying.',
    })

    expect(next.activeDomainId).toBe('product-goals')
    expect(next.pendingQuestion?.prompt).toBe('For "Guildhall 0.8.0", what observable result would show the work succeeded?')
    expect(next.pendingQuestion?.prompt).not.toContain(next.domains[0]?.askedQuestions[0]?.answer ?? '')
    expect(next.pendingQuestion?.why).toBe('Guildhall needs one observable example so future work can use this answer.')
    expect(next.domains[0]?.askedQuestions[0]).toMatchObject({
      answered: true,
      answer: 'It should feel rigorous but not annoying.',
    })
  })

  it('asks project design-quality follow-ups without injecting the previous answer into the prompt', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
      rawRequest: 'Start a project check-in for Narrative Harness.',
    })
    intake.activeDomainId = 'design-quality'
    intake.domains[0]!.status = 'closed'
    intake.domains[2]!.status = 'active'
    intake.pendingQuestion = {
      id: 'design-quality-q-1',
      domainId: 'design-quality',
      prompt: 'What design-system source, interaction pattern, palette direction, or visual proof should Guildhall remember for this project?',
      why: intake.domains[2]!.whyItMatters,
      evidence: [],
      askedAt: intake.createdAt,
    }
    await writeProjectStateJsonAsync(memoryDir, path.join('pressure-test-intake', `${intake.id}.json`), intake)

    const answer = 'Should Guildhall remember? I guess it should be reader / writer friendly -- muted palette, clean lines, generous whitespace, minimalist'
    const next = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: 'design-quality-q-1',
      answer,
    })

    expect(next.status).toBe('complete')
    expect(next.pendingQuestion).toBeNull()
    expect(next.outputs.decisions).toContain(answer)
  })

  it('repairs persisted injected follow-up prompts on load', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await writeProjectStateJsonAsync(
      memoryDir,
      path.join('pressure-test-intake', 'pti-narrative-harness-project-check-in.json'),
      {
        id: 'pti-narrative-harness-project-check-in',
        rawRequest: 'Start a project check-in for Narrative Harness.',
        target: {
          type: 'project',
          id: 'narrative-harness-project-check-in',
          title: 'Narrative Harness project check-in',
        },
        status: 'active',
        activeDomainId: 'design-quality',
        pendingQuestion: {
          id: 'design-quality-q-2',
          domainId: 'design-quality',
          prompt: 'What is one concrete example or threshold that would make "Should Guildhall remember? I guess it should be reader / writer friendly -- muted palette, clean lines, generous whitespace, minimalist" true for Narrative Harness project check-in?',
          why: 'The answer names a quality bar, but workers need an observable example or threshold.',
          evidence: [],
          askedAt: '2026-05-31T00:56:17.298Z',
        },
        domains: [{
          id: 'design-quality',
          title: 'Design quality',
          whyItMatters: 'UI work should reach an app-store-caliber result, not merely a functional one.',
          status: 'follow-up',
          knownFacts: [],
          openUnknowns: [],
          askedQuestions: [{
            questionId: 'design-quality-q-2',
            prompt: 'What is one concrete example or threshold that would make "muted palette, clean lines" true for Narrative Harness project check-in?',
            answered: true,
            answer: 'Show a calm editor surface.',
          }],
          followUpCandidates: [],
          closeoutAsked: false,
        }],
        outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
        createdAt: '2026-05-31T00:53:58.947Z',
        updatedAt: '2026-05-31T00:56:17.298Z',
      },
    )

    const loaded = await loadPressureTestIntake({ memoryDir, intakeId: 'pti-narrative-harness-project-check-in' })

    expect(loaded.pendingQuestion?.prompt).toBe(
      "What should a worker or reviewer be able to see before Guildhall treats this project's visual direction as met?",
    )
    expect(loaded.pendingQuestion?.why).toBe('Workers and reviewers need visible proof, not just a taste adjective.')
    expect(loaded.domains[0]?.askedQuestions[0]?.prompt).toBe(
      "What should a worker or reviewer be able to see before Guildhall treats this project's visual direction as met?",
    )
  })

  it('does not contain the old answer-interpolation follow-up template', async () => {
    const source = await import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../pressure-test-intake.ts', import.meta.url), 'utf-8'),
    )

    expect(source).not.toContain('What is one concrete example or threshold that would make "${input.answer}" true')
  })

  it('renders a spec from completed pressure-test domains', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'feature', id: 'request-intake', title: 'Request intake' },
      rawRequest: 'Make New request smart.',
    })
    intake.status = 'complete'
    intake.activeDomainId = null
    intake.pendingQuestion = null
    intake.domains[0]!.status = 'closed'
    intake.domains[0]!.summary = 'Users type one broad request and Guildhall routes it into the right flow.'
    intake.domains[1]!.status = 'closed'
    intake.domains[1]!.summary = 'Thread shows the request immediately, then asks one focused question.'
    intake.domains[2]!.status = 'deferred'
    intake.outputs.assumptions.push('Deferred domains are explicit in the generated spec.')

    const spec = renderPressureTestSpec(intake)

    expect(spec).toContain('Acceptance Criteria')
    expect(spec).toContain('Verification And TDD')
    expect(spec).toContain('Design Quality')
    expect(spec).toContain('Reviewer Lenses')
    expect(spec).toContain('Task Boundaries')
    expect(spec).toContain('Users type one broad request')
    expect(spec).toContain('Deferred domains are explicit')
  })

  it('asks design-quality questions for UI feature pressure tests', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'feature', id: 'pantry-pulse', title: 'Pantry Pulse app spec' },
      rawRequest: 'Build a Pantry Pulse web app with filters, item cards, and a polished palette.',
    })

    const designDomain = intake.domains.find(domain => domain.id === 'design-quality')

    expect(designDomain).toMatchObject({
      title: 'Design quality',
      whyItMatters: expect.stringContaining('app-store-caliber'),
    })
    expect(designDomain?.openUnknowns.join('\n')).toContain('interaction patterns')
    expect(designDomain?.openUnknowns.join('\n')).toContain('palette')
  })

  it('does not inject UI design-quality questions into backend, CLI, or docs-only pressure tests', async () => {
    for (const scenario of [
      {
        target: { type: 'feature' as const, id: 'comments-api', title: 'Comments API' },
        rawRequest: 'Add a comment endpoint and prove membership checks.',
      },
      {
        target: { type: 'feature' as const, id: 'inspect-json', title: 'Inspect JSON output' },
        rawRequest: 'Add --json output to the inspect CLI command.',
      },
      {
        target: { type: 'task' as const, id: 'quick-start-warning', title: 'Quick start warning' },
        rawRequest: 'Clarify the install warning in the quick start.',
      },
    ]) {
      const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
      const intake = await createPressureTestIntake({
        memoryDir,
        target: scenario.target,
        rawRequest: scenario.rawRequest,
      })

      expect(intake.domains.map(domain => domain.id)).not.toContain('design-quality')
      expect(JSON.stringify(intake)).not.toMatch(/\b(component|palette|visual proof|browser)\b/i)
    }
  })

  it('keeps confused project-check-in answers pending instead of storing them as memory facts', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'project', id: 'generic-project-check-in', title: 'Generic project check-in' },
      rawRequest: 'Start a project check-in.',
    })

    const next = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: intake.pendingQuestion!.id,
      answer: "I don't understand the nature of the question.",
    })

    expect(next.status).toBe('active')
    expect(next.pendingQuestion?.id).toBe(intake.pendingQuestion?.id)
    expect(next.outputs.decisions).toEqual([])
    expect(next.outputs.projectQuestionPlanner?.inferredFacts.map(fact => fact.text).join('\n')).not.toContain(
      "I don't understand",
    )
    expect(next.outputs.projectQuestionPlanner?.discardedAnswers).toContainEqual(expect.objectContaining({
      questionId: intake.pendingQuestion?.id,
      reason: 'confused',
    }))
  })

  it('advances domains through closeout and records accepted answers as language-map candidates', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
      rawRequest: 'Pressure-test 0.8.0.',
    })

    const closeout = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: intake.pendingQuestion!.id,
      answer: 'Thread must show one active question with provenance before work starts.',
    })
    expect(closeout.pendingQuestion?.prompt).toContain('before we move to the next topic')
    expect(closeout.pendingQuestion?.prompt).not.toContain('domain closes')
    expect(closeout.pendingQuestion?.why).toContain('before leaving a topic')
    const nextDomain = await answerPressureTestQuestion({
      memoryDir,
      intakeId: closeout.id,
      questionId: closeout.pendingQuestion!.id,
      answer: 'No.',
    })

    expect(nextDomain.domains[0]).toMatchObject({
      status: 'closed',
      summary: expect.stringContaining('Thread must show one active question'),
    })
    expect(nextDomain.activeDomainId).toBe('workflows')
    expect(nextDomain.pendingQuestion?.domainId).toBe('workflows')
    expect(nextDomain.outputs.languageMapCandidates).toContainEqual(expect.stringContaining('Thread'))
  })

  it('normalizes persisted closeout questions away from internal domain wording', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'feature', id: 'fair-labor-license', title: 'Fair Labor License' },
      rawRequest: 'Project check-in needed.',
    })
    const closeout = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: intake.pendingQuestion!.id,
      answer: 'Make licensed software easier to fund.',
    })
    closeout.pendingQuestion!.prompt = 'Is there anything else Guildhall should know about product goals before this domain closes?'
    closeout.pendingQuestion!.why = 'Pressure-test intake closes each domain deliberately so hidden constraints do not vanish.'
    closeout.domains[0]!.askedQuestions.push({
      questionId: 'product-goals-closeout',
      prompt: 'Is there anything else Guildhall should know about product goals before this domain closes?',
      answered: false,
    })
    await writeProjectStateJsonAsync(memoryDir, path.join('pressure-test-intake', `${closeout.id}.json`), closeout)

    const loaded = await loadPressureTestIntake({ memoryDir, intakeId: closeout.id })

    expect(loaded.pendingQuestion?.prompt).toContain('before we move to the next topic')
    expect(loaded.pendingQuestion?.why).toContain('before leaving a topic')
    expect(loaded.domains[0]?.askedQuestions.at(-1)?.prompt).toContain('before we move to the next topic')
  })

  it('inspects project memory before asking questions', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await writeProjectStateTextAsync(
      memoryDir,
      'project-brief.md',
      'Thread is the command surface. Pressure-Test Intake should ask one question at a time.',
    )
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'feature', id: 'pressure-test', title: 'Pressure-Test Intake' },
      rawRequest: 'Make pressure-test intake real.',
    })

    const inspected = await inspectPressureTestEvidence({
      memoryDir,
      intakeId: intake.id,
      projectPath: path.dirname(memoryDir),
    })

    expect(inspected.domains[0]?.status).toBe('active')
    expect(inspected.domains.flatMap(domain => domain.knownFacts)).toContainEqual({
      fact: expect.stringContaining('Thread is the command surface'),
      source: 'memory/project-brief.md',
    })
    expect(inspected.pendingQuestion?.evidence).toContainEqual(expect.stringContaining('Thread is the command surface'))
  })
})
