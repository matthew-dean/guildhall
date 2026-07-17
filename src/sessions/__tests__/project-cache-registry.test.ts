import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  censusProjectCache,
  classifyProjectCacheLease,
  createProjectCacheLease,
  getProjectCacheManifestPath,
  getProjectCachePath,
  getProjectCacheRegistryPath,
  projectCacheKey,
  readProjectCacheAllocationManifest,
  readProjectCacheLease,
  readProjectCacheOwnership,
  registerProjectCacheWorkspace,
  updateProjectCacheLease,
} from '../project-cache-registry.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'guildhall-project-cache-registry-'))
  process.env.GUILDHALL_DATA_DIR = join(tmp, 'data')
})

afterEach(() => {
  delete process.env.GUILDHALL_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe('project cache registry', () => {
  it('creates, reads, and renews an ephemeral lease without registering durable ownership', () => {
    const workspaceRoot = join(tmp, 'workspace')
    const created = createProjectCacheLease(workspaceRoot, {
      leaseId: 'run-1',
      ownerId: 'runner-test',
      producerVersion: 'test-version',
      now: '2026-07-15T10:00:00.000Z',
      ttlMs: 1_000,
    })

    expect(created.kind).toBe('ephemeral-run')
    expect(created.cacheKey).toBe(projectCacheKey(workspaceRoot))
    expect(readProjectCacheLease('run-1')).toEqual(created)
    expect(readProjectCacheOwnership(workspaceRoot).registration).toBeNull()
    expect(readProjectCacheAllocationManifest(workspaceRoot)).toMatchObject({
      schemaVersion: 1,
      cacheKey: projectCacheKey(workspaceRoot),
      workspaceRoot: workspaceRoot,
      kind: 'ephemeral-run',
      ownerId: 'runner-test',
      runId: 'run-1',
      producerVersion: 'test-version',
      createdAt: '2026-07-15T10:00:00.000Z',
      lastSeenAt: '2026-07-15T10:00:00.000Z',
      provenance: {
        source: 'project-cache-registry',
        registryVersion: 1,
        lastOperation: {
          kind: 'ephemeral-run',
          ownerId: 'runner-test',
          producerVersion: 'test-version',
          runId: 'run-1',
        },
      },
    })

    const renewed = updateProjectCacheLease('run-1', {
      now: '2026-07-15T10:00:02.000Z',
      ttlMs: 5_000,
    })
    expect(renewed.renewedAt).toBe('2026-07-15T10:00:02.000Z')
    expect(renewed.expiresAt).toBe('2026-07-15T10:00:07.000Z')
    expect(classifyProjectCacheLease(renewed, '2026-07-15T10:00:06.000Z')).toBe('active')
  })

  it('records durable registered ownership separately from run leases', () => {
    const workspaceRoot = join(tmp, 'workspace')
    const registration = registerProjectCacheWorkspace(workspaceRoot, {
      ownerId: 'workspace-test',
      producerVersion: 'test-version',
      now: '2026-07-15T10:00:00.000Z',
    })
    createProjectCacheLease(workspaceRoot, {
      leaseId: 'run-2',
      now: '2026-07-15T10:00:01.000Z',
      ttlMs: 10_000,
    })

    const ownership = readProjectCacheOwnership(workspaceRoot)
    expect(ownership.registration).toEqual(registration)
    expect(ownership.registration?.kind).toBe('durable-workspace')
    expect(ownership.leases).toHaveLength(1)
    expect(ownership.leases[0]?.kind).toBe('ephemeral-run')
    expect(readProjectCacheAllocationManifest(workspaceRoot)).toMatchObject({
      kind: 'durable-workspace',
      ownerId: 'workspace-test',
      producerVersion: 'test-version',
      provenance: {
        lastOperation: {
          kind: 'ephemeral-run',
          runId: 'run-2',
          producerVersion: process.env.npm_package_version ?? 'development',
        },
      },
    })
    expect(readProjectCacheOwnership(workspaceRoot, {
      now: '2026-07-15T10:00:02.000Z',
    }).leases[0]?.classification).toBe('active')
  })

  it('classifies an expired lease as stale without rewriting it', () => {
    const lease = createProjectCacheLease(join(tmp, 'workspace'), {
      leaseId: 'stale-run',
      now: '2026-07-15T10:00:00.000Z',
      expiresAt: '2026-07-15T09:59:00.000Z',
    })
    const before = readFileSync(getProjectCacheRegistryPath(), 'utf8')

    expect(classifyProjectCacheLease(lease, '2026-07-15T10:01:00.000Z')).toBe('stale')
    expect(readProjectCacheOwnership(join(tmp, 'workspace'), {
      now: '2026-07-15T10:01:00.000Z',
    }).leases[0]?.classification).toBe('stale')
    expect(readFileSync(getProjectCacheRegistryPath(), 'utf8')).toBe(before)
  })

  it('refreshes a durable manifest idempotently without changing its creation time', () => {
    const workspaceRoot = join(tmp, 'workspace')
    const first = registerProjectCacheWorkspace(workspaceRoot, {
      ownerId: 'workspace-test',
      producerVersion: 'test-version',
      now: '2026-07-15T10:00:00.000Z',
    })
    const second = registerProjectCacheWorkspace(workspaceRoot, {
      ownerId: 'workspace-test',
      producerVersion: 'test-version',
      now: '2026-07-15T10:01:00.000Z',
    })

    expect(second).toEqual({ ...first, lastSeenAt: '2026-07-15T10:01:00.000Z' })
    expect(readProjectCacheAllocationManifest(workspaceRoot)).toMatchObject({
      createdAt: '2026-07-15T10:00:00.000Z',
      lastSeenAt: '2026-07-15T10:01:00.000Z',
      ownerId: 'workspace-test',
      producerVersion: 'test-version',
    })
    expect(existsSync(getProjectCacheManifestPath(workspaceRoot))).toBe(true)
  })

  it('rejects an existing manifest owned by another workspace or allocation kind', () => {
    const workspaceRoot = join(tmp, 'workspace')
    registerProjectCacheWorkspace(workspaceRoot, { now: '2026-07-15T10:00:00.000Z' })
    const manifestPath = getProjectCacheManifestPath(workspaceRoot)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>

    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, workspaceRoot: join(tmp, 'other-workspace') })}\n`)
    expect(() => registerProjectCacheWorkspace(workspaceRoot)).toThrow(/manifest collision/)

    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      kind: 'ephemeral-run',
      provenance: {
        ...(manifest.provenance as Record<string, unknown>),
        lastOperation: {
          ...((manifest.provenance as Record<string, unknown>).lastOperation as Record<string, unknown>),
          kind: 'ephemeral-run',
        },
      },
    })}\n`)
    expect(() => registerProjectCacheWorkspace(workspaceRoot)).toThrow(/manifest kind collision/)
  })

  it('censes cache directories read-only and never calls an unregistered entry orphaned', () => {
    const cacheRoot = join(tmp, 'cache', 'projects')
    const registeredRoot = join(tmp, 'registered-workspace')
    mkdirSync(getProjectCachePath(registeredRoot, cacheRoot), { recursive: true })
    writeFileSync(join(getProjectCachePath(registeredRoot, cacheRoot), 'keep.txt'), 'keep\n')
    mkdirSync(join(cacheRoot, 'unknown-cache-entry'), { recursive: true })
    writeFileSync(join(cacheRoot, 'unknown-cache-entry', 'keep.txt'), 'keep unknown\n')
    registerProjectCacheWorkspace(registeredRoot, { now: '2026-07-15T10:00:00.000Z' })

    const beforeNames = readdirSync(cacheRoot).sort()
    const beforeUnknown = readFileSync(join(cacheRoot, 'unknown-cache-entry', 'keep.txt'), 'utf8')
    const census = censusProjectCache({ cacheRoot, now: '2026-07-15T10:00:00.000Z' })

    expect(census.entries).toEqual([
      expect.objectContaining({
        cacheKey: projectCacheKey(registeredRoot),
        classification: 'durable-registered',
        cachePresent: true,
        deletion: 'not-authorized',
      }),
      expect.objectContaining({
        cacheKey: 'unknown-cache-entry',
        classification: 'unregistered-unknown',
        cachePresent: true,
        deletion: 'not-authorized',
      }),
    ])
    expect(census.entries.some(entry => entry.classification.includes('orphan'))).toBe(false)
    expect(readdirSync(cacheRoot).sort()).toEqual(beforeNames)
    expect(readFileSync(join(cacheRoot, 'unknown-cache-entry', 'keep.txt'), 'utf8')).toBe(beforeUnknown)
  })

  it('does not create a cache or registry directory for an empty census', () => {
    const cacheRoot = join(tmp, 'missing-cache-root')
    const registryPath = getProjectCacheRegistryPath()

    const census = censusProjectCache({ cacheRoot, now: '2026-07-15T10:00:00.000Z' })

    expect(census.entries).toEqual([])
    expect(census.registryAvailable).toBe(true)
    expect(existsSync(cacheRoot)).toBe(false)
    expect(existsSync(registryPath)).toBe(false)
  })
})
