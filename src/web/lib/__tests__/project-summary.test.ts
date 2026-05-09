import { describe, expect, it } from 'vitest'

import { summarizeProjects } from '../project-summary.js'
import type { ServiceDetail } from '../types.js'

describe('summarizeProjects', () => {
  it('shapes service payloads into card-friendly summaries', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'guildhall',
          name: 'Guildhall',
          path: '/work/guildhall',
          selected: true,
          taskCounts: { total: 10, active: 2, blocked: 1, done: 6, shelved: 1 },
          run: { status: 'running' },
        },
      ],
    }

    expect(summarizeProjects(service)).toEqual([
      {
        id: 'guildhall',
        name: 'Guildhall',
        path: '/work/guildhall',
        selected: true,
        statusLabel: 'Running here',
        tone: 'active',
        counts: { total: 10, active: 2, blocked: 1, done: 6, shelved: 1 },
        actionLabel: 'Open project',
        canOpen: true,
        canStart: false,
        canStop: true,
      },
    ])
  })

  it('treats unselected idle projects as switchable', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'looma',
          name: 'Looma',
          path: '/work/looma',
          selected: false,
          taskCounts: { total: 0, active: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Idle',
      tone: 'idle',
      actionLabel: 'Switch and open',
      canStart: true,
      canStop: false,
    })
  })

  it('treats uninitialized projects as setup-only entries', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'scratch-pad',
          name: 'scratch-pad',
          path: '/work/scratch-pad',
          initializationNeeded: true,
          selected: false,
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Needs setup',
      tone: 'warn',
      actionLabel: 'Switch and set up',
      canStart: false,
      canStop: false,
    })
  })
})
