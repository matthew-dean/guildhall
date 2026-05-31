import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { DESIGN_SYSTEM_FILE } from '@guildhall/core'
import { DESIGN_STORIES_FILE } from '../design-preview.js'
import { buildDesignSystemProfile } from '../design-system-discovery.js'

describe('buildDesignSystemProfile', () => {
  it('detects Looma packages, Storybook, token files, and drafted Guildhall design system', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-ds-discovery-looma-'))
    const memoryDir = path.join(projectPath, '.guildhall')
    try {
      await fs.mkdir(path.join(projectPath, '.storybook'), { recursive: true })
      await fs.mkdir(path.join(projectPath, 'src', 'components'), { recursive: true })
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          scripts: { storybook: 'storybook dev -p 6006' },
          dependencies: {
            '@looma/core': '0.1.0',
            '@looma/tokens': '0.1.0',
            '@radix-ui/react-dialog': '^1.0.0',
          },
          devDependencies: { '@storybook/sveltekit': '^8.0.0' },
        }, null, 2),
        'utf-8',
      )
      await fs.writeFile(path.join(projectPath, '.storybook', 'main.ts'), 'export default {}', 'utf-8')
      await fs.writeFile(path.join(projectPath, 'src', 'components', 'Button.stories.ts'), 'export default {}', 'utf-8')
      await fs.writeFile(path.join(projectPath, 'src', 'tokens.css'), ':root { --ui-radius-2: .5rem; }', 'utf-8')
      await fs.writeFile(
        path.join(memoryDir, DESIGN_SYSTEM_FILE),
        yaml.dump({
          version: 1,
          revision: 2,
          tokens: {
            color: [{ name: 'accent', value: '#2563eb' }],
            spacing: [],
            typography: [],
            radius: [{ name: 'soft', value: '0.5rem' }],
            shadow: [],
          },
          primitives: [{ name: 'Segmented filter', usage: 'Mutually exclusive mode choices.' }],
          approvedAt: '2026-05-28T12:00:00.000Z',
        }),
        'utf-8',
      )

      const profile = await buildDesignSystemProfile({ projectPath, memoryDir })

      expect(profile.primarySystem).toBe('looma')
      expect(profile.libraries.map(library => library.id)).toEqual(expect.arrayContaining(['looma', 'radix']))
      expect(profile.preview.adapter).toBe('storybook')
      expect(profile.tokenFiles).toContain('src/tokens.css')
      expect(profile.guildhallDesignSystem).toMatchObject({
        drafted: true,
        approved: true,
        revision: 2,
      })
      expect(profile.proofContract.targetDesignSystem).toBe('looma')
      expect(profile.proofContract.componentIntents).toContain('Segmented filter')
      expect(profile.recommendations.join('\n')).toContain('Looma')
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('falls back to portable preview and library-agnostic recommendations when no known library exists', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-ds-discovery-portable-'))
    const memoryDir = path.join(projectPath, '.guildhall')
    try {
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({ dependencies: { svelte: '^5.0.0' } }, null, 2),
        'utf-8',
      )
      await fs.writeFile(
        path.join(memoryDir, DESIGN_STORIES_FILE),
        [
          'version: 1',
          'stories:',
          '  - id: pantry-filter.default',
          '    componentIntent: segmented-filter',
          '    title: Pantry filter / Default',
          '    states: [default, selected]',
        ].join('\n'),
        'utf-8',
      )

      const profile = await buildDesignSystemProfile({ projectPath, memoryDir })

      expect(profile.primarySystem).toBe('portable')
      expect(profile.preview.adapter).toBe('guildhall-portable')
      expect(profile.libraries).toEqual([])
      expect(profile.proofContract.targetDesignSystem).toBe('portable')
      expect(profile.proofContract.componentIntents).toContain('segmented-filter')
      expect(profile.recommendations.join('\n')).toContain('portable')
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
