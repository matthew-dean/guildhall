import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  answerPressureTestQuestion,
  createPressureTestIntake,
  inspectPressureTestEvidence,
  loadPressureTestIntake,
  pressureTestPath,
  renderPressureTestSpec,
} from '../pressure-test-intake.js'

describe('pressure-test intake state', () => {
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
    await mkdir(path.join(memoryDir, 'pressure-test-intake'), { recursive: true })
    await writeFile(
      path.join(memoryDir, 'pressure-test-intake', 'pti-commerce-project-0-9-0.json'),
      JSON.stringify({
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
      }),
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
      "What outcome would make this project successful?",
    )
  })

  it('repairs stale project check-in intakes whose title was copied from status text', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await mkdir(path.join(memoryDir, 'pressure-test-intake'), { recursive: true })
    await writeFile(
      path.join(memoryDir, 'pressure-test-intake', 'pti-project-check-in.json'),
      JSON.stringify({
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
      }),
    )

    const intake = await loadPressureTestIntake({ memoryDir, intakeId: 'pti-project-check-in' })

    expect(intake.target.title).toBe('Looma + Knit project check-in')
    expect(intake.pendingQuestion?.prompt).toBe(
      "What outcome would make this project successful?",
    )
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
    await writeFile(pressureTestPath(memoryDir, intake.id), JSON.stringify(intake, null, 2), 'utf-8')

    const answer = 'Should Guildhall remember? I guess it should be reader / writer friendly -- muted palette, clean lines, generous whitespace, minimalist'
    const next = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: 'design-quality-q-1',
      answer,
    })

    expect(next.pendingQuestion?.prompt).toBe(
      "What should a worker or reviewer be able to see before Guildhall treats this project's visual direction as met?",
    )
    expect(next.pendingQuestion?.prompt).not.toContain('Should Guildhall remember')
    expect(next.pendingQuestion?.prompt).not.toContain('muted palette')
    expect(next.pendingQuestion?.why).toBe('Workers and reviewers need visible proof, not just a taste adjective.')
  })

  it('repairs persisted injected follow-up prompts on load', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await mkdir(path.join(memoryDir, 'pressure-test-intake'), { recursive: true })
    await writeFile(
      path.join(memoryDir, 'pressure-test-intake', 'pti-narrative-harness-project-check-in.json'),
      JSON.stringify({
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
      }),
      'utf-8',
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
      target: { type: 'project', id: 'fair-labor-license', title: 'Fair Labor License' },
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
    await writeFile(pressureTestPath(memoryDir, closeout.id), JSON.stringify(closeout, null, 2), 'utf-8')

    const loaded = await loadPressureTestIntake({ memoryDir, intakeId: closeout.id })

    expect(loaded.pendingQuestion?.prompt).toContain('before we move to the next topic')
    expect(loaded.pendingQuestion?.why).toContain('before leaving a topic')
    expect(loaded.domains[0]?.askedQuestions.at(-1)?.prompt).toContain('before we move to the next topic')
  })

  it('inspects project memory before asking questions', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    await import('node:fs/promises').then(fs => fs.writeFile(
      path.join(memoryDir, 'project-brief.md'),
      'Thread is the command surface. Pressure-Test Intake should ask one question at a time.',
      'utf-8',
    ))
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
