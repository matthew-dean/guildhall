import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { DesignSystem } from '@guildhall/core'
import { discoverDesignPreviewAdapter, type DesignPreviewAdapter } from './design-preview.js'
import { loadDesignSystem } from './design-system-store.js'

export const DesignSystemLibrary = z.object({
  id: z.string(),
  label: z.string(),
  packages: z.array(z.string()).default([]),
  role: z.enum(['foundation', 'primitive', 'utility', 'unknown']).default('unknown'),
})
export type DesignSystemLibrary = z.infer<typeof DesignSystemLibrary>

export const GuildhallDesignSystemProfileSummary = z.object({
  drafted: z.boolean(),
  approved: z.boolean(),
  revision: z.number().optional(),
  tokenCounts: z.object({
    color: z.number(),
    spacing: z.number(),
    typography: z.number(),
    radius: z.number(),
    shadow: z.number(),
  }),
  primitives: z.array(z.string()).default([]),
})
export type GuildhallDesignSystemProfileSummary = z.infer<typeof GuildhallDesignSystemProfileSummary>

export const DesignProofContract = z.object({
  targetDesignSystem: z.string(),
  previewAdapter: z.string(),
  componentIntents: z.array(z.string()).default([]),
  tokenSources: z.array(z.string()).default([]),
  requiredMatrices: z.array(z.string()).default([]),
})
export type DesignProofContract = z.infer<typeof DesignProofContract>

export const DesignSystemProfile = z.object({
  version: z.literal(1).default(1),
  primarySystem: z.string(),
  libraries: z.array(DesignSystemLibrary).default([]),
  preview: z.any(),
  tokenFiles: z.array(z.string()).default([]),
  componentFiles: z.array(z.string()).default([]),
  guildhallDesignSystem: GuildhallDesignSystemProfileSummary,
  proofContract: DesignProofContract,
  recommendations: z.array(z.string()).default([]),
})
export type DesignSystemProfile = z.infer<typeof DesignSystemProfile>

export async function buildDesignSystemProfile(input: {
  projectPath: string
  memoryDir?: string
}): Promise<DesignSystemProfile> {
  const memoryDir = input.memoryDir ?? path.join(input.projectPath, '.guildhall')
  const [packageInfo, preview, designSystem, files] = await Promise.all([
    readPackageInfo(input.projectPath),
    discoverDesignPreviewAdapter({ projectPath: input.projectPath, memoryDir }),
    loadDesignSystem(memoryDir).catch(() => undefined),
    scanDesignFiles(input.projectPath),
  ])

  const libraries = detectLibraries(packageInfo)
  const primarySystem = libraries.find(library => library.id === 'looma')?.id
    ?? libraries.find(library => library.role === 'foundation')?.id
    ?? 'portable'
  const guildhallDesignSystem = summarizeGuildhallDesignSystem(designSystem)
  const componentIntents = [
    ...guildhallDesignSystem.primitives,
    ...(preview.manifest?.stories ?? []).map(story => story.componentIntent),
  ].filter(unique)
  const proofContract: DesignProofContract = {
    targetDesignSystem: primarySystem,
    previewAdapter: preview.adapter,
    componentIntents,
    tokenSources: [
      ...files.tokenFiles,
      ...(guildhallDesignSystem.drafted ? ['.guildhall/design-system.yaml'] : []),
    ],
    requiredMatrices: ['state', 'viewport', 'theme'],
  }

  return DesignSystemProfile.parse({
    version: 1,
    primarySystem,
    libraries,
    preview,
    tokenFiles: files.tokenFiles,
    componentFiles: files.componentFiles,
    guildhallDesignSystem,
    proofContract,
    recommendations: recommendations({ primarySystem, libraries, preview, designSystem, tokenFiles: files.tokenFiles }),
  })
}

interface PackageInfo {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

async function readPackageInfo(projectPath: string): Promise<PackageInfo> {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(projectPath, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
      scripts?: Record<string, unknown>
    }
    return {
      dependencies: stringRecord(parsed.dependencies),
      devDependencies: stringRecord(parsed.devDependencies),
      scripts: stringRecord(parsed.scripts),
    }
  } catch {
    return { dependencies: {}, devDependencies: {}, scripts: {} }
  }
}

function detectLibraries(info: PackageInfo): DesignSystemLibrary[] {
  const packages = new Set([...Object.keys(info.dependencies), ...Object.keys(info.devDependencies)])
  const libraries: DesignSystemLibrary[] = []
  addLibrary(libraries, packages, 'looma', 'Looma', /^@looma\//, 'foundation')
  addLibrary(libraries, packages, 'radix', 'Radix', /^@radix-ui\//, 'primitive')
  addLibrary(libraries, packages, 'mui', 'MUI', /^@mui\//, 'foundation')
  addLibrary(libraries, packages, 'chakra', 'Chakra UI', /^@chakra-ui\//, 'foundation')
  addLibrary(libraries, packages, 'tailwind', 'Tailwind CSS', /^tailwindcss$/, 'utility')
  addLibrary(libraries, packages, 'panda', 'Panda CSS', /^@pandacss\//, 'utility')
  addLibrary(libraries, packages, 'storybook', 'Storybook', /^(@storybook\/|storybook$)/, 'utility')
  return libraries
}

async function scanDesignFiles(projectPath: string): Promise<{ tokenFiles: string[]; componentFiles: string[] }> {
  const tokenFiles: string[] = []
  const componentFiles: string[] = []
  await walk(projectPath, projectPath, (relativePath) => {
    const normalized = relativePath.replace(/\\/g, '/')
    const basename = path.basename(normalized).toLowerCase()
    if (
      /(^|[-_.])(tokens?|theme|variables)\.(css|scss|ts|js|json)$/.test(basename) ||
      normalized.includes('/tokens/') ||
      normalized.includes('/themes/')
    ) {
      tokenFiles.push(normalized)
    }
    if (
      /\.(svelte|vue|tsx|jsx)$/.test(normalized) &&
      (normalized.includes('/components/') || normalized.includes('/ui/') || normalized.includes('/lib/'))
    ) {
      componentFiles.push(normalized)
    }
  })
  return {
    tokenFiles: tokenFiles.sort().slice(0, 40),
    componentFiles: componentFiles.sort().slice(0, 40),
  }
}

function summarizeGuildhallDesignSystem(ds: DesignSystem | undefined): GuildhallDesignSystemProfileSummary {
  if (!ds) {
    return {
      drafted: false,
      approved: false,
      tokenCounts: { color: 0, spacing: 0, typography: 0, radius: 0, shadow: 0 },
      primitives: [],
    }
  }
  return {
    drafted: true,
    approved: Boolean(ds.approvedAt),
    revision: ds.revision,
    tokenCounts: {
      color: ds.tokens.color.length,
      spacing: ds.tokens.spacing.length,
      typography: ds.tokens.typography.length,
      radius: ds.tokens.radius.length,
      shadow: ds.tokens.shadow.length,
    },
    primitives: ds.primitives.map(primitive => primitive.name),
  }
}

function recommendations(input: {
  primarySystem: string
  libraries: DesignSystemLibrary[]
  preview: DesignPreviewAdapter
  designSystem?: DesignSystem
  tokenFiles: string[]
}): string[] {
  const out: string[] = []
  if (input.primarySystem === 'looma') {
    out.push('Looma is available as the project design-system foundation; map reusable findings to portable candidates first, then Looma improvements when useful.')
  } else if (input.primarySystem === 'portable') {
    out.push('No known design-system foundation was detected; use the portable Guildhall proof contract until the project adopts one.')
  } else {
    out.push(`Detected ${input.primarySystem} as the likely design-system foundation; map it into the portable proof contract before review.`)
  }
  if (input.preview.adapter === 'none') {
    out.push('No component preview surface was found; create portable stories or integrate an existing catalog before broad UI work.')
  }
  if (!input.designSystem) {
    out.push('No Guildhall design-system draft exists yet; capture taste, token, primitive, and interaction defaults before implementation.')
  }
  if (input.tokenFiles.length === 0 && input.libraries.length === 0) {
    out.push('No token files were found; avoid one-off visual constants unless they are promoted into named design tokens.')
  }
  return out
}

async function walk(root: string, dir: string, visit: (relativePath: string) => void, depth = 0): Promise<void> {
  if (depth > 8) return
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
      await walk(root, full, visit, depth + 1)
    } else if (entry.isFile()) {
      visit(path.relative(root, full))
    }
  }
}

function addLibrary(
  libraries: DesignSystemLibrary[],
  packages: Set<string>,
  id: string,
  label: string,
  pattern: RegExp,
  role: DesignSystemLibrary['role'],
): void {
  const matched = [...packages].filter(name => pattern.test(name)).sort()
  if (matched.length === 0) return
  libraries.push({ id, label, packages: matched, role })
}

function stringRecord(input: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index
}
