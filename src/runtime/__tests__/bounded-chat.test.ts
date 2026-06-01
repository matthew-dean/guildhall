import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyBoundedChatCoordinatorAction,
  createBoundedChatSession,
  getNextBoundedChatPrompt,
  loadBoundedChatSession,
  submitBoundedChatUserResponse,
} from '../bounded-chat.js'
import {
  answerProjectCheckInBoundedChat,
  createProjectCheckInBoundedChat,
  resumeProjectCheckInBoundedChat,
} from '../bounded-chat-project-check-in.js'

describe('bounded chat runtime contract', () => {
  it('creates a session and returns the first user prompt', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    const session = await createBoundedChatSession({
      memoryDir,
      projectId: 'narrative-harness',
      source: 'thread:new-request',
      objective: {
        kind: 'new_request',
        label: 'Shape a new request',
        successCriteria: ['Capture the request clearly enough to decide the next action.'],
      },
      initialSubObjective: {
        id: 'request-shape',
        objective: 'Understand the user request',
        prompt: 'What should Guildhall help with first?',
        choices: ['Shape a task', 'Answer a question', 'Change a setting'],
      },
    })

    expect(session.status).toBe('waiting_for_owner')
    const prompt = await getNextBoundedChatPrompt({ memoryDir, sessionId: session.id })
    expect(prompt).toEqual({
      kind: 'ask_user',
      sessionId: session.id,
      subObjectiveId: 'request-shape',
      prompt: 'What should Guildhall help with first?',
      choices: ['Shape a task', 'Answer a question', 'Change a setting'],
      helperText: undefined,
    })
  })

  it('records the user response and waits for coordinator review', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    const session = await createBoundedChatSession({
      memoryDir,
      projectId: 'guildhall',
      source: 'settings:intake',
      objective: {
        kind: 'project_intake',
        label: 'Run project intake',
        successCriteria: ['Capture the main project direction.'],
      },
      initialSubObjective: {
        id: 'direction',
        objective: 'Capture project direction',
        prompt: 'What should Guildhall optimize for first?',
      },
    })

    const updated = await submitBoundedChatUserResponse({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: 'direction',
      response: 'Trustworthy project-state recovery before autonomy.',
    })

    expect(updated.status).toBe('coordinator_review')
    expect(updated.subObjectives[0]?.localTurns).toEqual([
      {
        role: 'user',
        content: 'Trustworthy project-state recovery before autonomy.',
        selectedChoiceIds: [],
      },
    ])
  })

  it('applies a follow-up action and reopens the same sub-objective for the user', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    const session = await createBoundedChatSession({
      memoryDir,
      projectId: 'guildhall',
      source: 'thread:new-request',
      objective: {
        kind: 'new_request',
        label: 'Shape a new request',
        successCriteria: ['Narrow the request enough to choose the next path.'],
      },
      initialSubObjective: {
        id: 'request-shape',
        objective: 'Understand the user request',
        prompt: 'What should Guildhall help with first?',
      },
    })
    const afterResponse = await submitBoundedChatUserResponse({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: 'request-shape',
      response: 'Make the intake smarter.',
    })

    const reopened = await applyBoundedChatCoordinatorAction({
      memoryDir,
      sessionId: session.id,
      expectedUpdatedAt: afterResponse.updatedAt,
      action: {
        actionId: 'act-follow-up-1',
        type: 'ask_follow_up',
        subObjectiveId: 'request-shape',
        prompt: 'What would prove the intake is smarter?',
        helperText: 'Name one visible outcome.',
      },
    })

    expect(reopened.status).toBe('waiting_for_owner')
    expect(reopened.subObjectives[0]).toMatchObject({
      id: 'request-shape',
      followUpDepth: 1,
      prompt: 'What would prove the intake is smarter?',
      helperText: 'Name one visible outcome.',
      status: 'active',
    })
  })

  it('closes a session with a durable receipt and keeps close actions idempotent', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    const session = await createBoundedChatSession({
      memoryDir,
      projectId: 'guildhall',
      source: 'thread:new-request',
      objective: {
        kind: 'setting_update',
        label: 'Update one setting',
        successCriteria: ['Apply the requested setting change.'],
      },
      initialSubObjective: {
        id: 'setting-change',
        objective: 'Confirm the setting change',
        prompt: 'Which setting should change?',
      },
    })
    const afterResponse = await submitBoundedChatUserResponse({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: 'setting-change',
      response: 'Switch to guided OpenRouter setup.',
    })

    const closed = await applyBoundedChatCoordinatorAction({
      memoryDir,
      sessionId: session.id,
      expectedUpdatedAt: afterResponse.updatedAt,
      action: {
        actionId: 'act-close-1',
        type: 'close_session',
        outcome: 'fulfilled',
        summary: 'Guildhall recorded the requested setting change.',
        settingUpdates: ['provider.openrouter.guided=true'],
        facts: ['The owner wants guided OpenRouter setup.'],
      },
    })

    expect(closed.status).toBe('fulfilled')
    expect(closed.closure).toMatchObject({
      outcome: 'fulfilled',
      summary: 'Guildhall recorded the requested setting change.',
      settingUpdates: ['provider.openrouter.guided=true'],
    })
    expect(closed.acceptedState.facts).toContainEqual({
      fact: 'The owner wants guided OpenRouter setup.',
      sourceSubObjectiveId: 'setting-change',
    })

    const idempotent = await applyBoundedChatCoordinatorAction({
      memoryDir,
      sessionId: session.id,
      action: {
        actionId: 'act-close-1',
        type: 'close_session',
        outcome: 'fulfilled',
        summary: 'Guildhall recorded the requested setting change.',
      },
    })
    expect(idempotent).toEqual(closed)

    const prompt = await getNextBoundedChatPrompt({ memoryDir, sessionId: session.id })
    expect(prompt).toEqual({
      kind: 'done',
      sessionId: session.id,
      receipt: closed.closure,
    })
  })

  it('closes a session as blocked with a next action', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    const session = await createBoundedChatSession({
      memoryDir,
      projectId: 'fair-labor-license',
      source: 'thread:recovery',
      objective: {
        kind: 'capability_decision',
        label: 'Resolve a capability blocker',
        successCriteria: ['Choose the safe next step.'],
      },
      initialSubObjective: {
        id: 'capability-choice',
        objective: 'Resolve the missing capability',
        prompt: 'Should Guildhall request access or stop here?',
      },
    })
    const afterResponse = await submitBoundedChatUserResponse({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: 'capability-choice',
      response: 'Request access.',
    })

    await applyBoundedChatCoordinatorAction({
      memoryDir,
      sessionId: session.id,
      expectedUpdatedAt: afterResponse.updatedAt,
      action: {
        actionId: 'act-block-1',
        type: 'block_session',
        reason: 'Guildhall cannot continue without explicit host approval.',
        nextActionLabel: 'Request access',
        nextActionHref: '/settings/capabilities',
      },
    })

    const prompt = await getNextBoundedChatPrompt({ memoryDir, sessionId: session.id })
    expect(prompt).toEqual({
      kind: 'blocked',
      sessionId: session.id,
      receipt: expect.objectContaining({
        outcome: 'blocked',
        nextActionLabel: 'Request access',
        nextActionHref: '/settings/capabilities',
      }),
    })
  })

  it('rejects stale coordinator writes', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    const session = await createBoundedChatSession({
      memoryDir,
      projectId: 'guildhall',
      source: 'thread:new-request',
      objective: {
        kind: 'new_request',
        label: 'Shape a new request',
        successCriteria: ['Capture the request clearly.'],
      },
      initialSubObjective: {
        id: 'request-shape',
        objective: 'Understand the request',
        prompt: 'What should Guildhall help with first?',
      },
    })
    const afterResponse = await submitBoundedChatUserResponse({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: 'request-shape',
      response: 'Start bounded chat.',
    })

    await expect(applyBoundedChatCoordinatorAction({
      memoryDir,
      sessionId: session.id,
      expectedUpdatedAt: session.updatedAt,
      action: {
        actionId: 'act-stale-1',
        type: 'close_session',
        outcome: 'fulfilled',
        summary: 'Stale write should fail.',
      },
    })).rejects.toThrow('stale bounded chat session')

    const loaded = await loadBoundedChatSession({ memoryDir, sessionId: session.id })
    expect(loaded.updatedAt).toBe(afterResponse.updatedAt)
    expect(loaded.status).toBe('coordinator_review')
  })
})

describe('project check-in bounded chat adapter', () => {
  it('creates a bounded chat session from project evidence', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    await writeFile(path.join(memoryDir, 'project-brief.md'), [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
    ].join('\n'))

    const session = await createProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })

    expect(session.objective.kind).toBe('project_check_in')
    expect(session.status).toBe('waiting_for_owner')
    expect(session.subObjectives[0]).toMatchObject({
      id: 'project-direction-priority',
      prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
      choices: [
        'Reviewer-lane MVPs',
        'Author-facing editor UX',
        'Story-memory/schema foundations',
        'Generation/evaluation loops',
      ],
    })
  })

  it('turns an ambiguous answer into a bounded follow-up question', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    await writeFile(path.join(memoryDir, 'project-brief.md'), [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
    ].join('\n'))
    const session = await createProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })

    const updated = await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: session.subObjectives[0]!.id,
      response: 'Probably reviewer stuff, but only if it helps us know whether a novel is actually good.',
    })

    expect(updated.status).toBe('waiting_for_owner')
    expect(updated.subObjectives[0]).toMatchObject({
      id: 'project-direction-priority',
      followUpDepth: 1,
      prompt: 'Should reviewer-lane MVPs judge internal story coherence, reader engagement, author voice preservation, or all three?',
    })
  })

  it('keeps asking planned root questions until the intake plan is exhausted', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    await writeFile(path.join(memoryDir, 'project-brief.md'), [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
      'The UI should feel quiet and commercially credible.',
    ].join('\n'))

    const session = await createProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })

    const afterDirection = await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: session.subObjectives[0]!.id,
      response: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
    })

    expect(afterDirection.status).toBe('waiting_for_owner')
    expect(afterDirection.subObjectives.map(item => item.id)).toContain('visual-direction-mode')
    expect(afterDirection.activeSubObjectiveId).toBe('visual-direction-mode')
    const next = afterDirection.subObjectives.find(item => item.id === 'visual-direction-mode')
    expect(next).toMatchObject({
      status: 'active',
      prompt: 'Should Narrative Harness feel more like a calm writing desk, a professional editorial tool, or an analytical story-debugging cockpit?',
    })

    const finished = await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: session.id,
      subObjectiveId: 'visual-direction-mode',
      response: 'Professional editorial tool.',
    })

    expect(finished.status).toBe('fulfilled')
    expect(finished.closure).toMatchObject({
      outcome: 'fulfilled',
      summary: 'Guildhall recorded the project check-in direction.',
    })
    expect(finished.acceptedState.decisions.map(item => item.decision)).toEqual([
      'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
      'Professional editorial tool.',
    ])
  })

  it('persists the completed intake answers so the stored session matches what the user said', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    await writeFile(path.join(memoryDir, 'project-brief.md'), [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
      'The UI should feel quiet and commercially credible.',
    ].join('\n'))

    const started = await createProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })
    await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: started.id,
      subObjectiveId: started.subObjectives[0]!.id,
      response: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
    })
    await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: started.id,
      subObjectiveId: 'visual-direction-mode',
      response: 'Professional editorial tool.',
    })

    const stored = JSON.parse(
      await readFile(path.join(memoryDir, 'bounded-chat', `${started.id}.json`), 'utf-8'),
    ) as {
      status: string
      plannerState?: {
        projectCheckIn?: {
          answeredQuestions?: Array<{ questionId: string; answer: string }>
        }
      }
      acceptedState?: {
        decisions?: Array<{ decision: string; sourceSubObjectiveId: string }>
      }
      closure?: { outcome?: string; summary?: string }
    }

    expect(stored.status).toBe('fulfilled')
    expect(stored.plannerState?.projectCheckIn?.answeredQuestions).toEqual([
      {
        questionId: 'project-direction-priority',
        prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
        answer: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
      },
      {
        questionId: 'visual-direction-mode',
        prompt: 'Should Narrative Harness feel more like a calm writing desk, a professional editorial tool, or an analytical story-debugging cockpit?',
        answer: 'Professional editorial tool.',
      },
    ])
    expect(stored.acceptedState?.decisions).toEqual([
      {
        decision: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
        sourceSubObjectiveId: 'project-direction-priority',
      },
      {
        decision: 'Professional editorial tool.',
        sourceSubObjectiveId: 'visual-direction-mode',
      },
    ])
    expect(stored.closure).toMatchObject({
      outcome: 'fulfilled',
      summary: 'Guildhall recorded the project check-in direction.',
    })
  })

  it('records confused answers as discarded and keeps the same question open', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    await writeFile(path.join(memoryDir, 'project-brief.md'), [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
    ].join('\n'))

    const started = await createProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })

    const updated = await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: started.id,
      subObjectiveId: started.subObjectives[0]!.id,
      response: "I don't understand the nature of the question.",
    })

    expect(updated.status).toBe('waiting_for_owner')
    expect(updated.activeSubObjectiveId).toBe('project-direction-priority')
    expect(updated.subObjectives[0]).toMatchObject({
      id: 'project-direction-priority',
      status: 'active',
      prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
    })
    expect(updated.acceptedState.discardedResponses).toEqual([
      {
        subObjectiveId: 'project-direction-priority',
        reason: 'confused',
        response: "I don't understand the nature of the question.",
      },
    ])
    expect(updated.acceptedState.decisions).toEqual([])
  })

  it('reuses the same active project check-in session when the user comes back later', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-bounded-chat-'))
    await writeFile(path.join(memoryDir, 'project-brief.md'), [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
      'The UI should feel quiet and commercially credible.',
    ].join('\n'))

    const started = await createProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })
    await answerProjectCheckInBoundedChat({
      memoryDir,
      sessionId: started.id,
      subObjectiveId: started.subObjectives[0]!.id,
      response: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
    })

    const resumed = await resumeProjectCheckInBoundedChat({
      memoryDir,
      projectId: 'narrative-harness',
      projectName: 'Narrative Harness',
    })

    expect(resumed.id).toBe(started.id)
    expect(resumed.status).toBe('waiting_for_owner')
    expect(resumed.activeSubObjectiveId).toBe('visual-direction-mode')
    expect(resumed.subObjectives.find(item => item.id === 'visual-direction-mode')).toMatchObject({
      status: 'active',
      prompt: 'Should Narrative Harness feel more like a calm writing desk, a professional editorial tool, or an analytical story-debugging cockpit?',
    })
  })
})
