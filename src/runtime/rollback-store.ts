import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

const ROLLBACK_STORE_VERSION = 1 as const

export interface RollbackStoreOptions {
  rootDir: string
  producer: string
  producerVersion: string
  byteBudget?: number
  now?: () => Date
  runIdFactory?: () => string
}

export interface RollbackEntryInput {
  logicalPath: string
  content: Uint8Array | string
  restoreClass: string
  sourceRevision: string
}

export interface RollbackManifestEntry {
  logicalPath: string
  objectPath: string
  bytes: number
  sha256: string
  restoreClass: string
  sourceRevision: string
  producer: string
  producerVersion: string
}

export interface RollbackRunManifest {
  version: typeof ROLLBACK_STORE_VERSION
  runId: string
  createdAt: string
  producer: string
  producerVersion: string
  entries: RollbackManifestEntry[]
}

export interface RollbackIndexEntry {
  runId: string
  manifestPath: string
  createdAt: string
  producer: string
  producerVersion: string
  entryCount: number
  bytes: number
  newObjectBytes: number
}

export interface RollbackIndex {
  version: typeof ROLLBACK_STORE_VERSION
  runs: RollbackIndexEntry[]
}

export interface RollbackRunResult {
  runId: string
  manifestPath: string
  indexPath: string
  manifest: RollbackRunManifest
  indexEntry: RollbackIndexEntry
  newObjectBytes: number
  storedObjectBytes: number
}

interface PreparedEntry {
  input: RollbackEntryInput
  content: Buffer
  bytes: number
  sha256: string
  objectPath: string
  objectExists: boolean
}

function digest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function asBuffer(content: Uint8Array | string): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
}

function requireText(value: string, name: string): void {
  if (value.length === 0) throw new Error(`Rollback ${name} must not be empty`)
}

function validateBudget(byteBudget: number | undefined): void {
  if (byteBudget !== undefined && (!Number.isFinite(byteBudget) || byteBudget < 0)) {
    throw new Error('Rollback byteBudget must be a finite non-negative number')
  }
}

function validateRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new Error(`Invalid rollback run id: ${runId}`)
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readStoredObjectBytes(objectsDir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(objectsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }

  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`Invalid rollback object entry: ${entry.name}`)
    bytes += (await stat(path.join(objectsDir, entry.name))).size
  }
  return bytes
}

async function verifyExistingObject(filePath: string, expected: PreparedEntry): Promise<void> {
  const info = await lstat(filePath)
  if (!info.isFile()) throw new Error(`Rollback object is not a file: ${filePath}`)
  const existing = await readFile(filePath)
  if (existing.byteLength !== expected.bytes || digest(existing) !== expected.sha256) {
    throw new Error(`Rollback object digest mismatch: ${filePath}`)
  }
}

async function writeObjectIfAbsent(entry: PreparedEntry): Promise<void> {
  if (entry.objectExists) {
    await verifyExistingObject(entry.objectPath, entry)
    return
  }

  try {
    await writeFile(entry.objectPath, entry.content, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await verifyExistingObject(entry.objectPath, entry)
  }
}

async function writeAtomicText(filePath: string, text: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function readIndex(indexPath: string): Promise<RollbackIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as Partial<RollbackIndex>
    if (parsed.version !== ROLLBACK_STORE_VERSION || !Array.isArray(parsed.runs)) {
      throw new Error(`Invalid rollback index: ${indexPath}`)
    }
    return { version: ROLLBACK_STORE_VERSION, runs: parsed.runs as RollbackIndexEntry[] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: ROLLBACK_STORE_VERSION, runs: [] }
    }
    if (error instanceof SyntaxError) throw new Error(`Invalid rollback index: ${indexPath}`)
    throw error
  }
}

export class RollbackStore {
  private readonly rootDir: string
  private readonly producer: string
  private readonly producerVersion: string
  private readonly byteBudget?: number
  private readonly now: () => Date
  private readonly runIdFactory: () => string

  constructor(options: RollbackStoreOptions) {
    requireText(options.rootDir, 'rootDir')
    requireText(options.producer, 'producer')
    requireText(options.producerVersion, 'producerVersion')
    validateBudget(options.byteBudget)
    this.rootDir = path.resolve(options.rootDir)
    this.producer = options.producer
    this.producerVersion = options.producerVersion
    this.byteBudget = options.byteBudget
    this.now = options.now ?? (() => new Date())
    this.runIdFactory = options.runIdFactory ?? randomUUID
  }

  async writeRun(entries: readonly RollbackEntryInput[]): Promise<RollbackRunResult> {
    const prepared = await this.prepareEntries(entries)
    const runId = this.runIdFactory()
    validateRunId(runId)

    const objectsDir = path.join(this.rootDir, 'objects', 'sha256')
    const runsDir = path.join(this.rootDir, 'runs')
    const runDir = path.join(runsDir, runId)
    const manifestPath = path.join(runDir, 'manifest.json')
    const indexPath = path.join(this.rootDir, 'index.json')
    const storedObjectBytes = await readStoredObjectBytes(objectsDir)
    const index = await readIndex(indexPath)

    if (index.runs.some(entry => entry.runId === runId) || await pathExists(runDir)) {
      throw new Error(`Rollback run path already exists: ${runId}`)
    }

    const newObjectDigests = new Set<string>()
    const newObjectBytes = prepared.reduce((total, entry) => {
      if (entry.objectExists || newObjectDigests.has(entry.sha256)) return total
      newObjectDigests.add(entry.sha256)
      return total + entry.bytes
    }, 0)
    if (this.byteBudget !== undefined && storedObjectBytes + newObjectBytes > this.byteBudget) {
      throw new Error(
        `Rollback byte budget exceeded: ${storedObjectBytes + newObjectBytes} > ${this.byteBudget}`,
      )
    }
    for (const entry of prepared) {
      if (entry.objectExists) await verifyExistingObject(entry.objectPath, entry)
    }

    await mkdir(objectsDir, { recursive: true })
    await mkdir(runsDir, { recursive: true })
    await mkdir(runDir)

    for (const entry of prepared) await writeObjectIfAbsent(entry)

    const createdAt = this.now().toISOString()
    const manifest: RollbackRunManifest = {
      version: ROLLBACK_STORE_VERSION,
      runId,
      createdAt,
      producer: this.producer,
      producerVersion: this.producerVersion,
      entries: prepared.map(entry => ({
        logicalPath: entry.input.logicalPath,
        objectPath: path.posix.join('objects', 'sha256', entry.sha256),
        bytes: entry.bytes,
        sha256: entry.sha256,
        restoreClass: entry.input.restoreClass,
        sourceRevision: entry.input.sourceRevision,
        producer: this.producer,
        producerVersion: this.producerVersion,
      })),
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

    const indexEntry: RollbackIndexEntry = {
      runId,
      manifestPath: path.posix.join('runs', runId, 'manifest.json'),
      createdAt,
      producer: this.producer,
      producerVersion: this.producerVersion,
      entryCount: manifest.entries.length,
      bytes: manifest.entries.reduce((total, entry) => total + entry.bytes, 0),
      newObjectBytes,
    }
    index.runs.push(indexEntry)
    await writeAtomicText(indexPath, `${JSON.stringify(index, null, 2)}\n`)

    return {
      runId,
      manifestPath,
      indexPath,
      manifest,
      indexEntry,
      newObjectBytes,
      storedObjectBytes: storedObjectBytes + newObjectBytes,
    }
  }

  private async prepareEntries(entries: readonly RollbackEntryInput[]): Promise<PreparedEntry[]> {
    const seenLogicalPaths = new Set<string>()
    const prepared: PreparedEntry[] = []
    for (const input of entries) {
      requireText(input.logicalPath, 'logicalPath')
      requireText(input.restoreClass, 'restoreClass')
      requireText(input.sourceRevision, 'sourceRevision')
      if (seenLogicalPaths.has(input.logicalPath)) {
        throw new Error(`Duplicate rollback logical path: ${input.logicalPath}`)
      }
      seenLogicalPaths.add(input.logicalPath)
      const content = asBuffer(input.content)
      const sha256 = digest(content)
      const objectPath = path.join(this.rootDir, 'objects', 'sha256', sha256)
      prepared.push({
        input,
        content,
        bytes: content.byteLength,
        sha256,
        objectPath,
        objectExists: await pathExists(objectPath),
      })
    }
    return prepared
  }
}
