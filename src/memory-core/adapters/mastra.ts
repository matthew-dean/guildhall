import { createRequire } from 'node:module'

import { initializeMemoryStoreDirectory, resolveMemoryPaths } from '../data-access.js'
import { scopeToMastraIds } from '../scopes.js'
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
}

export async function createMastraMemoryCoreAdapter(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
  readOnly?: boolean
}): Promise<MastraMemoryCoreAdapter> {
  const { Memory, LibSQLStore, versions } = loadMastraRuntime()
  const paths = resolveMemoryPaths({ projectRoot: input.projectRoot, scope: input.scope })
  await initializeMemoryStoreDirectory(paths)
  const scope = scopeToMastraIds(input.scope)
  const storage = new LibSQLStore({
    id: `guildhall-memory-${scope.resourceId.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
    url: `file:${paths.dbPath}`,
  })
  if (typeof storage.init === 'function') await storage.init()
  const memory = new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: input.readOnly ? 10 : 20,
      readOnly: input.readOnly ?? false,
      semanticRecall: false,
      observationalMemory: false,
    },
  })
  if (typeof memory.createThread === 'function') {
    await memory.createThread({
      id: scope.threadId,
      resourceId: scope.resourceId,
      title: 'Guildhall memory-core thread',
    })
  }
  const health: MastraMemoryCoreHealth = {
    adapter: 'mastra',
    storagePath: paths.dbPath,
    repoLocalWrites: [],
    features: [
      'libsql-storage',
      'thread-resource-scope',
      input.readOnly ? 'read-only-mode' : 'write-mode',
      'semantic-recall-disabled',
    ],
    scope,
    packages: versions,
    warnings: [],
  }
  return { health, memory, storage }
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
