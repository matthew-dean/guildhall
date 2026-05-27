import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadRichArtifactRecord, saveRichArtifactRecord } from '../artifact-store.js'

describe('rich artifact store', () => {
  it('persists source, render tree, fallback, validation, provenance, and hash', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-artifacts-'))

    const saved = await saveRichArtifactRecord({
      memoryDir,
      taskId: 'task-1',
      artifact: {
        contentType: 'guildhall-html-v1',
        artifactKind: 'blueprint',
        title: 'Release map',
        html: '<section><gh-decision title="Ship?"><gh-option value="yes" recommended="true">Yes</gh-option></gh-decision></section>',
        fallbackMarkdown: '## Release map\n\nShip?',
        createdBy: 'coordinator-agent',
        schemaVersion: 1,
      },
    })

    expect(saved.validation.ok).toBe(true)
    expect(saved.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.renderTree.components).toContainEqual({
      type: 'gh-decision',
      props: { title: 'Ship?' },
    })

    const reloaded = await loadRichArtifactRecord({
      memoryDir,
      taskId: 'task-1',
      artifactId: saved.id,
    })
    expect(reloaded).toMatchObject({
      id: saved.id,
      source: { html: expect.stringContaining('gh-decision') },
      fallbackMarkdown: '## Release map\n\nShip?',
      provenance: { createdBy: 'coordinator-agent' },
    })
  })
})
