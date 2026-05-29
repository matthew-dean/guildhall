import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DESIGN_STORIES_FILE } from '../design-preview.js'
import { buildDesignSystemCatalog } from '../design-system-catalog.js'

describe('buildDesignSystemCatalog', () => {
  it('normalizes Storybook story files into an interactable web catalog', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-catalog-storybook-'))
    try {
      await fs.mkdir(path.join(projectPath, 'src', 'components'), { recursive: true })
      await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify({
        scripts: { storybook: 'storybook dev -p 6006' },
        devDependencies: { '@storybook/sveltekit': '^8.0.0' },
      }, null, 2), 'utf-8')
      await fs.writeFile(path.join(projectPath, 'src', 'components', 'SegmentedFilter.stories.ts'), 'export default {}', 'utf-8')

      const catalog = await buildDesignSystemCatalog({ projectPath })

      expect(catalog.previewAdapter).toBe('storybook')
      expect(catalog.interactable).toBe(true)
      expect(catalog.entries).toEqual([
        expect.objectContaining({
          id: 'storybook-src-components-segmentedfilter-stories-ts',
          kind: 'component',
          title: 'SegmentedFilter',
          source: 'storybook',
          previewUrl: expect.stringContaining('/iframe.html'),
        }),
      ])
      expect(catalog.recommendations.join('\n')).toContain('Storybook')
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('uses Guildhall portable stories when no Storybook catalog exists', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-catalog-portable-'))
    const memoryDir = path.join(projectPath, '.guildhall')
    try {
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.writeFile(path.join(memoryDir, DESIGN_STORIES_FILE), [
        'version: 1',
        'stories:',
        '  - id: pantry-filter.default',
        '    componentIntent: segmented-filter',
        '    title: Pantry filter / Default',
        '    states: [default, selected]',
        '  - id: pantry-filter.disabled',
        '    componentIntent: segmented-filter',
        '    title: Pantry filter / Disabled',
        '    states: [disabled]',
      ].join('\n'), 'utf-8')

      const catalog = await buildDesignSystemCatalog({ projectPath, memoryDir })

      expect(catalog.previewAdapter).toBe('guildhall-portable')
      expect(catalog.interactable).toBe(true)
      expect(catalog.entries.map(entry => entry.id)).toEqual(['pantry-filter.default', 'pantry-filter.disabled'])
      expect(catalog.entries[0]).toMatchObject({
        kind: 'component',
        componentIntent: 'segmented-filter',
        states: ['default', 'selected'],
        previewUrl: '/__guildhall/design-preview/pantry-filter.default',
      })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
