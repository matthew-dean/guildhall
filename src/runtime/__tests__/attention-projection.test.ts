import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectStateDatabasePath } from '@guildhall/sessions'
import { readAttentionRecords } from '../attention.js'
import {
  materializeAttentionProjection,
  previewAttentionProjection,
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
})
