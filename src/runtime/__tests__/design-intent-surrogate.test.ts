import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DESIGN_STORIES_FILE } from '../design-preview.js'
import { buildDesignIntentSurrogate } from '../design-intent-surrogate.js'

describe('buildDesignIntentSurrogate', () => {
  it('labels SwiftUI projects as browser-surrogate intent previews until native proof exists', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-ios-surrogate-'))
    const memoryDir = path.join(projectPath, '.guildhall')
    try {
      await fs.mkdir(path.join(projectPath, 'PantryPulse.xcodeproj'), { recursive: true })
      await fs.mkdir(path.join(projectPath, 'PantryPulse'), { recursive: true })
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.writeFile(
        path.join(projectPath, 'PantryPulse', 'ContentView.swift'),
        'import SwiftUI\n#Preview { ContentView() }\n',
        'utf-8',
      )
      await fs.writeFile(path.join(memoryDir, DESIGN_STORIES_FILE), [
        'version: 1',
        'stories:',
        '  - id: pantry-filter.default',
        '    componentIntent: segmented-filter',
        '    title: Pantry filter / Default',
      ].join('\n'), 'utf-8')

      const surrogate = await buildDesignIntentSurrogate({ projectPath, memoryDir })

      expect(surrogate).toMatchObject({
        platform: 'ios',
        previewMode: 'browser-surrogate',
        approximate: true,
        nativeProofRequired: true,
        surrogateUrl: '/__guildhall/design-intent-surrogate',
      })
      expect(surrogate.label).toContain('Preview approximation')
      expect(surrogate.warning).toContain('Native platform proof')
      expect(surrogate.detectedNativeTooling).toEqual(expect.arrayContaining(['xcodeproj', 'swiftui-preview']))
      expect(surrogate.componentIntents).toContain('segmented-filter')
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('uses the real web catalog when a web app has an interactable preview', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-web-surrogate-'))
    const memoryDir = path.join(projectPath, '.guildhall')
    try {
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify({
        dependencies: { svelte: '^5.0.0' },
      }), 'utf-8')
      await fs.writeFile(path.join(memoryDir, DESIGN_STORIES_FILE), [
        'version: 1',
        'stories:',
        '  - id: button.default',
        '    componentIntent: button',
        '    title: Button / Default',
      ].join('\n'), 'utf-8')

      const surrogate = await buildDesignIntentSurrogate({ projectPath, memoryDir })

      expect(surrogate).toMatchObject({
        platform: 'web',
        previewMode: 'real-web-preview',
        approximate: false,
        nativeProofRequired: false,
      })
      expect(surrogate.warning).toBeUndefined()
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
