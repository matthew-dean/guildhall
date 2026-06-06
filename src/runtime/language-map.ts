import { writeManagedTextFileSync } from '@guildhall/persistence'
import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'

export const LanguageMapEntry = z.object({
  term: z.string(),
  meaning: z.string(),
  sources: z.array(z.string()).default([]),
})
export type LanguageMapEntry = z.infer<typeof LanguageMapEntry>

export const LanguageMap = z.object({
  version: z.literal(1),
  entries: z.array(LanguageMapEntry).default([]),
  updatedAt: z.string(),
})
export type LanguageMap = z.infer<typeof LanguageMap>

export async function loadLanguageMap(memoryDir: string): Promise<LanguageMap> {
  try {
    const raw = await readManagedTextFile(languageMapPath(memoryDir), 'utf-8')
    return LanguageMap.parse(JSON.parse(raw))
  } catch {
    return { version: 1, entries: [], updatedAt: new Date(0).toISOString() }
  }
}

export async function addLanguageMapCandidates(input: {
  memoryDir: string
  candidates: Array<{ term: string; meaning: string; source: string }>
}): Promise<LanguageMap> {
  const map = await loadLanguageMap(input.memoryDir)
  for (const candidate of input.candidates) {
    const term = candidate.term.trim()
    const meaning = candidate.meaning.trim()
    if (!term || !meaning) continue
    const existing = map.entries.find(entry => entry.term.toLowerCase() === term.toLowerCase())
    if (existing) {
      existing.meaning = meaning.length > existing.meaning.length ? meaning : existing.meaning
      if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source)
    } else {
      map.entries.push({ term, meaning, sources: [candidate.source] })
    }
  }
  map.updatedAt = new Date().toISOString()
  await fsp.mkdir(input.memoryDir, { recursive: true })
  writeManagedTextFileSync(languageMapPath(input.memoryDir), JSON.stringify(map, null, 2) + '\n')
  return map
}

export function renderLanguageMapContext(map: LanguageMap, taskText: string): string {
  const lower = taskText.toLowerCase()
  const entries = map.entries.filter(entry => lower.includes(entry.term.toLowerCase()))
  if (entries.length === 0) return ''
  return [
    '## Project Language Map',
    ...entries.map(entry => `- **${entry.term}:** ${entry.meaning}`),
  ].join('\n')
}

function languageMapPath(memoryDir: string): string {
  return path.join(memoryDir, 'language-map.json')
}
