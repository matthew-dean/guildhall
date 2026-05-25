import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  answerPressureTestQuestion,
  createPressureTestIntake,
  inspectPressureTestEvidence,
  loadPressureTestIntake,
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
    expect(next.pendingQuestion?.prompt).toContain('concrete')
    expect(next.domains[0]?.askedQuestions[0]).toMatchObject({
      answered: true,
      answer: 'It should feel rigorous but not annoying.',
    })
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
    expect(spec).toContain('Users type one broad request')
    expect(spec).toContain('Deferred domains are explicit')
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
