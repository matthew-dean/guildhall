import path from 'node:path'
import { z } from 'zod'
import { discoverDesignPreviewAdapter } from './design-preview.js'

export const DesignSystemCatalogEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(['component', 'pattern', 'token']),
  title: z.string().min(1),
  source: z.enum(['storybook', 'guildhall-portable', 'none']),
  componentIntent: z.string().optional(),
  states: z.array(z.string()).default([]),
  sourcePath: z.string().optional(),
  previewUrl: z.string().optional(),
})
export type DesignSystemCatalogEntry = z.infer<typeof DesignSystemCatalogEntry>

export const DesignSystemCatalog = z.object({
  version: z.literal(1).default(1),
  previewAdapter: z.enum(['storybook', 'guildhall-portable', 'none']),
  interactable: z.boolean(),
  entries: z.array(DesignSystemCatalogEntry).default([]),
  recommendations: z.array(z.string()).default([]),
})
export type DesignSystemCatalog = z.infer<typeof DesignSystemCatalog>

export async function buildDesignSystemCatalog(input: {
  projectPath: string
  memoryDir?: string
}): Promise<DesignSystemCatalog> {
  const preview = await discoverDesignPreviewAdapter(input)
  if (preview.adapter === 'storybook') {
    const entries = (preview.storybook?.storyFiles ?? []).map(storyFile => {
      const title = storyTitleFromPath(storyFile)
      return DesignSystemCatalogEntry.parse({
        id: `storybook-${slug(storyFile)}`,
        kind: 'component',
        title,
        source: 'storybook',
        componentIntent: title,
        states: ['default'],
        sourcePath: storyFile,
        previewUrl: `${preview.storybook?.iframePath ?? '/iframe.html'}?path=/story/${slug(title)}`,
      })
    })
    return DesignSystemCatalog.parse({
      version: 1,
      previewAdapter: 'storybook',
      interactable: entries.length > 0,
      entries,
      recommendations: entries.length > 0
        ? ['Storybook is the preferred interactable catalog for this web project.']
        : ['Storybook is configured, but no story files were discovered yet.'],
    })
  }

  if (preview.adapter === 'guildhall-portable') {
    const entries = (preview.manifest?.stories ?? []).map(story => DesignSystemCatalogEntry.parse({
      id: story.id,
      kind: 'component',
      title: story.title,
      source: 'guildhall-portable',
      componentIntent: story.componentIntent,
      states: story.states,
      previewUrl: `/__guildhall/design-preview/${encodeURIComponent(story.id)}`,
    }))
    return DesignSystemCatalog.parse({
      version: 1,
      previewAdapter: 'guildhall-portable',
      interactable: entries.length > 0,
      entries,
      recommendations: entries.length > 0
        ? ['Guildhall portable stories are available as the interactable catalog until the project adopts Storybook or another native catalog.']
        : ['Add portable stories before broad UI work so Guildhall can show component states.'],
    })
  }

  return DesignSystemCatalog.parse({
    version: 1,
    previewAdapter: 'none',
    interactable: false,
    entries: [],
    recommendations: ['No interactable design-system catalog was found. Add Storybook, Ladle, docs examples, or Guildhall portable stories before broad UI work.'],
  })
}

function storyTitleFromPath(storyFile: string): string {
  return path.basename(storyFile).replace(/\.stories\.[cm]?[jt]sx?$/, '')
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
