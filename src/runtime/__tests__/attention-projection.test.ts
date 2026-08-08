import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectStateDatabasePath } from '@guildhall/sessions'
import { readAttentionRecords } from '../attention.js'
import {
  attentionItemsForReleaseTruth,
  attentionProjectionNeedsReleaseReconciliation,
  materializeAttentionProjection,
  previewAttentionProjection,
  readSavedAttentionSurface,
  readSavedAttentionSurfaceFromBoundary,
  type AttentionProjectionInput,
} from '../attention-projection.js'
import type { InboxItem } from '../inbox.js'

const projectRoots: string[] = []

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'guildhall-attention-projection-'))
  projectRoots.push(root)
  return root
}

function item(title = 'Review project setup'): InboxItem {
  return {
    kind: 'setup_pending',
    severity: 'medium',
    stepId: 'provider',
    title,
    detail: 'A project setup step still needs attention.',
    actionHref: '/providers',
  }
}

function input(projectRoot: string, openItems: readonly InboxItem[]): AttentionProjectionInput {
  return { projectRoot, openItems }
}

afterEach(() => {
  for (const root of projectRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('attention projection', () => {
  it('removes stale current-scope prompts after the saved release is complete', () => {
    const closedRelease = {
      state: 'ready' as const,
      counts: { unfinished: 0, blocked: 0, ownerBlocked: 0, proofBlocked: 0 },
    }
    const items: InboxItem[] = [
      item('Shape the first spec'),
      {
        kind: 'proof_reconciliation',
        severity: 'medium',
        taskId: 'task-done',
        title: 'Review stale proof records',
        detail: 'An older projection still says proof is missing.',
        actionHref: '/task/task-done?tab=spec',
        count: 1,
        signals: ['task:task-done'],
        dismissEndpoint: '/api/project/attention/dismiss?id=proof-reconciliation%3Adone-with-unmet-proof',
      },
      {
        kind: 'required_migration',
        severity: 'high',
        migrationId: 'migration-1',
        title: 'Required migration',
        detail: 'A machine migration still needs to run.',
        actionHref: '/migrations',
        blocking: true,
        dismissible: false,
        source: { system: 'migrations', id: 'migration-1' },
      },
    ]

    expect(attentionItemsForReleaseTruth(items, closedRelease)).toEqual([
      expect.objectContaining({ kind: 'required_migration' }),
    ])
  })

  it('detects stale open records without reading task detail', async () => {
    const root = projectRoot()
    await materializeAttentionProjection(input(root, [item('Shape the first spec')]))

    expect(attentionProjectionNeedsReleaseReconciliation(root, {
      state: 'ready',
      counts: { unfinished: 0, blocked: 0, ownerBlocked: 0, proofBlocked: 0 },
    })).toBe(true)
    expect(attentionProjectionNeedsReleaseReconciliation(root, {
      state: 'active',
      counts: { unfinished: 1, blocked: 0, ownerBlocked: 0, proofBlocked: 0 },
    })).toBe(false)
  })

  it('refreshes idempotently when the computed Inbox items are unchanged', async () => {
    const root = projectRoot()

    const first = await materializeAttentionProjection(input(root, [item()]))
    const second = await materializeAttentionProjection(input(root, [item()]))

    expect(second).toEqual(first)
    expect(readAttentionRecords(root)).toEqual(first.history)
  })

  it('marks an open record resolved when the next computed Inbox is empty', async () => {
    const root = projectRoot()

    await materializeAttentionProjection(input(root, [item()]))
    const resolved = await materializeAttentionProjection(input(root, []))

    expect(resolved.openItems).toEqual([])
    expect(resolved.history).toEqual([
      expect.objectContaining({
        kind: 'setup_pending',
        status: 'resolved',
        resolution: 'verified',
      }),
    ])
  })

  it('previews without creating or changing durable attention state', async () => {
    const root = projectRoot()
    const databasePath = projectStateDatabasePath(root)

    expect(existsSync(databasePath)).toBe(false)
    const preview = previewAttentionProjection(input(root, [item()]))

    expect(preview.openItems).toEqual([
      expect.objectContaining({ kind: 'setup_pending', status: 'open' }),
    ])
    expect(existsSync(databasePath)).toBe(false)

    const materialized = await materializeAttentionProjection(input(root, [item()]))
    const beforeReadOnlyPreview = readAttentionRecords(root)
    previewAttentionProjection(input(root, []))

    expect(readAttentionRecords(root)).toEqual(beforeReadOnlyPreview)
    expect(materialized.history).toEqual(beforeReadOnlyPreview)
  })

  it('reports an unreadable saved projection as a local cache miss', () => {
    const root = projectRoot()
    const databasePath = projectStateDatabasePath(root)
    mkdirSync(dirname(databasePath), { recursive: true })
    writeFileSync(databasePath, 'not a sqlite database')

    expect(() => readSavedAttentionSurface(root, false)).not.toThrow()
    expect(readSavedAttentionSurface(root, false)).toMatchObject({
      items: [],
      history: [],
      freshness: 'missing',
      requiresRefresh: true,
    })
    expect(existsSync(databasePath)).toBe(true)
  })

  it('formats only the supplied saved records at a matching revision', () => {
    const surface = readSavedAttentionSurfaceFromBoundary({
      initializationNeeded: false,
      records: [
        {
          payload: {
            id: 'attention-open',
            status: 'open',
            kind: 'setup_pending',
            severity: 'medium',
            title: 'Open saved attention',
            detail: 'The saved projection is current.',
            actionHref: '/providers',
          },
        },
        {
          payload: {
            id: 'attention-resolved',
            status: 'resolved',
            kind: 'setup_pending',
            severity: 'medium',
            title: 'Resolved saved attention',
            detail: 'This should not appear in the open fleet items.',
            actionHref: '/providers',
          },
        },
      ],
      watermarkSourceRevision: 7,
      projectRevision: 7,
    })

    expect(surface).toMatchObject({
      items: [expect.objectContaining({ id: 'attention-open' })],
      freshness: 'current',
    })
    expect(surface.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'attention-resolved' }),
    ]))
  })

  it('keeps stale attention in history while removing it from current Needs you', () => {
    const surface = readSavedAttentionSurfaceFromBoundary({
      initializationNeeded: false,
      records: [{
        payload: {
          id: 'stale-setup',
          status: 'open',
          kind: 'setup_pending',
          severity: 'medium',
          stepId: 'firstTask',
          title: 'Shape the first spec',
          detail: 'This belonged to the earlier project setup flow.',
          actionHref: '/thread',
        },
      }],
      watermarkSourceRevision: 9,
      projectRevision: 9,
      releaseTruth: {
        state: 'ready',
        counts: { unfinished: 0, blocked: 0, ownerBlocked: 0, proofBlocked: 0 },
      },
    })

    expect(surface.items).toEqual([])
    expect(surface.blockers).toEqual({ bootstrap: false, workspaceImport: false })
    expect(surface.history).toEqual([
      expect.objectContaining({ id: 'stale-setup', status: 'open' }),
    ])
  })

  it('keeps completed setup attention in history when shared setup is ready', () => {
    const surface = readSavedAttentionSurfaceFromBoundary({
      initializationNeeded: false,
      records: [{
        payload: {
          id: 'completed-setup',
          status: 'open',
          kind: 'setup_pending',
          severity: 'medium',
          stepId: 'firstTask',
          title: 'Shape the first spec',
          detail: 'This setup step is already complete.',
          actionHref: '/thread',
        },
      }],
      watermarkSourceRevision: 10,
      projectRevision: 10,
      setupTruth: { state: 'ready' },
    })

    expect(surface.items).toEqual([])
    expect(surface.history).toEqual([
      expect.objectContaining({ id: 'completed-setup', status: 'open' }),
    ])
  })
})
