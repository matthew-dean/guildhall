import { describe, expect, it } from 'vitest'

import { createProjectSummaryCache, summarizeProjects } from '../project-summary.js'
import type { ServiceDetail } from '../types.js'

describe('summarizeProjects', () => {
  it('reuses unchanged project card summaries across material project refreshes', () => {
    const cache = createProjectSummaryCache()
    const service: ServiceDetail = {
      projects: [
        {
          id: 'looma',
          name: 'Looma',
          path: '/work/looma',
          taskCounts: { total: 3, active: 1, draftReview: 0, blocked: 0, done: 2, shelved: 0 },
          highlights: { activeTaskTitle: 'Build editor chrome' },
          run: { status: 'stopped' },
        },
        {
          id: 'knit',
          name: 'Knit',
          path: '/work/knit',
          taskCounts: { total: 4, active: 0, draftReview: 0, blocked: 0, done: 4, shelved: 0 },
          highlights: { recentCompletedTaskTitle: 'Ship project palette' },
          run: { status: 'stopped' },
        },
      ],
    }

    const initial = cache.summarize(service)
    const refreshed = cache.summarize({
      ...service,
      projects: [
        {
          ...service.projects[0]!,
          taskCounts: { total: 3, active: 2, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
          highlights: { activeTaskTitle: 'Build editor toolbar' },
        },
        structuredClone(service.projects[1]!),
      ],
    })

    expect(refreshed[0]).not.toBe(initial[0])
    expect(refreshed[0]).toMatchObject({
      id: 'looma',
      counts: { active: 2 },
      recentLabel: 'Working on: Build editor toolbar',
    })
    expect(refreshed[1]).toBe(initial[1])
  })

  it('updates project summaries when their default-provider signature changes', () => {
    const cache = createProjectSummaryCache()
    const service: ServiceDetail = {
      defaultProviderStatus: {
        preferredProvider: 'openai-api',
        preferredProviderLabel: 'OpenAI-compatible API',
        activeModel: 'gpt-5.3-codex',
        models: { worker: 'gpt-5.3-codex' },
      },
      projects: [
        {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          path: '/work/narrative-harness',
          taskCounts: { total: 2, active: 1, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
          run: { status: 'stopped' },
          providerStatus: {
            preferredProvider: 'openai-api',
            preferredProviderLabel: 'OpenAI-compatible API',
            activeModel: 'gpt-5.3-codex',
            models: { worker: 'gpt-5.3-codex' },
          },
        },
      ],
    }

    const initial = cache.summarize(service)
    const refreshed = cache.summarize({
      ...service,
      defaultProviderStatus: {
        preferredProvider: 'anthropic-api',
        preferredProviderLabel: 'Anthropic API',
        activeModel: 'claude-4.5-sonnet',
        models: { worker: 'claude-4.5-sonnet' },
      },
      projects: [structuredClone(service.projects[0]!)],
    })

    expect(refreshed[0]).not.toBe(initial[0])
    expect(refreshed[0]?.provider).toMatchObject({
      label: 'OpenAI-compatible API',
      tone: 'neutral',
    })
  })

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
          taskActivity: {
            windowLabel: 'Last 30 days',
            max: 3,
            bars: [
              { value: 0, label: 'No updates' },
              { value: 3, label: '3 task updates, May 1-May 2' },
            ],
          },
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
        completedLabel: 'Publish 0.4.0',
        nextLabel: 'In progress: Restructure project service shell',
        maturityLabel: 'Inspect',
        maturityDescription: 'Some work needs triage before the project is flowing cleanly.',
        blurb: 'Guildhall runs autonomous engineering workflows over local projects.',
        tags: ['cli', 'orchestrator'],
        gitStory: null,
        counts: { total: 10, active: 2, draftReview: 0, blocked: 1, done: 6, shelved: 1 },
        taskActivity: {
          windowLabel: 'Last 30 days',
          max: 3,
          bars: [
            { value: 0, label: 'No updates' },
            { value: 3, label: '3 task updates, May 1-May 2' },
          ],
        },
        ticker: {
          tone: 'active',
          pulse: true,
          label: 'Live',
          message: 'Restructure project service shell',
        },
        actionLabel: 'Open project',
        runActionLabel: 'Pause',
        canOpen: true,
        canStart: false,
        canStop: true,
        statusLoading: false,
        needsAttention: true,
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
      maturityLabel: 'Intake',
      maturityDescription: 'The project is registered, but does not yet have a meaningful task map.',
      ticker: {
        tone: 'idle',
        pulse: false,
        label: 'Idle',
        message: 'No recent activity',
      },
      actionLabel: 'Open project',
      runActionLabel: 'Start intake',
      canStart: true,
      canStop: false,
      needsAttention: false,
    })
    expect(summarizeProjects(service)[0]?.taskActivity).toMatchObject({
      windowLabel: 'Last 30 days',
      max: 0,
    })
    expect(summarizeProjects(service)[0]?.taskActivity.bars).toHaveLength(18)
  })

  it('prioritizes project questions in card summaries without saying deep intake', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'older-project',
          name: 'Older Project',
          path: '/work/older-project',
          taskCounts: { total: 2, active: 0, draftReview: 0, blocked: 0, done: 2, shelved: 0 },
          projectCheckIn: {
            needed: true,
            label: 'Project questions',
            title: 'Project check-in needed',
            detail: 'Answer the first project questions so Guildhall has the newer project context.',
            actionHref: '/thread',
          },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      statusLabel: 'Project questions',
      tone: 'warn',
      stageLabel: 'Project questions',
      activityLabel: 'Project check-in needed.',
      nextLabel: 'Answer project questions',
      maturityLabel: 'Check-in',
      maturityDescription: expect.not.stringContaining('deep intake'),
      projectCheckIn: {
        needed: true,
        label: 'Project questions',
      },
    })
  })

  it('uses the cached project action model for card next steps and start gating', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'commerce',
          name: 'Commerce Project',
          path: '/work/commerce',
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped' },
          startReadiness: { canStart: true },
          actionModel: {
            primaryAction: {
              source: 'owner_input',
              label: 'Answer in Thread',
              detail: 'Shape the first spec before Guildhall creates work.',
              buttonLabel: 'Open Thread',
              href: '/thread',
              tone: 'warn',
            },
            secondaryActions: [],
            runControl: {
              label: 'Waiting on setup',
              startEnabled: false,
              disabledReason: 'Shape the first spec before Guildhall creates work.',
              href: '/thread',
            },
            ownerInput: {
              active: true,
              label: 'Answer in Thread',
              detail: 'Shape the first spec before Guildhall creates work.',
              href: '/thread',
            },
            setup: {
              state: 'blocked',
              freshIntakeNeeded: false,
              href: '/thread',
              detail: 'Shape the first spec before Guildhall creates work.',
            },
          },
        },
      ],
    }

    expect(summarizeProjects(service)[0]).toMatchObject({
      nextLabel: 'Shape the first spec before Guildhall creates work.',
      runActionLabel: null,
      canStart: false,
      needsAttention: true,
    })
  })

  it('lets the shared action model decide fleet attention for owner-input and terminal states', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'commerce',
          name: 'Commerce',
          path: '/work/commerce',
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped' },
          startReadiness: { canStart: true },
          actionModel: {
            primaryAction: {
              source: 'owner_input',
              label: 'Answer in Thread',
              detail: 'Shape the first spec before Guildhall creates work.',
              buttonLabel: 'Open Thread',
              href: '/thread',
              tone: 'warn',
            },
            secondaryActions: [],
            runControl: {
              label: 'Waiting on setup',
              startEnabled: false,
              disabledReason: 'Shape the first spec before Guildhall creates work.',
              href: '/thread',
            },
            ownerInput: {
              active: true,
              label: 'Answer in Thread',
              detail: 'Shape the first spec before Guildhall creates work.',
              href: '/thread',
            },
            setup: {
              state: 'blocked',
              freshIntakeNeeded: false,
              href: '/thread',
              detail: 'Shape the first spec before Guildhall creates work.',
            },
          },
        },
        {
          id: 'finished',
          name: 'Finished',
          path: '/work/finished',
          taskCounts: { total: 2, active: 0, draftReview: 0, blocked: 0, done: 2, shelved: 0 },
          run: { status: 'stopped' },
          startReadiness: {
            canStart: false,
            code: 'all_terminal',
            message: 'All tasks are already finished.',
          },
          actionModel: {
            primaryAction: null,
            secondaryActions: [],
            runControl: {
              label: 'No runnable tasks',
              startEnabled: false,
              disabledReason: 'All tasks are already finished.',
            },
            ownerInput: { active: false },
            setup: { state: 'ready', freshIntakeNeeded: false },
          },
        },
      ],
    }

    expect(summarizeProjects(service)).toMatchObject([
      {
        id: 'commerce',
        statusLabel: 'Needs you',
        nextLabel: 'Shape the first spec before Guildhall creates work.',
        canStart: false,
        needsAttention: true,
      },
      {
        id: 'finished',
        statusLabel: 'Complete',
        nextLabel: 'All tasks are already finished.',
        canStart: false,
        needsAttention: false,
      },
    ])
  })

  it.each(['no_loaded_model', 'model_unavailable', 'provider_unavailable'] as const)(
    'keeps %s start blockers provider-specific when the action model is missing',
    (code) => {
      const service: ServiceDetail = {
        projects: [
          {
            id: 'telemetry-bridge',
            name: 'Telemetry Bridge',
            path: '/work/telemetry-bridge',
            taskCounts: { total: 1, active: 1, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
            run: { status: 'stopped' },
            startReadiness: {
              canStart: false,
              code,
              message: 'Choose a model before Guildhall starts worker tasks.',
            },
          },
        ],
      }

      expect(summarizeProjects(service)[0]).toMatchObject({
        statusLabel: 'Needs provider',
        stageLabel: 'Needs provider',
        maturityLabel: 'Needs provider',
        activityLabel: 'Choose a model before Guildhall starts worker tasks.',
        canStart: false,
        needsAttention: true,
      })
    },
  )

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
      maturityLabel: 'Setup',
      maturityDescription: 'The basic project setup contract is still missing.',
      ticker: {
        tone: 'warn',
        pulse: false,
        label: 'Setup',
        message: 'First-time setup',
      },
      actionLabel: 'Open setup',
      runActionLabel: null,
      canStart: false,
      canStop: false,
    })
  })

  it('preserves saved project display-name casing instead of re-humanizing it', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'fair-labor-license',
          name: 'Fair Labor License',
          path: '/work/fair-labor-license',
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped' },
        },
      ],
    }

    expect(summarizeProjects(service)[0]?.name).toBe('Fair Labor License')
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
      runActionLabel: null,
      canStart: false,
    })
    expect(summarizeProjects(service)[1]).toMatchObject({
      statusLabel: 'Stable',
      stageLabel: 'Stable',
      activityLabel: '4 of 4 tasks are done.',
      recentLabel: 'Recently completed: Audit primitive integration',
      runActionLabel: null,
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
      maturityLabel: 'Paused',
      maturityDescription: 'Work is ready or paused, but no agents are running right now.',
      runActionLabel: 'Resume',
    })
  })

  it('does not surface failed git inspection as a project-card git chip', () => {
    const service: ServiceDetail = {
      projects: [
        {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          path: '/work/narrative-harness',
          taskCounts: { total: 2, active: 1, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
          run: { status: 'stopped' },
          gitStory: {
            ready: false,
            state: 'unknown',
            blockers: [{
              id: 'repo:0',
              label: '/work/narrative-harness',
              state: 'unknown',
              reason: 'spawn git ENOENT',
              nextAction: 'Inspect git state manually.',
            }],
          },
        },
      ],
    }

    expect(summarizeProjects(service)[0]?.gitStory).toBeNull()
  })

  it('does not repeat the global provider as a per-project status chip', () => {
    const service: ServiceDetail = {
      defaultProviderStatus: {
        preferredProvider: 'openai-api',
        preferredProviderLabel: 'OpenAI-compatible API',
        activeModel: 'gpt-5.3-codex',
        models: { worker: 'gpt-5.3-codex' },
      },
      projects: [
        {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          path: '/work/narrative-harness',
          taskCounts: { total: 2, active: 1, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
          run: { status: 'stopped' },
          providerStatus: {
            preferredProvider: 'openai-api',
            preferredProviderLabel: 'OpenAI-compatible API',
            activeModel: 'gpt-5.3-codex',
            models: { worker: 'gpt-5.3-codex' },
          },
        },
      ],
    }

    expect(summarizeProjects(service)[0]?.provider).toBeUndefined()
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
      statusLabel: 'Needs brief',
      stageLabel: 'Needs brief',
      activityLabel: '75 imported drafts need task briefs.',
      maturityLabel: 'Mixed',
      maturityDescription: 'The project has a mix of completed, queued, and planning work; inspect details for the next meaningful step.',
      counts: { total: 89, active: 0, draftReview: 75, blocked: 0, done: 14, shelved: 0 },
      ticker: {
        tone: 'warn',
        pulse: false,
        label: 'Needs brief',
        message: '75 imported drafts waiting',
      },
      canStart: false,
      canStop: false,
    })
  })
})
