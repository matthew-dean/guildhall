import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  DESIGN_TASTE_FILE,
  designTastePath,
  loadEffectiveDesignTaste,
  summarizeDesignTaste,
} from '../design-taste.js'

describe('design taste store', () => {
  it('loads built-in defaults when no override files exist', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-taste-default-'))
    const userTastePath = path.join(memoryDir, 'missing-user-design-taste.yaml')
    try {
      const packet = await loadEffectiveDesignTaste({ memoryDir, userTastePath })

      expect(packet.taste.opinions.interactionSemantics.mutuallyExclusiveModes).toBe('segmented-control-or-tabs')
      expect(packet.taste.opinions.paletteStrategy.avoid).toContain('all-purple-gradient-app')
      expect(packet.taste.opinions.paletteStrategy.avoid).toContain('generic-cool-blue-utility-app')
      expect(packet.taste.patternRecipes.pantryPulsePalette).toMatchObject({
        preferred: 'warm-off-white-plus-sage-primary',
      })
      expect(packet.layers).toEqual([
        expect.objectContaining({ id: 'builtin', applied: true }),
        expect.objectContaining({ id: 'user', applied: false, path: userTastePath }),
        expect.objectContaining({ id: 'project', applied: false, path: designTastePath(memoryDir) }),
      ])
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('merges user and project overrides with project taking precedence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-taste-merge-'))
    const memoryDir = path.join(root, '.guildhall')
    const userTastePath = path.join(root, 'user-design-taste.yaml')
    try {
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.writeFile(userTastePath, yaml.dump({
        opinions: {
          paletteStrategy: {
            defaultMode: 'semantic-oklch-roles',
            avoid: ['flat-gray-enterprise'],
          },
          visualDirection: {
            default: 'quiet-operational-polish',
          },
        },
        patternRecipes: {
          filterModes: {
            preferred: 'tabs',
          },
        },
      }), 'utf-8')
      await fs.writeFile(designTastePath(memoryDir), yaml.dump({
        opinions: {
          paletteStrategy: {
            avoid: ['generic-dark-saas-slate'],
          },
          visualDirection: {
            default: 'warm-functional-polish',
            avoid: ['stock-gradient-background'],
          },
        },
        patternRecipes: {
          filterModes: {
            preferred: 'segmented-control',
            alternatives: ['tabs'],
          },
        },
      }), 'utf-8')

      const packet = await loadEffectiveDesignTaste({ memoryDir, userTastePath })

      expect(packet.taste.opinions.paletteStrategy.defaultMode).toBe('semantic-oklch-roles')
      expect(packet.taste.opinions.paletteStrategy.avoid).toEqual(expect.arrayContaining([
        'all-purple-gradient-app',
        'flat-gray-enterprise',
        'generic-dark-saas-slate',
      ]))
      expect(packet.taste.opinions.visualDirection.default).toBe('warm-functional-polish')
      expect(packet.taste.patternRecipes.filterModes).toMatchObject({
        preferred: 'segmented-control',
        alternatives: ['tabs'],
      })
      expect(packet.layers.map(layer => `${layer.id}:${layer.applied}`)).toEqual([
        'builtin:true',
        'user:true',
        'project:true',
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('summarizes taste for compact UI and agent context', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-taste-summary-'))
    try {
      const packet = await loadEffectiveDesignTaste({
        memoryDir,
        userTastePath: path.join(memoryDir, 'missing.yaml'),
      })

      expect(summarizeDesignTaste(packet.taste)).toContain('mutually exclusive modes use segmented-control-or-tabs')
      expect(summarizeDesignTaste(packet.taste)).toContain('palette semantic-oklch-roles')
      expect(summarizeDesignTaste(packet.taste)).toContain('generic-cool-blue-utility-app')
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })
})
