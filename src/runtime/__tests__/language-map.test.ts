import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addLanguageMapCandidates,
  loadLanguageMap,
  renderLanguageMapContext,
} from '../language-map.js'

describe('project language map', () => {
  it('stores compact project terms with provenance and injects only relevant entries', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-language-map-'))

    await addLanguageMapCandidates({
      memoryDir,
      candidates: [
        {
          term: 'Thread',
          meaning: 'The project command surface where requests, questions, and work trail appear.',
          source: 'pressure-test-intake:pti-1',
        },
        {
          term: 'Language Map',
          meaning: 'A compact project glossary injected into worker context only when relevant.',
          source: 'accepted-answer:q-2',
        },
      ],
    })

    const map = await loadLanguageMap(memoryDir)
    expect(map.entries).toHaveLength(2)
    const saved = JSON.parse(await readFile(path.join(memoryDir, 'language-map.json'), 'utf-8'))
    expect(saved.version).toBe(1)
    expect(saved.entries[0]).toMatchObject({ term: 'Thread' })

    const rendered = renderLanguageMapContext(map, 'Update the Thread question card')
    expect(rendered).toContain('Thread')
    expect(rendered).not.toContain('compact project glossary')
  })
})
