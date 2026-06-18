import { describe, expect, it } from 'vitest'
import { routeRequest } from '../request-routing.js'

describe('routeRequest', () => {
  it('routes release ideas to pressure-test intake', () => {
    const result = routeRequest({
      raw: 'I have ideas for Guildhall 0.8.0. Pressure-test intake is my top priority.',
      source: 'thread',
      routeContext: { projectId: 'guildhall', route: '/projects/guildhall/thread' },
    })

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      kind: 'pressure_test_intake',
      intakeTarget: {
        type: 'release',
        title: 'Guildhall 0.8.0',
        pressureTestRequired: true,
      },
      requiresConfirmation: false,
    })
    expect(result.routingDecision.reason).toContain('release')
  })

  it('keeps the named project on versioned pressure-test requests', () => {
    const result = routeRequest({
      raw: 'Pressure-test Commerce Project 0.9.0 checkout wording assumptions.',
      source: 'thread',
      routeContext: { projectId: 'commerce-project', route: '/projects/commerce-project/thread' },
    })

    expect(result.actions[0]).toMatchObject({
      kind: 'pressure_test_intake',
      intakeTarget: {
        type: 'release',
        title: 'Commerce Project 0.9.0',
      },
    })
  })

  it('keeps a small concrete implementation ask on the task path while still requiring pressure testing', () => {
    const result = routeRequest({
      raw: 'Add a loading spinner to the Providers page.',
      source: 'modal',
      routeContext: { projectId: 'guildhall', route: '/projects/guildhall/settings' },
    })

    expect(result.actions[0]).toMatchObject({
      kind: 'task_spec',
      intakeTarget: {
        type: 'task',
        pressureTestRequired: true,
        nextStep: 'task-intake',
      },
    })
  })

  it('routes questions as read-only project questions', () => {
    const result = routeRequest({
      raw: 'Why is this project still blocked on useAuth.ts?',
      source: 'thread',
      routeContext: { projectId: 'fair-labor-license', route: '/projects/fair-labor-license/thread' },
    })

    expect(result.actions[0]).toMatchObject({
      kind: 'project_question',
      safety: 'read-only',
    })
  })

  it('keeps routed action labels complete instead of pre-cropping data strings', () => {
    const raw = 'What commands should I run to smoke test this project without changing files?'
    const result = routeRequest({
      raw,
      source: 'thread',
      routeContext: { projectId: 'narrative-harness', route: '/projects/narrative-harness/thread' },
    })

    expect(result.actions[0]).toMatchObject({
      kind: 'project_question',
      label: raw,
      intakeTarget: { title: raw },
    })
    expect(result.actions[0]?.label).not.toContain('...')
  })

  it('classifies settings, persona/practice, repair, and clarification requests', () => {
    expect(routeRequest({
      raw: 'Turn on strict reviewer fanout for this project.',
      source: 'thread',
      routeContext: { projectId: 'guildhall' },
    }).actions[0]).toMatchObject({
      kind: 'settings_proposal',
      safety: 'project-write',
      intakeTarget: { pressureTestRequired: true },
      requiresConfirmation: false,
    })

    expect(routeRequest({
      raw: 'Create a Copywriter practice that reviews every public doc change.',
      source: 'thread',
      routeContext: { projectId: 'guildhall' },
    }).actions[0]).toMatchObject({
      kind: 'persona_practice_proposal',
      intakeTarget: { pressureTestRequired: true, nextStep: 'proposal-review' },
    })

    expect(routeRequest({
      raw: 'Fix the broken project import wizard.',
      source: 'thread',
      routeContext: { projectId: 'guildhall' },
    }).actions[0]).toMatchObject({
      kind: 'repair_triage',
      intakeTarget: { pressureTestRequired: true, nextStep: 'repair-triage' },
    })

    expect(routeRequest({
      raw: 'Maybe improve the thing.',
      source: 'thread',
      routeContext: { projectId: 'guildhall' },
    }).actions[0]).toMatchObject({
      kind: 'clarification',
      safety: 'read-only',
    })
  })

  it('splits multi-intent requests into reviewable routed actions', () => {
    const result = routeRequest({
      raw: 'Pressure-test 0.8.0 and fix the broken Thread card and add a Security Reviewer persona.',
      source: 'thread',
      routeContext: { projectId: 'guildhall' },
    })

    expect(result.actions.map(action => action.kind)).toEqual([
      'pressure_test_intake',
      'repair_triage',
      'persona_practice_proposal',
    ])
    expect(result.routingDecision.split).toMatchObject({
      required: true,
      reviewable: true,
    })
    expect(result.routingDecision.reason).toContain('multi-intent')
  })

  it('reuses existing relevant cards before creating duplicates', () => {
    const result = routeRequest({
      raw: 'Fix the broken Thread card.',
      source: 'thread',
      routeContext: { projectId: 'guildhall' },
      existingActions: [{
        id: 'card-thread-repair',
        kind: 'repair_triage',
        label: 'Fix broken Thread card rendering',
      }],
    })

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      id: 'card-thread-repair',
      reuse: {
        existingActionId: 'card-thread-repair',
        reason: expect.stringContaining('similar'),
      },
    })
    expect(result.routingDecision.matchedSignals).toContain('existing_card_reuse')
  })
})
