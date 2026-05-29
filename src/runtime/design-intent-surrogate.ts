import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { buildDesignSystemCatalog } from './design-system-catalog.js'

export const DesignIntentPlatform = z.enum(['web', 'ios', 'macos', 'android', 'unknown-native', 'unknown'])
export type DesignIntentPlatform = z.infer<typeof DesignIntentPlatform>

export const DesignIntentPreviewMode = z.enum([
  'real-web-preview',
  'native-snapshot',
  'browser-surrogate',
  'none',
])
export type DesignIntentPreviewMode = z.infer<typeof DesignIntentPreviewMode>

export const DesignIntentSurrogate = z.object({
  version: z.literal(1).default(1),
  platform: DesignIntentPlatform,
  previewMode: DesignIntentPreviewMode,
  approximate: z.boolean(),
  label: z.string(),
  warning: z.string().optional(),
  nativeProofRequired: z.boolean(),
  detectedNativeTooling: z.array(z.string()).default([]),
  surrogateUrl: z.string().optional(),
  componentIntents: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
})
export type DesignIntentSurrogate = z.infer<typeof DesignIntentSurrogate>

export async function buildDesignIntentSurrogate(input: {
  projectPath: string
  memoryDir?: string
}): Promise<DesignIntentSurrogate> {
  const [catalog, native] = await Promise.all([
    buildDesignSystemCatalog(input),
    detectNativePlatform(input.projectPath),
  ])
  const componentIntents = catalog.entries
    .map(entry => entry.componentIntent)
    .filter((value): value is string => Boolean(value))

  if (native.platform === 'unknown' || native.platform === 'web') {
    return DesignIntentSurrogate.parse({
      version: 1,
      platform: catalog.interactable ? 'web' : native.platform,
      previewMode: catalog.interactable ? 'real-web-preview' : 'none',
      approximate: false,
      label: catalog.interactable
        ? 'Real web preview: Guildhall can inspect the project catalog directly.'
        : 'No design preview surface is configured yet.',
      nativeProofRequired: false,
      detectedNativeTooling: native.tooling,
      componentIntents,
      recommendations: catalog.interactable
        ? ['Use the real web catalog for design review and browser proof.']
        : ['Add a Storybook/Ladle/docs catalog or Guildhall portable stories before broad UI work.'],
    })
  }

  const hasNativeSnapshot = native.tooling.includes('swiftui-preview') || native.tooling.includes('compose-preview')
  return DesignIntentSurrogate.parse({
    version: 1,
    platform: native.platform,
    previewMode: hasNativeSnapshot ? 'browser-surrogate' : 'browser-surrogate',
    approximate: true,
    label: 'Preview approximation: this rendering proves design intent and state coverage.',
    warning: 'Native platform proof still needs simulator/device screenshots before release.',
    nativeProofRequired: true,
    detectedNativeTooling: native.tooling,
    surrogateUrl: '/__guildhall/design-intent-surrogate',
    componentIntents,
    recommendations: [
      'Use the browser surrogate for fast owner feedback on hierarchy, palette, spacing, states, and interaction semantics.',
      native.platform === 'android'
        ? 'Before release, capture Compose preview, emulator, or device screenshots for native proof.'
        : 'Before release, capture SwiftUI preview, simulator, or device screenshots for native proof.',
    ],
  })
}

async function detectNativePlatform(projectPath: string): Promise<{
  platform: DesignIntentPlatform
  tooling: string[]
}> {
  const files = await scanFiles(projectPath)
  const tooling = new Set<string>()
  const hasPackageJson = files.has('package.json')
  const hasXcodeProject = [...files].some(file => file.endsWith('.xcodeproj/project.pbxproj') || file.endsWith('.xcodeproj'))
  const swiftFiles = [...files].filter(file => file.endsWith('.swift'))
  const hasGradle = files.has('build.gradle') || files.has('build.gradle.kts') || [...files].some(file => file.endsWith('/build.gradle') || file.endsWith('/build.gradle.kts'))
  const hasKotlin = [...files].some(file => file.endsWith('.kt') || file.endsWith('.kts'))

  if (hasXcodeProject) tooling.add('xcodeproj')
  if (swiftFiles.some(asyncFileNameHintForSwiftUi)) tooling.add('swiftui-preview')
  if (hasGradle) tooling.add('gradle')
  if (hasKotlin) tooling.add('kotlin')
  if ([...files].some(file => file.endsWith('Preview.kt') || file.includes('/preview/'))) tooling.add('compose-preview')

  if (hasXcodeProject || swiftFiles.length > 0) {
    const hasIosHint = [...files].some(file => /ios|iphone|ipad|uikit/i.test(file)) || swiftFiles.some(file => /ContentView|App\.swift/i.test(file))
    return { platform: hasIosHint ? 'ios' : 'macos', tooling: [...tooling].sort() }
  }
  if (hasGradle || hasKotlin) return { platform: 'android', tooling: [...tooling].sort() }
  if (hasPackageJson) return { platform: 'web', tooling: [...tooling].sort() }
  if (files.size > 0) return { platform: 'unknown-native', tooling: [...tooling].sort() }
  return { platform: 'unknown', tooling: [] }
}

function asyncFileNameHintForSwiftUi(file: string): boolean {
  return /contentview|swiftui|preview/i.test(file)
}

async function scanFiles(root: string): Promise<Set<string>> {
  const files = new Set<string>()
  await walk(root, root, files)
  return files
}

async function walk(root: string, dir: string, out: Set<string>, depth = 0): Promise<void> {
  if (depth > 6 || out.size >= 300) return
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue
    const full = path.join(dir, entry.name)
    const relative = path.relative(root, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.xcodeproj')) out.add(relative)
      await walk(root, full, out, depth + 1)
    } else if (entry.isFile()) {
      out.add(relative)
    }
  }
}
