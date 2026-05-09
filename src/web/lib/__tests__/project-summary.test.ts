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
          tags: ['cli', 'orchestrator'],
          summary: 'Guildhall runs autonomous engineering workflows over local projects.',
          highlights: {
            activeTaskTitle: 'Restructure project service shell',
            recentCompletedTaskTitle: 'Publish 0.4.0',
          },
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
        stageLabel: 'In progress',
        activityLabel: 'Agents are working on 2 active tasks.',
        recentLabel: 'Working on: Restructure project service shell',
        blurb: 'Guildhall runs autonomous engineering workflows over local projects.',
        tags: ['cli', 'orchestrator'],
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
      stageLabel: 'Ready to start',
      activityLabel: 'No task activity yet.',
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
      stageLabel: 'Needs setup',
      activityLabel: 'Attached folder waiting for first-time Guildhall setup.',
      actionLabel: 'Switch and set up',
      canStart: false,
      canStop: false,
    })
  })

  it('surfaces blocked or recently completed work in a human summary', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'knit',
          name: 'Knit',
          path: '/work/knit',
          taskCounts: { total: 8, active: 0, blocked: 1, done: 6, shelved: 1 },
          highlights: { blockedTaskTitle: 'Repair staging auth flow' },
          run: { status: 'stopped' },
        },
        {
          id: 'looma',
          name: 'Looma',
          path: '/work/looma',
          taskCounts: { total: 4, active: 0, blocked: 0, done: 4, shelved: 0 },
          highlights: { recentCompletedTaskTitle: 'Audit primitive integration' },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      stageLabel: 'Blocked',
      activityLabel: '1 blocked task needs attention.',
      recentLabel: 'Blocked on: Repair staging auth flow',
    })
    expect(summarizeProjects(service)[1]).toMatchObject({
      stageLabel: 'Stable',
      activityLabel: '4 of 4 tasks are done.',
      recentLabel: 'Recently completed: Audit primitive integration',
    })
  })
})
