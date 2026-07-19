import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { atomicWriteText } from './atomic.js'

export const PROJECT_CACHE_REGISTRY_VERSION = 1
export const PROJECT_CACHE_LEASE_TTL_MS = 15 * 60 * 1000
export const PROJECT_CACHE_MANIFEST_SCHEMA_VERSION = 1

const DEFAULT_CONFIG_DIR = '.guildhall'
const REGISTRY_FILENAME = 'project-cache-registry.json'
const CACHE_MANIFEST_FILENAME = 'allocation-manifest.json'

export type ProjectCacheTime = Date | string | number
export type ProjectCacheLeaseStatus = 'active' | 'released'
export type ProjectCacheLeaseClassification = 'active' | 'stale' | 'released'
export type ProjectCacheCensusClassification =
  | 'durable-registered'
  | 'ephemeral-active'
  | 'ephemeral-stale'
  | 'unregistered-unknown'

export type ProjectCacheAllocationKind = 'durable-workspace' | 'ephemeral-run'

export interface ProjectCacheAllocationManifest {
  schemaVersion: typeof PROJECT_CACHE_MANIFEST_SCHEMA_VERSION
  cacheKey: string
  workspaceRoot: string
  kind: ProjectCacheAllocationKind
  ownerId: string
  runId?: string
  producerVersion: string
  createdAt: string
  lastSeenAt: string
  provenance: {
    source: 'project-cache-registry'
    registryVersion: typeof PROJECT_CACHE_REGISTRY_VERSION
    lastOperation: {
      kind: ProjectCacheAllocationKind
      ownerId: string
      producerVersion: string
      runId?: string
    }
  }
}

export interface ProjectCacheWorkspaceRegistration {
  kind: 'durable-workspace'
  cacheKey: string
  workspaceRoot: string
  registeredAt: string
  lastSeenAt: string
}

export interface ProjectCacheLease {
  kind: 'ephemeral-run'
  id: string
  cacheKey: string
  workspaceRoot: string
  createdAt: string
  renewedAt: string
  expiresAt: string
  status: ProjectCacheLeaseStatus
  releasedAt?: string
}

export interface ProjectCacheRegistry {
  version: typeof PROJECT_CACHE_REGISTRY_VERSION
  workspaces: Record<string, ProjectCacheWorkspaceRegistration>
  leases: Record<string, ProjectCacheLease>
}

export interface ProjectCacheOwnership {
  cacheKey: string
  workspaceRoot: string
  registration: ProjectCacheWorkspaceRegistration | null
  leases: Array<ProjectCacheLease & { classification: ProjectCacheLeaseClassification }>
}

export interface ProjectCacheCensusEntry {
  cacheKey: string
  cachePath: string
  cachePresent: boolean
  classification: ProjectCacheCensusClassification
  leaseClassifications: ProjectCacheLeaseClassification[]
  /** Census never authorizes deletion; absence of registration is only uncertainty. */
  deletion: 'not-authorized'
}

export interface ProjectCacheCensus {
  cacheRoot: string
  registryPath: string
  scannedAt: string
  registryAvailable: boolean
  registryError: string | null
  scanError: string | null
  entries: ProjectCacheCensusEntry[]
}

interface CreateLeaseOptions {
  leaseId?: string
  ownerId?: string
  producerVersion?: string
  now?: ProjectCacheTime
  ttlMs?: number
  expiresAt?: ProjectCacheTime
}

interface UpdateLeaseOptions {
  now?: ProjectCacheTime
  ttlMs?: number
  expiresAt?: ProjectCacheTime
  status?: 'released'
}

interface CensusOptions {
  cacheRoot?: string
  now?: ProjectCacheTime
}

interface ProjectCacheManifestOperation {
  kind: ProjectCacheAllocationKind
  ownerId: string
  runId?: string
  producerVersion?: string
}

function emptyRegistry(): ProjectCacheRegistry {
  return { version: PROJECT_CACHE_REGISTRY_VERSION, workspaces: {}, leases: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid project cache registry ${field}`)
  return value
}

function parseWorkspace(value: unknown): ProjectCacheWorkspaceRegistration {
  if (!isRecord(value) || value.kind !== 'durable-workspace') throw new Error('Invalid project cache workspace registration')
  return {
    kind: 'durable-workspace',
    cacheKey: requiredString(value.cacheKey, 'workspace cacheKey'),
    workspaceRoot: requiredString(value.workspaceRoot, 'workspace root'),
    registeredAt: requiredString(value.registeredAt, 'workspace registeredAt'),
    lastSeenAt: requiredString(value.lastSeenAt, 'workspace lastSeenAt'),
  }
}

function parseLease(value: unknown): ProjectCacheLease {
  if (!isRecord(value) || value.kind !== 'ephemeral-run') throw new Error('Invalid project cache lease')
  const status = value.status
  if (status !== 'active' && status !== 'released') throw new Error('Invalid project cache lease status')
  return {
    kind: 'ephemeral-run',
    id: requiredString(value.id, 'lease id'),
    cacheKey: requiredString(value.cacheKey, 'lease cacheKey'),
    workspaceRoot: requiredString(value.workspaceRoot, 'lease workspace root'),
    createdAt: requiredString(value.createdAt, 'lease createdAt'),
    renewedAt: requiredString(value.renewedAt, 'lease renewedAt'),
    expiresAt: requiredString(value.expiresAt, 'lease expiresAt'),
    status,
    ...(typeof value.releasedAt === 'string' ? { releasedAt: value.releasedAt } : {}),
  }
}

function parseRecordMap<T>(value: unknown, parse: (entry: unknown) => T, field: string): Record<string, T> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`Invalid project cache registry ${field}`)
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, parse(entry)]))
}

function readRegistryFile(path: string): ProjectCacheRegistry {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
    throw error
  }
  if (!isRecord(parsed) || parsed.version !== PROJECT_CACHE_REGISTRY_VERSION) {
    throw new Error(`Unsupported project cache registry version in ${path}`)
  }
  return {
    version: PROJECT_CACHE_REGISTRY_VERSION,
    workspaces: parseRecordMap(parsed.workspaces, parseWorkspace, 'workspaces'),
    leases: parseRecordMap(parsed.leases, parseLease, 'leases'),
  }
}

function writeRegistryFile(path: string, registry: ProjectCacheRegistry): void {
  atomicWriteText(path, `${JSON.stringify(registry, null, 2)}\n`)
}

function producerVersion(value?: string): string {
  return value ?? process.env.GUILDHALL_VERSION ?? process.env.npm_package_version ?? 'development'
}

function defaultOwnerId(kind: ProjectCacheAllocationKind, cacheKey: string, runId?: string): string {
  return kind === 'ephemeral-run' ? `run:${runId}` : `workspace:${cacheKey}`
}

function parseProjectCacheAllocationManifest(value: unknown): ProjectCacheAllocationManifest {
  if (!isRecord(value) || value.schemaVersion !== PROJECT_CACHE_MANIFEST_SCHEMA_VERSION) {
    throw new Error('Invalid project cache allocation manifest')
  }
  const provenance = value.provenance
  const lastOperation = isRecord(provenance) ? provenance.lastOperation : undefined
  if (
    !isRecord(provenance) ||
    provenance.source !== 'project-cache-registry' ||
    provenance.registryVersion !== PROJECT_CACHE_REGISTRY_VERSION ||
    !isRecord(lastOperation) ||
    (lastOperation.kind !== 'durable-workspace' && lastOperation.kind !== 'ephemeral-run')
  ) {
    throw new Error('Invalid project cache allocation manifest provenance')
  }
  const kind = value.kind
  if (kind !== 'durable-workspace' && kind !== 'ephemeral-run') {
    throw new Error('Invalid project cache allocation manifest kind')
  }
  return {
    schemaVersion: PROJECT_CACHE_MANIFEST_SCHEMA_VERSION,
    cacheKey: requiredString(value.cacheKey, 'manifest cacheKey'),
    workspaceRoot: requiredString(value.workspaceRoot, 'manifest workspace root'),
    kind,
    ownerId: requiredString(value.ownerId, 'manifest ownerId'),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    producerVersion: requiredString(value.producerVersion, 'manifest producerVersion'),
    createdAt: requiredString(value.createdAt, 'manifest createdAt'),
    lastSeenAt: requiredString(value.lastSeenAt, 'manifest lastSeenAt'),
    provenance: {
      source: 'project-cache-registry',
      registryVersion: PROJECT_CACHE_REGISTRY_VERSION,
      lastOperation: {
        kind: lastOperation.kind,
        ownerId: requiredString(lastOperation.ownerId, 'manifest provenance ownerId'),
        producerVersion: requiredString(lastOperation.producerVersion, 'manifest provenance producerVersion'),
        ...(typeof lastOperation.runId === 'string' ? { runId: lastOperation.runId } : {}),
      },
    },
  }
}

export function getProjectCacheManifestPath(
  workspaceRoot: string,
  cacheRoot = getProjectCacheRoot(),
): string {
  return join(getProjectCachePath(workspaceRoot, cacheRoot), CACHE_MANIFEST_FILENAME)
}

export function readProjectCacheAllocationManifest(
  workspaceRoot: string,
  cacheRoot = getProjectCacheRoot(),
): ProjectCacheAllocationManifest | null {
  const path = getProjectCacheManifestPath(workspaceRoot, cacheRoot)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return parseProjectCacheAllocationManifest(parsed)
}

function ensureProjectCacheAllocationManifest(
  workspaceRoot: string,
  operation: ProjectCacheManifestOperation,
  now: string,
): ProjectCacheAllocationManifest {
  const root = resolve(workspaceRoot)
  const cacheKey = projectCacheKey(root)
  const cachePath = getProjectCachePath(root)
  const manifestPath = join(cachePath, CACHE_MANIFEST_FILENAME)
  mkdirSync(cachePath, { recursive: true })

  let existing: ProjectCacheAllocationManifest | null = null
  try {
    existing = parseProjectCacheAllocationManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  if (existing) {
    if (existing.cacheKey !== cacheKey || existing.workspaceRoot !== root) {
      throw new Error(`Project cache manifest collision for ${cacheKey}`)
    }
    // A lease may use a durable workspace allocation; it does not create a
    // second physical cache. All other kind changes are collisions.
    const compatible = existing.kind === operation.kind || (
      existing.kind === 'durable-workspace' && operation.kind === 'ephemeral-run'
    )
    if (!compatible) throw new Error(`Project cache manifest kind collision for ${cacheKey}`)
  }

  const ownerId = operation.ownerId
  const next: ProjectCacheAllocationManifest = existing
    ? {
        ...existing,
        lastSeenAt: now,
        ...(operation.producerVersion ? { producerVersion: operation.producerVersion } : {}),
        provenance: {
          ...existing.provenance,
          lastOperation: {
            kind: operation.kind,
            ownerId,
            producerVersion: producerVersion(operation.producerVersion),
            ...(operation.runId ? { runId: operation.runId } : {}),
          },
        },
      }
    : {
        schemaVersion: PROJECT_CACHE_MANIFEST_SCHEMA_VERSION,
        cacheKey,
        workspaceRoot: root,
        kind: operation.kind,
        ownerId,
        ...(operation.runId ? { runId: operation.runId } : {}),
        producerVersion: producerVersion(operation.producerVersion),
        createdAt: now,
        lastSeenAt: now,
        provenance: {
          source: 'project-cache-registry',
          registryVersion: PROJECT_CACHE_REGISTRY_VERSION,
          lastOperation: {
            kind: operation.kind,
            ownerId,
            producerVersion: producerVersion(operation.producerVersion),
            ...(operation.runId ? { runId: operation.runId } : {}),
          },
        },
      }
  atomicWriteText(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

function isoTime(value?: ProjectCacheTime): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  if (Number.isNaN(date.getTime())) throw new Error('Invalid project cache timestamp')
  return date.toISOString()
}

function expiresAfter(now: string, ttlMs: number): string {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Project cache lease ttlMs must be positive')
  return new Date(Date.parse(now) + ttlMs).toISOString()
}

function registryDataDir(): string {
  const configured = process.env.GUILDHALL_DATA_DIR
  if (configured && configured.length > 0) return configured
  const configDir = process.env.GUILDHALL_CONFIG_DIR || join(homedir(), DEFAULT_CONFIG_DIR)
  return join(configDir, 'data')
}

/** Same basename + truncated SHA-1 identity used by existing project caches. */
export function projectCacheKey(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return `${basename(resolved) || 'root'}-${digest}`
}

export function getProjectCacheRoot(): string {
  return join(registryDataDir(), 'projects')
}

export function getProjectCacheRegistryPath(): string {
  return join(dirname(getProjectCacheRoot()), REGISTRY_FILENAME)
}

export function getProjectCachePath(workspaceRoot: string, cacheRoot = getProjectCacheRoot()): string {
  return join(cacheRoot, projectCacheKey(workspaceRoot))
}

export function readProjectCacheRegistry(): ProjectCacheRegistry {
  return readRegistryFile(getProjectCacheRegistryPath())
}

export function registerProjectCacheWorkspace(
  workspaceRoot: string,
  options: { now?: ProjectCacheTime; ownerId?: string; producerVersion?: string } = {},
): ProjectCacheWorkspaceRegistration {
  const root = resolve(workspaceRoot)
  const cacheKey = projectCacheKey(root)
  const now = isoTime(options.now)
  const registry = readProjectCacheRegistry()
  const existing = registry.workspaces[cacheKey]
  if (existing && existing.workspaceRoot !== root) {
    throw new Error(`Project cache key collision for ${cacheKey}`)
  }
  ensureProjectCacheAllocationManifest(root, {
    kind: 'durable-workspace',
    ownerId: options.ownerId ?? defaultOwnerId('durable-workspace', cacheKey),
    ...(options.producerVersion ? { producerVersion: options.producerVersion } : {}),
  }, now)
  const registration: ProjectCacheWorkspaceRegistration = existing
    ? { ...existing, lastSeenAt: now }
    : { kind: 'durable-workspace', cacheKey, workspaceRoot: root, registeredAt: now, lastSeenAt: now }
  registry.workspaces[cacheKey] = registration
  writeRegistryFile(getProjectCacheRegistryPath(), registry)
  return registration
}

export function readProjectCacheOwnership(
  workspaceRoot: string,
  options: { now?: ProjectCacheTime } = {},
): ProjectCacheOwnership {
  const root = resolve(workspaceRoot)
  const cacheKey = projectCacheKey(root)
  const registry = readProjectCacheRegistry()
  const leases = Object.values(registry.leases)
    .filter(lease => lease.cacheKey === cacheKey)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(lease => ({ ...lease, classification: classifyProjectCacheLease(lease, options.now) }))
  return { cacheKey, workspaceRoot: root, registration: registry.workspaces[cacheKey] ?? null, leases }
}

export function createProjectCacheLease(
  workspaceRoot: string,
  options: CreateLeaseOptions = {},
): ProjectCacheLease {
  const root = resolve(workspaceRoot)
  const now = isoTime(options.now)
  const registry = readProjectCacheRegistry()
  const id = options.leaseId ?? randomUUID()
  if (registry.leases[id]) throw new Error(`Project cache lease already exists: ${id}`)
  const lease: ProjectCacheLease = {
    kind: 'ephemeral-run',
    id,
    cacheKey: projectCacheKey(root),
    workspaceRoot: root,
    createdAt: now,
    renewedAt: now,
    expiresAt: options.expiresAt !== undefined
      ? isoTime(options.expiresAt)
      : expiresAfter(now, options.ttlMs ?? PROJECT_CACHE_LEASE_TTL_MS),
    status: 'active',
  }
  ensureProjectCacheAllocationManifest(root, {
    kind: 'ephemeral-run',
    ownerId: options.ownerId ?? defaultOwnerId('ephemeral-run', lease.id),
    runId: lease.id,
    ...(options.producerVersion ? { producerVersion: options.producerVersion } : {}),
  }, now)
  registry.leases[id] = lease
  writeRegistryFile(getProjectCacheRegistryPath(), registry)
  return lease
}

export function readProjectCacheLease(leaseId: string): ProjectCacheLease | null {
  return readProjectCacheRegistry().leases[leaseId] ?? null
}

export function updateProjectCacheLease(leaseId: string, options: UpdateLeaseOptions = {}): ProjectCacheLease {
  const registry = readProjectCacheRegistry()
  const existing = registry.leases[leaseId]
  if (!existing) throw new Error(`Unknown project cache lease: ${leaseId}`)
  if (existing.status === 'released') throw new Error(`Project cache lease is released: ${leaseId}`)
  const now = isoTime(options.now)
  const lease: ProjectCacheLease = options.status === 'released'
    ? { ...existing, renewedAt: now, status: 'released', releasedAt: now }
    : {
        ...existing,
        renewedAt: now,
        expiresAt: options.expiresAt !== undefined
          ? isoTime(options.expiresAt)
          : options.ttlMs !== undefined
            ? expiresAfter(now, options.ttlMs)
            : existing.expiresAt,
      }
  registry.leases[leaseId] = lease
  writeRegistryFile(getProjectCacheRegistryPath(), registry)
  return lease
}

export function classifyProjectCacheLease(
  lease: ProjectCacheLease,
  now?: ProjectCacheTime,
): ProjectCacheLeaseClassification {
  if (lease.status === 'released') return 'released'
  return Date.parse(lease.expiresAt) <= Date.parse(isoTime(now)) ? 'stale' : 'active'
}

export function censusProjectCache(options: CensusOptions = {}): ProjectCacheCensus {
  const cacheRoot = resolve(options.cacheRoot ?? getProjectCacheRoot())
  const registryPath = getProjectCacheRegistryPath()
  const scannedAt = isoTime(options.now)
  let registry = emptyRegistry()
  let registryAvailable = true
  let registryError: string | null = null
  try {
    registry = readRegistryFile(registryPath)
  } catch (error) {
    registryAvailable = false
    registryError = error instanceof Error ? error.message : String(error)
  }

  let cacheNames: string[] = []
  let scanError: string | null = null
  try {
    cacheNames = readdirSync(cacheRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      scanError = error instanceof Error ? error.message : String(error)
    }
  }

  const leaseCacheKeys = Object.values(registry.leases).map(lease => lease.cacheKey)
  const cacheKeys = new Set([...Object.keys(registry.workspaces), ...leaseCacheKeys, ...cacheNames])
  const entries = [...cacheKeys].sort().map(cacheKey => {
    const registration = registry.workspaces[cacheKey]
    const leaseClassifications = Object.values(registry.leases)
      .filter(lease => lease.cacheKey === cacheKey)
      .map(lease => classifyProjectCacheLease(lease, scannedAt))
    const classification: ProjectCacheCensusClassification = registration
      ? 'durable-registered'
      : leaseClassifications.includes('active')
        ? 'ephemeral-active'
        : leaseClassifications.includes('stale')
          ? 'ephemeral-stale'
          : 'unregistered-unknown'
    return {
      cacheKey,
      cachePath: join(cacheRoot, cacheKey),
      cachePresent: cacheNames.includes(cacheKey),
      classification,
      leaseClassifications,
      deletion: 'not-authorized' as const,
    }
  })

  return { cacheRoot, registryPath, scannedAt, registryAvailable, registryError, scanError, entries }
}
