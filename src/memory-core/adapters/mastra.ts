import { createRequire } from 'node:module'

import { initializeMemoryStoreDirectory, resolveMemoryPaths } from '../data-access.js'
import { scopeToMastraIds } from '../scopes.js'
import { isEphemeralProjectRoot } from '@guildhall/sessions'
import type {
  GuildhallMemoryScope,
  MastraMemoryCoreAdapter,
  MastraMemoryCoreHealth,
} from '../types.js'

const require = createRequire(import.meta.url)

interface MastraStorageLike {
  init?: () => Promise<void>
}

interface MastraMemoryLike {
  createThread?: (input: {
    id: string
    resourceId: string
    title: string
  }) => Promise<unknown>
  createOMProcessor?: (messages: unknown[], instructions?: unknown) => Promise<unknown>
}

export async function createMastraMemoryCoreAdapter(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
  readOnly?: boolean
  /** Temporary project roots must not allocate durable memory databases. */
  storage?: 'auto' | 'persistent' | 'ephemeral'
  semanticRecall?: boolean
  observationalMemory?: boolean
}): Promise<MastraMemoryCoreAdapter> {
  const { Memory, LibSQLStore, versions } = loadMastraRuntime()
  const paths = resolveMemoryPaths({ projectRoot: input.projectRoot, scope: input.scope })
  // Read-only construction must not allocate a durable database. Persistent
  // storage is explicit for reads; write-mode auto storage remains durable for
  // registered projects unless the caller selects ephemeral storage.
  const persistentStorage = input.storage === 'persistent' ||
    (!input.readOnly && input.storage !== 'ephemeral' && !isEphemeralProjectRoot(input.projectRoot))
  if (persistentStorage) await initializeMemoryStoreDirectory(paths)
  const scope = scopeToMastraIds(input.scope)
  const storage = new LibSQLStore({
    id: `guildhall-memory-${scope.resourceId.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
    url: persistentStorage ? `file:${paths.dbPath}` : 'file::memory:',
  })
  if (typeof storage.init === 'function') await storage.init()
  const warnings: string[] = []
  const engineGatePassed = memoryEngineGatePassed()
  const semanticRecallRequested = input.semanticRecall ?? false
  const observationalMemoryRequested = input.observationalMemory ?? false
  let semanticRecallEnabled = false
  let observationalMemoryEnabled = false
  if (semanticRecallRequested) {
    if (!engineGatePassed) {
      warnings.push('Semantic recall requested but held behind the memory engine quality gate.')
    } else {
      warnings.push('Semantic recall requested but no vector store is configured.')
    }
  }
  if (observationalMemoryRequested) {
    if (!engineGatePassed) {
      warnings.push('Observational Memory requested but held behind the memory engine quality gate.')
    } else {
      observationalMemoryEnabled = true
    }
  }
  const memory = new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: input.readOnly ? 10 : 20,
      readOnly: input.readOnly ?? false,
      semanticRecall: semanticRecallEnabled,
      observationalMemory: observationalMemoryEnabled,
    },
  })
  let observationalProcessorReady = false
  if (observationalMemoryEnabled) {
    if (typeof memory.createOMProcessor === 'function') {
      try {
        await memory.createOMProcessor([], undefined)
        observationalProcessorReady = true
      } catch (err) {
        warnings.push(
          `Mastra observational memory processor unavailable: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      warnings.push('Mastra observational memory processor unavailable: createOMProcessor missing')
    }
  }
  // Read paths must be observational. Creating a thread here used to append
  // one Mastra row on every summary/read, turning a cheap projection into an
  // unbounded write workload (and eventually a multi-megabyte thread table).
  if (!input.readOnly && typeof memory.createThread === 'function') {
    await memory.createThread({
      id: scope.threadId,
      resourceId: scope.resourceId,
      title: 'Guildhall memory-core thread',
    })
  }
  const health: MastraMemoryCoreHealth = {
    adapter: 'mastra',
    storagePath: persistentStorage ? paths.dbPath : 'file::memory:',
    repoLocalWrites: [],
    features: [
      'libsql-storage',
      'thread-resource-scope',
      persistentStorage ? 'persistent-storage' : 'ephemeral-storage',
      input.readOnly ? 'read-only-mode' : 'write-mode',
      semanticRecallEnabled
        ? 'semantic-recall-enabled'
        : semanticRecallRequested && engineGatePassed
          ? 'semantic-recall-vector-unavailable'
          : semanticRecallRequested
            ? 'semantic-recall-gated'
            : 'semantic-recall-disabled',
      observationalMemoryEnabled
        ? 'observational-memory-enabled'
        : observationalMemoryRequested
          ? 'observational-memory-gated'
          : 'observational-memory-disabled',
      observationalProcessorReady ? 'observational-memory-processor' : 'observational-memory-processor-off',
    ],
    scope,
    packages: versions,
    warnings,
    semanticRecallEnabled,
    observationalMemoryEnabled,
    observationalProcessorReady,
  }
  return {
    health,
    memory,
    storage,
    close: async () => {
      if (typeof storage === 'object' && storage !== null && 'close' in storage && typeof storage.close === 'function') {
        await storage.close()
      }
    },
  }
}

function memoryEngineGatePassed(): boolean {
  return process.env.GUILDHALL_MEMORY_ENGINE_GATE === 'passed'
    || process.env.GUILDHALL_MEMORY_ENGINE_GATE === '1'
}

function loadMastraRuntime(): {
  Memory: new (input: Record<string, unknown>) => MastraMemoryLike
  LibSQLStore: new (input: Record<string, unknown>) => MastraStorageLike
  versions: Record<string, string>
} {
  const memoryPackage = require('@mastra/memory') as { Memory: new (input: Record<string, unknown>) => MastraMemoryLike }
  const libsqlPackage = require('@mastra/libsql') as { LibSQLStore: new (input: Record<string, unknown>) => MastraStorageLike }
  return {
    Memory: memoryPackage.Memory,
    LibSQLStore: libsqlPackage.LibSQLStore,
    versions: {
      '@mastra/core': packageVersion('@mastra/core/package.json'),
      '@mastra/libsql': packageVersion('@mastra/libsql/package.json'),
      '@mastra/memory': packageVersion('@mastra/memory/package.json'),
    },
  }
}

function packageVersion(packageJsonPath: string): string {
  try {
    return (require(packageJsonPath) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
