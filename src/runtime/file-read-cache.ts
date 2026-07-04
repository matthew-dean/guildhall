import fsp from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

type CacheEntry<T> = {
  mtimeMs: number
  size: number
  value: T
}

const jsonCache = new Map<string, CacheEntry<unknown>>()
const textCache = new Map<string, CacheEntry<string>>()
const yamlCache = new Map<string, CacheEntry<unknown>>()

export function invalidateCachedFile(file: string): void {
  jsonCache.delete(file)
  textCache.delete(file)
  yamlCache.delete(file)
}

async function readStat(file: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const stat = await fsp.stat(file)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function matches(entry: CacheEntry<unknown> | undefined, stat: { mtimeMs: number; size: number }): boolean {
  return !!entry && entry.mtimeMs === stat.mtimeMs && entry.size === stat.size
}

export async function readCachedText(file: string): Promise<string | null> {
  const stat = await readStat(file)
  if (!stat) {
    textCache.delete(file)
    return null
  }
  const cached = textCache.get(file)
  if (matches(cached, stat)) return cached!.value
  const value = await fsp.readFile(file, 'utf8')
  textCache.set(file, { ...stat, value })
  return value
}

export async function readCachedJson<T>(file: string): Promise<T | null> {
  const stat = await readStat(file)
  if (!stat) {
    jsonCache.delete(file)
    return null
  }
  const cached = jsonCache.get(file)
  if (matches(cached, stat)) return cached!.value as T
  const raw = await fsp.readFile(file, 'utf8')
  const value = JSON.parse(raw) as T
  jsonCache.set(file, { ...stat, value })
  return value
}

export async function readCachedYaml<T>(file: string): Promise<T | null> {
  const stat = await readStat(file)
  if (!stat) {
    yamlCache.delete(file)
    return null
  }
  const cached = yamlCache.get(file)
  if (matches(cached, stat)) return cached!.value as T
  const raw = await fsp.readFile(file, 'utf8')
  const value = parseYaml(raw) as T
  yamlCache.set(file, { ...stat, value })
  return value
}
