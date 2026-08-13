import { describe, expect, it } from 'vitest'
import { buildFleetAttentionGroups, summarizeFleetAttention } from '../fleet-attention-summary.js'

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'narrative-harness',
    summaryFreshness: 'current' as const,
    fleetAttention: {
      freshness: 'current' as const,
      total: 1,
      items: [{
        id: 'workspace-import:review',
        status: 'open' as const,
        kind: 'workspace_import_pending' as const,
        severity: 'medium' as const,
        title: 'Existing repo detected',
        detail: 'Review imported notes.',
        actionHref: '/workspace-import',
        signals: [],
        dismissEndpoint: '/api/project/attention/dismiss?id=workspace-import%3Areview',
      }],
    },
    ...overrides,
  }
}

describe('fleet attention summary', () => {
  it('does not present a retained import advisory when ready work is the shared current action', () => {
    const groups = buildFleetAttentionGroups([project({
      actionModel: {
        primaryAction: {
          code: 'ready_work',
          tone: 'accent',
          taskId: 'task-091',
          taskLabel: 'Present the draft',
          buttonLabel: 'Open Work',
          href: '/work?task=task-091',
        },
      },
    })])

    expect(groups[0]?.items).toEqual([])
  })

  it('promotes the shared warning action over retained inbox records', () => {
    const groups = buildFleetAttentionGroups([project({
      actionModel: {
        primaryAction: {
          code: 'owner_review_required',
          tone: 'warn',
          taskId: 'task-014',
          taskLabel: 'Review the release spec',
          detail: 'Approve the spec before work can continue.',
          buttonLabel: 'Review spec',
          href: '/work?task=task-014',
        },
      },
    })])

    expect(groups[0]?.items).toEqual([expect.objectContaining({
      kind: 'project_action',
      taskId: 'task-014',
      title: 'Review the release spec',
      buttonLabel: 'Review spec',
      actionHref: '/work?task=task-014',
    })])
  })

  it('keeps saved setup attention when the project has no current action', () => {
    const summary = summarizeFleetAttention([project({ id: 'commerce-project', fleetAttention: {
      freshness: 'current',
      total: 1,
      items: [{
        id: 'setup_pending:direction',
        status: 'open',
        kind: 'setup_pending',
        severity: 'medium',
        title: 'Give the project direction',
        detail: 'Start with a brief.',
        actionHref: '/thread',
        stepId: 'direction',
      }],
    } })])

    expect(summary).toMatchObject({ projectCount: 1, totalItems: 1 })
    expect(summary.groups[0]?.items[0]).toMatchObject({ kind: 'setup_pending', title: 'Give the project direction' })
  })
})
