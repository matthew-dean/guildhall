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
          path: '/Users/matthew/work/guildhall',
          selected: true,
          tags: ['cli', 'orchestrator'],
          summary: 'Guildhall runs autonomous engineering workflows over local projects.',
          highlights: {
            activeTaskTitle: 'Restructure project service shell',
            recentCompletedTaskTitle: 'Publish 0.4.0',
          },
          taskCounts: { total: 10, active: 2, draftReview: 0, blocked: 1, done: 6, shelved: 1 },
          run: { status: 'running' },
        },
      ],
    }

    expect(summarizeProjects(service)).toEqual([
      {
        id: 'guildhall',
        name: 'Guildhall',
        path: '~/work/guildhall',
        statusLabel: 'Running',
        tone: 'active',
        stageLabel: 'Running',
        activityLabel: 'Agents are working on 2 tasks.',
        recentLabel: 'Working on: Restructure project service shell',
        blurb: 'Guildhall runs autonomous engineering workflows over local projects.',
        tags: ['cli', 'orchestrator'],
        counts: { total: 10, active: 2, draftReview: 0, blocked: 1, done: 6, shelved: 1 },
        ticker: {
          tone: 'active',
          pulse: true,
          label: 'Live',
          message: 'Restructure project service shell',
        },
        actionLabel: 'Open project',
        runActionLabel: 'Stop',
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
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Ready',
      tone: 'idle',
      stageLabel: 'Ready',
      activityLabel: 'No task activity yet.',
      ticker: {
        tone: 'idle',
        pulse: false,
        label: 'Idle',
        message: 'No recent activity',
      },
      actionLabel: 'Open project',
      runActionLabel: 'Start',
      canStart: true,
      canStop: false,
    })
  })

  it('normalizes Windows user-profile project paths for display', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'guildhall',
          name: 'Guildhall',
          path: 'C:\\Users\\Matthew\\git\\oss\\guildhall',
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]?.path).toBe('~/git/oss/guildhall')
  })

  it('treats uninitialized projects as setup-only entries', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'scratch-pad',
          name: 'scratch-pad',
          path: '/work/scratch-pad',
          initializationNeeded: true,
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      name: 'Scratch pad',
      statusLabel: 'Needs setup',
      tone: 'warn',
      stageLabel: 'Needs setup',
      activityLabel: 'Needs first-time Guildhall setup.',
      ticker: {
        tone: 'warn',
        pulse: false,
        label: 'Setup',
        message: 'First-time Guildhall setup',
      },
      actionLabel: 'Open setup',
      runActionLabel: null,
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
          taskCounts: { total: 8, active: 0, draftReview: 0, blocked: 1, done: 6, shelved: 1 },
          highlights: { blockedTaskTitle: 'Repair staging auth flow' },
          run: { status: 'stopped' },
        },
        {
          id: 'looma',
          name: 'Looma',
          path: '/work/looma',
          taskCounts: { total: 4, active: 0, draftReview: 0, blocked: 0, done: 4, shelved: 0 },
          highlights: { recentCompletedTaskTitle: 'Audit primitive integration' },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Needs attention',
      stageLabel: 'Needs attention',
      activityLabel: '1 blocked task needs attention.',
      recentLabel: 'Blocked on: Repair staging auth flow',
      runActionLabel: 'Start',
    })
    expect(summarizeProjects(service)[1]).toMatchObject({
      statusLabel: 'Stable',
      stageLabel: 'Stable',
      activityLabel: '4 of 4 tasks are done.',
      recentLabel: 'Recently completed: Audit primitive integration',
      runActionLabel: 'Start',
    })
  })

  it('treats stopped projects with unfinished active work as paused', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 't-minus-t',
          name: 't-minus-t',
          path: '/work/t-minus-t',
          taskCounts: { total: 3, active: 1, draftReview: 0, blocked: 0, done: 2, shelved: 0 },
          highlights: { activeTaskTitle: 'Build TypeScript-JSDoc round-trip conversion' },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Paused',
      stageLabel: 'Paused',
      activityLabel: '1 task is paused.',
      recentLabel: 'Working on: Build TypeScript-JSDoc round-trip conversion',
      runActionLabel: 'Start',
    })
  })

  it('treats imported drafts as task-brief work instead of paused execution', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/work/looma-knit',
          taskCounts: { total: 89, active: 0, draftReview: 75, blocked: 0, done: 14, shelved: 0 },
          run: {
            status: 'stopped',
            stopSummary: {
              stopReason: 'awaiting_human',
              stopMessage: 'No runnable tasks remain right now: 75 draft task(s) waiting for review.',
            },
          },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Needs task briefs',
      stageLabel: 'Needs task briefs',
      activityLabel: '75 imported drafts need task briefs.',
      counts: { total: 89, active: 0, draftReview: 75, blocked: 0, done: 14, shelved: 0 },
      ticker: {
        tone: 'warn',
        pulse: false,
        label: 'Needs task briefs',
        message: '75 imported drafts waiting',
      },
      canStart: false,
      canStop: false,
    })
  })
})
