import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readProjectDeliveryProjectionRefreshSource,
  readProjectDeliveryReadProjectionWithSavedModel,
} from '../delivery-read-projection.js'

describe('delivery read projection sessions boundary', () => {
  let projectRoot: string | undefined

  afterEach(async () => {
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true })
    projectRoot = undefined
  })

  it('binds the saved model token to the database snapshot API', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-delivery-session-boundary-'))
    const readSavedModel = vi.fn(async () => ({
      model: { id: 'saved-delivery-model' },
      updatedAt: '2026-07-16T12:00:00.000Z',
    }))

    const result = await readProjectDeliveryReadProjectionWithSavedModel(
      projectRoot,
      { queue: false },
      readSavedModel,
    )

    expect(readSavedModel).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      model: { id: 'saved-delivery-model' },
      snapshot: { status: 'missing', reason: 'database_missing' },
    })
  })

  it('does not invent refresh state when the authoritative database is absent', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-delivery-refresh-boundary-'))

    const result = await readProjectDeliveryProjectionRefreshSource(
      projectRoot,
      async () => ({ model: { id: 'saved-delivery-model' }, updatedAt: null }),
    )

    expect(result).toEqual({
      status: 'missing',
      model: null,
      reason: 'database_missing',
    })
  })
})
