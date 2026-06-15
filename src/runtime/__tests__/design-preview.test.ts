import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { discoverDesignPreviewAdapter, DESIGN_STORIES_FILE } from '../design-preview.js'
import { projectStatePathFromMemoryDir } from '@guildhall/sessions'

describe('discoverDesignPreviewAdapter', () => {
  it('prefers an existing Storybook setup when scripts, config, and stories exist', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-storybook-'))
    try {
      await fs.mkdir(path.join(projectPath, '.storybook'), { recursive: true })
      await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          scripts: {
            storybook: 'storybook dev -p 6006',
          },
          devDependencies: {
            '@storybook/sveltekit': '^8.0.0',
          },
        }, null, 2),
        'utf-8',
      )
      await fs.writeFile(path.join(projectPath, '.storybook', 'main.ts'), 'export default {}', 'utf-8')
      await fs.writeFile(path.join(projectPath, 'src', 'Button.stories.ts'), 'export default {}', 'utf-8')

      const adapter = await discoverDesignPreviewAdapter({ projectPath })

      expect(adapter).toMatchObject({
        adapter: 'storybook',
        source: 'repo',
        summary: expect.stringContaining('Storybook'),
        storybook: {
          command: 'npm run storybook',
          configFiles: ['.storybook/main.ts'],
          storyFiles: ['src/Button.stories.ts'],
        },
      })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('falls back to a portable Guildhall story manifest when Storybook is absent', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-portable-stories-'))
    const memoryDir = path.join(projectPath, '.guildhall')
    try {
      await fs.mkdir(memoryDir, { recursive: true })
      const storiesPath = projectStatePathFromMemoryDir(memoryDir, DESIGN_STORIES_FILE)
      await fs.mkdir(path.dirname(storiesPath), { recursive: true })
      await fs.writeFile(
        storiesPath,
        [
          'version: 1',
          'stories:',
          '  - id: pantry-filter.default',
          '    componentIntent: segmented-filter',
          '    title: Pantry filter / Default',
          '    viewport: mobile',
          '    props:',
          '      selected: all',
          '    states:',
          '      - default',
          '      - focus',
          '      - selected',
        ].join('\n'),
        'utf-8',
      )

      const adapter = await discoverDesignPreviewAdapter({ projectPath, memoryDir })

      expect(adapter).toMatchObject({
        adapter: 'guildhall-portable',
        source: 'guildhall',
        summary: expect.stringContaining('portable'),
        manifest: {
          stories: [{
            id: 'pantry-filter.default',
            componentIntent: 'segmented-filter',
            title: 'Pantry filter / Default',
            viewport: 'mobile',
            states: ['default', 'focus', 'selected'],
          }],
        },
      })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('returns none with setup guidance when no preview surface exists', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-no-preview-'))
    try {
      const adapter = await discoverDesignPreviewAdapter({ projectPath })

      expect(adapter).toMatchObject({
        adapter: 'none',
        source: 'none',
      })
      expect(adapter.summary).toContain('No design preview surface')
      expect(adapter.warnings).toContain('No Storybook setup or Guildhall portable story manifest was found.')
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
