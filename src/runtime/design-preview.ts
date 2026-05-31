import fsp from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'

export const DESIGN_STORIES_FILE = 'design-stories.yaml'

const StoryState = z.enum([
  'default',
  'hover',
  'focus',
  'active',
  'disabled',
  'selected',
  'loading',
  'empty',
  'error',
  'warning',
  'success',
  'destructive',
  'reduced-motion',
])

export const DesignStory = z.object({
  id: z.string().min(1),
  componentIntent: z.string().min(1),
  title: z.string().min(1),
  viewport: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
  states: z.array(StoryState).default(['default']),
})
export type DesignStory = z.infer<typeof DesignStory>

export const DesignStoryManifest = z.object({
  version: z.number().default(1),
  stories: z.array(DesignStory).default([]),
})
export type DesignStoryManifest = z.infer<typeof DesignStoryManifest>

export interface StorybookPreviewAdapter {
  command: string
  scripts: string[]
  configFiles: string[]
  storyFiles: string[]
  iframePath: string
}

export interface DesignPreviewAdapter {
  adapter: 'storybook' | 'guildhall-portable' | 'none'
  source: 'repo' | 'guildhall' | 'none'
  summary: string
  storybook?: StorybookPreviewAdapter
  manifest?: DesignStoryManifest
  warnings: string[]
}

export async function discoverDesignPreviewAdapter(input: {
  projectPath: string
  memoryDir?: string
}): Promise<DesignPreviewAdapter> {
  const storybook = await discoverStorybook(input.projectPath)
  if (storybook) {
    return {
      adapter: 'storybook',
      source: 'repo',
      summary: `Storybook preview detected with ${storybook.storyFiles.length} story file(s).`,
      storybook,
      warnings: [],
    }
  }

  const manifest = await loadPortableStoryManifest(input.memoryDir ?? path.join(input.projectPath, '.guildhall'))
  if (manifest) {
    return {
      adapter: 'guildhall-portable',
      source: 'guildhall',
      summary: `Guildhall portable design preview with ${manifest.stories.length} portable story/stories.`,
      manifest,
      warnings: [],
    }
  }

  return {
    adapter: 'none',
    source: 'none',
    summary: 'No design preview surface is configured yet.',
    warnings: ['No Storybook setup or Guildhall portable story manifest was found.'],
  }
}

async function discoverStorybook(projectPath: string): Promise<StorybookPreviewAdapter | null> {
  const scripts = await storybookScripts(projectPath)
  const configFiles = await existingFiles(projectPath, [
    '.storybook/main.js',
    '.storybook/main.cjs',
    '.storybook/main.mjs',
    '.storybook/main.ts',
    '.storybook/main.tsx',
  ])
  const storyFiles = await findStoryFiles(projectPath)
  if (scripts.length === 0 && configFiles.length === 0 && storyFiles.length === 0) return null
  const command = scripts[0] ? `npm run ${scripts[0]}` : 'npx storybook dev -p 6006'
  return {
    command,
    scripts,
    configFiles,
    storyFiles,
    iframePath: '/iframe.html',
  }
}

async function storybookScripts(projectPath: string): Promise<string[]> {
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    const parsed = JSON.parse(await fsp.readFile(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, unknown>
    }
    return Object.entries(parsed.scripts ?? {})
      .filter(([name, command]) =>
        /storybook/i.test(name) ||
        (typeof command === 'string' && /\b(storybook|start-storybook)\b/i.test(command)),
      )
      .map(([name]) => name)
      .sort((left, right) => {
        if (left === 'storybook') return -1
        if (right === 'storybook') return 1
        return left.localeCompare(right)
      })
  } catch {
    return []
  }
}

async function existingFiles(projectPath: string, relativePaths: string[]): Promise<string[]> {
  const found: string[] = []
  for (const relativePath of relativePaths) {
    try {
      const stat = await fsp.stat(path.join(projectPath, relativePath))
      if (stat.isFile()) found.push(relativePath)
    } catch {
      // absent
    }
  }
  return found
}

async function findStoryFiles(projectPath: string): Promise<string[]> {
  const out: string[] = []
  await walk(projectPath, projectPath, out, 0)
  return out.sort()
}

async function walk(root: string, dir: string, out: string[], depth: number): Promise<void> {
  if (depth > 8 || out.length >= 200) return
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, full, out, depth + 1)
    } else if (entry.isFile() && /\.stories\.[cm]?[jt]sx?$/.test(entry.name)) {
      out.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
}

async function loadPortableStoryManifest(memoryDir: string): Promise<DesignStoryManifest | null> {
  try {
    const raw = await fsp.readFile(path.join(memoryDir, DESIGN_STORIES_FILE), 'utf-8')
    return DesignStoryManifest.parse(yaml.load(raw) ?? {})
  } catch {
    return null
  }
}
