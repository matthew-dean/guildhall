import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readProjectRuntimeState, writeProjectRuntimeState } from '../project-runtime-store.js'
import {
  allocateRuntimePort,
  releaseRuntimePort,
  RuntimePortConflictError,
} from '../port-router.js'

describe('runtime port router', () => {
  it('allocates and persists the first available host port for a runtime port', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-port-router-'))

    const reservation = await allocateRuntimePort(projectRoot, {
      containerPort: 5173,
      purpose: 'dev-server',
      range: { start: 45173, end: 45175 },
      isPortAvailable: async port => port !== 45173,
    })

    expect(reservation).toEqual({
      container: 5173,
      host: 45174,
      purpose: 'dev-server',
      url: 'http://127.0.0.1:45174',
    })
    await expect(readProjectRuntimeState(projectRoot)).resolves.toMatchObject({
      ports: [{ container: 5173, host: 45174, purpose: 'dev-server' }],
    })
  })

  it('throws a structured conflict when no host port is available', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-port-router-'))

    await expect(allocateRuntimePort(projectRoot, {
      containerPort: 3000,
      purpose: 'browser-proof',
      range: { start: 43000, end: 43001 },
      isPortAvailable: async () => false,
    })).rejects.toBeInstanceOf(RuntimePortConflictError)
  })

  it('reuses matching reservations and releases them from runtime state', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-port-router-'))
    const state = await readProjectRuntimeState(projectRoot)
    await writeProjectRuntimeState(projectRoot, {
      ...state,
      ports: [{ container: 7777, host: 47777, purpose: 'custom' }],
    })

    await expect(allocateRuntimePort(projectRoot, {
      containerPort: 7777,
      purpose: 'custom',
      range: { start: 47770, end: 47780 },
      isPortAvailable: async () => true,
    })).resolves.toMatchObject({ host: 47777, container: 7777 })

    await releaseRuntimePort(projectRoot, { containerPort: 7777, hostPort: 47777 })

    await expect(readProjectRuntimeState(projectRoot)).resolves.toMatchObject({ ports: [] })
  })
})
