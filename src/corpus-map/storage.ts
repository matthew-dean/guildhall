import fs from 'node:fs/promises'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import type {
  CodebaseMap,
  CodebaseMapHistoryEvent,
  CodebaseMapStaleState,
  CorpusOverrideNote,
  CorpusOverrides,
} from './types.js'

export const CODEBASE_MAP_FILENAME = 'codebase-map.yaml'
export const CODEBASE_MAP_HISTORY_FILENAME = 'codebase-map.history.jsonl'
export const CODEBASE_MAP_STALE_FILENAME = 'codebase-map.stale.json'
export const CODEBASE_MAP_OVERRIDES_FILENAME = 'codebase-map.overrides.yaml'

export function codebaseMapPath(memoryDir: string): string {
  return path.join(memoryDir, CODEBASE_MAP_FILENAME)
}

export function codebaseMapHistoryPath(memoryDir: string): string {
  return path.join(memoryDir, CODEBASE_MAP_HISTORY_FILENAME)
}

export function codebaseMapStalePath(memoryDir: string): string {
  return path.join(memoryDir, CODEBASE_MAP_STALE_FILENAME)
}

export function codebaseMapOverridesPath(memoryDir: string): string {
  return path.join(memoryDir, CODEBASE_MAP_OVERRIDES_FILENAME)
}

export async function loadCodebaseMap(memoryDir: string): Promise<CodebaseMap | null> {
  try {
    const raw = await fs.readFile(codebaseMapPath(memoryDir), 'utf-8')
    return parse(raw) as CodebaseMap
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function saveCodebaseMap(memoryDir: string, map: CodebaseMap): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.writeFile(
    codebaseMapPath(memoryDir),
    stringify(map, { lineWidth: 120 }),
    'utf-8',
  )
}

export async function loadCorpusOverrides(memoryDir: string): Promise<CorpusOverrides | undefined> {
  try {
    const raw = await fs.readFile(codebaseMapOverridesPath(memoryDir), 'utf-8')
    return parse(raw) as CorpusOverrides
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

export async function saveCorpusOverrides(memoryDir: string, overrides: CorpusOverrides): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.writeFile(
    codebaseMapOverridesPath(memoryDir),
    stringify(overrides, { lineWidth: 120 }),
    'utf-8',
  )
}

export async function recordCorpusOverride(memoryDir: string, note: CorpusOverrideNote): Promise<void> {
  const current = await loadCorpusOverrides(memoryDir) ?? {}
  const conventions = [...(current.conventions ?? []), note]
  await saveCorpusOverrides(memoryDir, { ...current, conventions })
}

export async function appendCodebaseMapHistory(
  memoryDir: string,
  event: CodebaseMapHistoryEvent,
): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.appendFile(codebaseMapHistoryPath(memoryDir), `${JSON.stringify(event)}\n`, 'utf-8')
}

export async function loadCodebaseMapStaleState(memoryDir: string): Promise<CodebaseMapStaleState | null> {
  try {
    return JSON.parse(await fs.readFile(codebaseMapStalePath(memoryDir), 'utf-8')) as CodebaseMapStaleState
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function saveCodebaseMapStaleState(
  memoryDir: string,
  state: CodebaseMapStaleState,
): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.writeFile(codebaseMapStalePath(memoryDir), JSON.stringify(state, null, 2), 'utf-8')
}

export async function clearCodebaseMapStaleState(memoryDir: string): Promise<void> {
  await fs.rm(codebaseMapStalePath(memoryDir), { force: true })
}
