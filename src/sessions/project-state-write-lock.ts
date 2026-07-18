import { AsyncLocalStorage } from 'node:async_hooks'

type WriteLockStore = Set<string>

const activeLocks = new AsyncLocalStorage<WriteLockStore>()
const tails = new Map<string, Promise<void>>()

/**
 * Serialize project-state read/modify/write operations within this process.
 * SQLite still provides the durable transaction boundary; this lock keeps
 * async callers from reading one revision and writing another before their
 * compare-and-swap reaches SQLite. Re-entry is allowed for shared runtime
 * helpers that already hold the project lock.
 */
export function withProjectStateWriteLock<T>(
  projectStateKey: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const current = activeLocks.getStore()
  if (current?.has(projectStateKey)) return Promise.resolve(operation())

  const previous = tails.get(projectStateKey) ?? Promise.resolve()
  const run = previous.then(async () => {
    const next = new Set(current ?? [])
    next.add(projectStateKey)
    return activeLocks.run(next, operation)
  })
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  tails.set(projectStateKey, tail)
  void tail.finally(() => {
    if (tails.get(projectStateKey) === tail) tails.delete(projectStateKey)
  })
  return run
}
