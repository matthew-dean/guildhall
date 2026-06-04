import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBoundedChatSessions } from '../bounded-chat.js'
import { createOwnerInputRequest, listOwnerInputRequests } from '../owner-input-store.js'

const now = '2026-06-01T12:00:00.000Z'

describe('owner input requests', () => {
  it('creates one linked bounded-chat session for a task question source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-'))
    const first = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-1:q1',
      now,
      actor: 'migration',
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      target: { kind: 'thread' },
      question: {
        kind: 'choice',
        prompt: 'Which billing policy should Guildhall follow?',
        choices: ['A', 'B'],
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify billing policy',
        successCriteria: ['Owner chooses the billing policy.'],
      },
    })

    const second = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-1:q1',
      now,
      actor: 'migration',
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      target: { kind: 'thread' },
      question: {
        kind: 'choice',
        prompt: 'Which billing policy should Guildhall follow?',
        choices: ['A', 'B'],
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify billing policy',
        successCriteria: ['Owner chooses the billing policy.'],
      },
    })

    expect(second.created).toBe(false)
    expect(second.request.id).toBe(first.request.id)
    expect(second.session.id).toBe(first.session.id)

    const requests = await listOwnerInputRequests(root)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      boundedChatSessionId: first.session.id,
      status: 'waiting_for_owner',
    })

    const sessions = listBoundedChatSessions(path.join(root, '.guildhall'))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: first.session.id,
      status: 'waiting_for_owner',
      transitionReceipts: [
        expect.objectContaining({
          machineId: 'bounded-chat',
          event: 'wait_for_owner',
          to: 'waiting_for_owner',
        }),
      ],
    })
  })

  it('persists structured owner questions without prose recovery heuristics', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-structured-'))
    const result = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-alert:q1',
      now,
      actor: 'spec-agent',
      source: { kind: 'task', taskId: 'task-alert', questionId: 'q1' },
      target: { kind: 'thread' },
      question: {
        kind: 'text',
        prompt: 'What variants does AlertDialog need?',
        subject: 'AlertDialog variants',
        description: 'The roadmap lists AlertDialog as missing (P0 gap). The existing `ui-dialog` uses `<dialog>`.',
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify AlertDialog',
        successCriteria: ['Owner answers the linked bounded chat.'],
      },
    })

    expect(result.request.prompt).toBe('What variants does AlertDialog need?')
    expect(result.session.subObjectives[0]).toMatchObject({
      prompt: 'What variants does AlertDialog need?',
      helperText: 'The roadmap lists AlertDialog as missing (P0 gap). The existing `ui-dialog` uses `<dialog>`.',
    })
  })

  it('preserves multiple-choice owner-input selection mode in the linked bounded chat', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-multiple-'))
    const result = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-meta-intake:q1',
      now,
      actor: 'migration',
      source: { kind: 'task', taskId: 'task-meta-intake', questionId: 'q1' },
      target: { kind: 'thread' },
      question: {
        kind: 'choice',
        prompt: 'This is a meta-intake task — I need to:',
        choices: [
          'Infer the project routing slices',
          'Bootstrap verification',
          'Draft starter tasks',
        ],
        selectionMode: 'multiple',
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify setup',
        successCriteria: ['Owner chooses every setup step that applies.'],
      },
    })

    expect(result.request.selectionMode).toBe('multiple')
    const sessions = listBoundedChatSessions(path.join(root, '.guildhall'))
    expect(sessions[0]?.subObjectives[0]).toMatchObject({
      prompt: 'This is a meta-intake task — I need to:',
      selectionMode: 'multiple',
    })
  })

  it('rejects agent planning narration instead of extracting a fake question at creation time', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-invalid-'))
    await expect(createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-alert:q1',
      now,
      actor: 'spec-agent',
      source: { kind: 'task', taskId: 'task-alert', questionId: 'q1' },
      target: { kind: 'thread' },
      prompt: 'I have enough context. The roadmap lists AlertDialog as missing (P0 gap).\n\nThe key question I need to ask before drafting: what variants does the user need? Let me write the product brief first, then ask.',
      objective: {
        kind: 'task_shaping',
        label: 'Clarify AlertDialog',
        successCriteria: ['Owner answers the linked bounded chat.'],
      },
    })).rejects.toThrow(/not an answerable user question/)
  })

  it.each([
    [{ kind: 'structural_map', mapId: 'draft', questionId: 'confirm-domain-routing' }],
    [{ kind: 'project_graph', edgeId: 'edge-1', questionId: 'assign-authority' }],
    [{ kind: 'capability_request', requestId: 'cap-1', questionId: 'grant-or-deny' }],
    [{ kind: 'request_intake', intakeId: 'intake-1', questionId: 'clarify-scope' }],
    [{ kind: 'project_check_in', checkInId: 'project', questionId: 'direction' }],
    [{ kind: 'recovery_decision', taskId: 'task-1', escalationId: 'esc-1' }],
    [{ kind: 'settings', settingId: 'provider' }],
  ] as const)('supports source %j without inventing a local question model', async (source) => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-source-'))
    const result = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: `${source.kind}:source-test`,
      now,
      actor: 'test',
      source,
      target: { kind: 'thread' },
      question: { prompt: 'What should Guildhall do next?' },
      objective: {
        kind: 'task_shaping',
        label: 'Owner decision',
        successCriteria: ['Owner answers the linked bounded chat.'],
      },
    })
    expect(result.request.boundedChatSessionId).toBe(result.session.id)
    expect(result.request.status).toBe('waiting_for_owner')
  })
})
