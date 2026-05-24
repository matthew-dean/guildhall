import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { DesignSystem } from '@guildhall/core'
import { getProjectStateDir } from '@guildhall/sessions'
import {
  discoverProjectFiles,
  indexFile,
  normalizeRelativePath,
  requiresFullRefresh,
} from './discovery.js'
import { enrichCodebaseMapSemantics } from './semantic.js'
import {
  appendCodebaseMapHistory,
  clearCodebaseMapStaleState,
  loadCodebaseMap,
  loadCorpusOverrides,
  saveCodebaseMap,
  saveCodebaseMapStaleState,
} from './storage.js'
import type {
  BuildCodebaseMapInput,
  CodebaseMap,
  CorpusAbstraction,
  CorpusArea,
  CorpusDesignSystemSummary,
  CorpusFileEntry,
  CorpusOverrides,
  RefreshCodebaseMapInput,
  RefreshCodebaseMapResult,
} from './types.js'

export async function buildCodebaseMap(input: BuildCodebaseMapInput): Promise<CodebaseMap> {
  const projectRoot = path.resolve(input.projectRoot)
  const files = await discoverProjectFiles(projectRoot)
  const entries: Record<string, CorpusFileEntry> = {}
  for (const file of files) {
    const entry = await indexFile(projectRoot, file)
    if (entry) entries[file] = entry
  }
  const overrides = input.memoryDir ? await loadCorpusOverrides(input.memoryDir) : undefined
  const designSystem = input.memoryDir ? await loadDesignSystemSummary(input.memoryDir, entries) : undefined
  const map = synthesizeMap({
    projectRoot,
    files: entries,
    overrides,
    designSystem,
    now: input.now ?? new Date(),
  })
  return input.semanticIndexer
    ? enrichCodebaseMapSemantics(map, input.semanticIndexer, input.now ?? new Date())
    : map
}

export async function refreshCodebaseMap(input: RefreshCodebaseMapInput): Promise<RefreshCodebaseMapResult> {
  const projectRoot = path.resolve(input.projectRoot)
  const memoryDir = input.memoryDir ?? getProjectStateDir(projectRoot)
  const now = input.now ?? new Date()
  try {
    const previous = await loadCodebaseMap(memoryDir)
    const touchedFiles = (input.touchedFiles ?? []).map((file) => normalizeRelativePath(projectRoot, file))
    const mode = previous === null || requiresFullRefresh(touchedFiles) ? 'full' : 'partial'
    const overrides = await loadCorpusOverrides(memoryDir)
    const removedFiles: string[] = []
    let changedFiles: string[]
    let map: CodebaseMap

    if (mode === 'full') {
      map = await buildCodebaseMap({ projectRoot, memoryDir, now, semanticIndexer: input.semanticIndexer })
      changedFiles = Object.keys(map.files)
    } else {
      const previousMap = previous
      if (!previousMap) {
        throw new Error('Partial codebase map refresh requires an existing map.')
      }
      const files = { ...previousMap.files }
      changedFiles = []
      for (const file of touchedFiles.filter(Boolean)) {
        const absolute = path.join(projectRoot, file)
        const exists = await fs.stat(absolute).then((stat) => stat.isFile()).catch(() => false)
        if (!exists) {
          if (files[file]) {
            delete files[file]
            removedFiles.push(file)
          }
          continue
        }
        const entry = await indexFile(projectRoot, file)
        if (entry) {
          files[file] = entry
          changedFiles.push(file)
        }
      }
      const refreshedDesignSystem = await loadDesignSystemSummary(memoryDir, files)
      map = synthesizeMap({ projectRoot, files, overrides, designSystem: refreshedDesignSystem, now })
      if (input.semanticIndexer) {
        map = await enrichCodebaseMapSemantics(map, input.semanticIndexer, now)
      }
    }

    await saveCodebaseMap(memoryDir, map)
    await clearCodebaseMapStaleState(memoryDir)
    const affectedAreas = affectedAreaIds(map, changedFiles, removedFiles)
    const affectedAbstractions = affectedAbstractionIds(map, changedFiles)
    await appendCodebaseMapHistory(memoryDir, {
      at: now.toISOString(),
      reason: input.reason,
      mode,
      changedFiles,
      removedFiles,
      affectedAreas,
      affectedAbstractions,
    })
    return { map, mode, changedFiles, removedFiles, affectedAreas, affectedAbstractions }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await saveCodebaseMapStaleState(memoryDir, {
      stale: true,
      at: now.toISOString(),
      reason: input.reason,
      error: message,
    })
    await appendCodebaseMapHistory(memoryDir, {
      at: now.toISOString(),
      reason: input.reason,
      mode: 'failed',
      changedFiles: input.touchedFiles ?? [],
      error: message,
    })
    throw err
  }
}

function synthesizeMap(input: {
  projectRoot: string
  files: Record<string, CorpusFileEntry>
  overrides?: CorpusOverrides
  designSystem?: CorpusDesignSystemSummary
  now: Date
}): CodebaseMap {
  const fileList = Object.values(input.files)
  const overrides = input.overrides
  const map: CodebaseMap = {
    version: 1,
    generatedAt: input.now.toISOString(),
    project: {
      root: input.projectRoot,
      summary: summarizeProject(fileList),
      languages: unique(fileList.map((file) => file.language)).sort(),
      packageManagers: detectPackageManagers(input.files),
      primaryFrameworks: detectFrameworks(input.files),
    },
    files: input.files,
    entrypoints: buildEntrypoints(input.files),
    areas: applyAreaOverrides(buildAreas(fileList), overrides),
    abstractions: applyAbstractionOverrides(buildAbstractions(fileList, input.designSystem), overrides),
    ...(input.designSystem ? { designSystem: input.designSystem } : {}),
    verification: { commands: detectVerificationCommands(input.files) },
    ...(overrides ? { overrides } : {}),
  }
  return map
}

function summarizeProject(files: CorpusFileEntry[]): string {
  const languages = unique(files.map((file) => file.language)).slice(0, 4).join(', ')
  const areas = unique(files.flatMap((file) => file.areaIds)).slice(0, 5).join(', ')
  return `Local project with ${files.length} indexed files${languages ? ` across ${languages}` : ''}${areas ? `; main areas: ${areas}` : ''}.`
}

function buildEntrypoints(files: Record<string, CorpusFileEntry>) {
  const candidates = [
    ['manifest', 'package.json', 'Package manifest and script entrypoint.'],
    ['workspace', 'pnpm-workspace.yaml', 'Workspace package definition.'],
    ['cli', 'src/runtime/cli.ts', 'Guildhall CLI entrypoint.'],
    ['server', 'src/runtime/serve.ts', 'Local dashboard/API server.'],
    ['web-app', 'src/web/main.ts', 'Browser UI bootstrap.'],
    ['readme', 'README.md', 'Repository overview.'],
  ] as const
  return candidates
    .filter(([, file]) => files[file])
    .map(([kind, file, summary]) => ({ kind, path: file, summary }))
}

function buildAreas(files: CorpusFileEntry[]): CorpusArea[] {
  const byArea = new Map<string, CorpusFileEntry[]>()
  for (const file of files) {
    for (const area of file.areaIds) {
      const bucket = byArea.get(area) ?? []
      bucket.push(file)
      byArea.set(area, bucket)
    }
  }
  return [...byArea.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entries]) => ({
      id,
      title: titleize(id),
      summary: `${titleize(id)} area with ${entries.length} indexed file${entries.length === 1 ? '' : 's'}.`,
      owns: areaOwns(id),
      canonicalFiles: entries
        .filter(isCanonicalFile)
        .slice(0, 8)
        .map((file) => ({ path: file.path, symbols: file.symbols, summary: file.summary })),
      conventions: defaultConventionsForArea(id),
      tests: entries.filter((file) => file.kind === 'test').map((file) => file.path).slice(0, 12),
    }))
}

function buildAbstractions(files: CorpusFileEntry[], designSystem?: CorpusDesignSystemSummary): CorpusAbstraction[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const abstractions: CorpusAbstraction[] = []
  const addIfPresent = (input: CorpusAbstraction) => {
    if (byPath.has(input.canonicalPath)) abstractions.push(input)
  }
  addIfPresent({
    id: 'button',
    title: 'Command buttons',
    kind: 'ui-component',
    canonicalPath: 'src/web/lib/Button.svelte',
    useWhen: ['A user triggers an action from a toolbar, form, panel, drawer, or wizard.'],
    avoid: ['Do not add local button padding, radius, neutral backgrounds, or one-off action styles.'],
    related: ['src/web/lib/StatusButton.svelte', 'packages/ui/src/styles.css'],
  })
  addIfPresent({
    id: 'status-button',
    title: 'Status and attention buttons',
    kind: 'ui-component',
    canonicalPath: 'src/web/lib/StatusButton.svelte',
    useWhen: ['A topbar or compact control needs an outlined status treatment with optional badge count.'],
    avoid: ['Do not build bespoke badge/button combinations in individual surfaces.'],
    related: ['src/web/lib/Button.svelte'],
  })
  addIfPresent({
    id: 'frame-card',
    title: 'Framed content cards',
    kind: 'ui-component',
    canonicalPath: 'packages/ui/src/components/FrameCard.svelte',
    useWhen: ['A settings or dashboard section needs a framed group with a shared header pattern.'],
    avoid: ['Do not nest decorative cards inside cards or invent local panel chrome.'],
    related: ['packages/ui/src/components/SectionHeader.svelte'],
  })
  addIfPresent({
    id: 'settings-select',
    title: 'Settings select controls',
    kind: 'ui-component',
    canonicalPath: 'src/web/lib/Select.svelte',
    useWhen: ['A settings row chooses one value from an enum or inherited default.'],
    avoid: ['Do not render enum choices as inert individual buttons.'],
    related: ['src/web/surfaces/project/SettingsTab.svelte'],
  })
  if (designSystem) {
    abstractions.push({
      id: 'design-system',
      title: 'Design system tokens and primitives',
      kind: 'design-system',
      canonicalPath: designSystem.sourcePath ?? '.guildhall/design-system.yaml',
      useWhen: [
        'A UI change introduces color, spacing, typography, radius, shadow, copy voice, accessibility, or reusable component behavior.',
        'Use just-in-time systemization: extend shared tokens or primitives when repetition is stable or the same UI idea appears in multiple places.',
      ],
      avoid: [
        'Do not invent local colors, radii, spacing, or button/card/select treatments when an approved token or primitive exists.',
        'Do not expand the design system for one-off details that are unlikely to repeat.',
      ],
      related: [
        ...designSystem.componentFiles.slice(0, 8),
        ...designSystem.primitives.map((primitive) => primitive.name),
      ],
    })
  }
  return abstractions
}

async function loadDesignSystemSummary(
  memoryDir: string,
  files: Record<string, CorpusFileEntry>,
): Promise<CorpusDesignSystemSummary | undefined> {
  const sourcePath = path.join(memoryDir, 'design-system.yaml')
  const sourceLabel = `${path.basename(memoryDir)}/design-system.yaml`
  const componentFiles = Object.keys(files)
    .filter((file) =>
      (file.endsWith('.svelte') || file.endsWith('.vue') || file.endsWith('.tsx')) &&
      (file.includes('/lib/') || file.includes('/components/') || file.includes('/ui/')),
    )
    .sort()
    .slice(0, 30)
  try {
    const raw = await fs.readFile(sourcePath, 'utf-8')
    const ds = DesignSystem.parse(parseYaml(raw) ?? {})
    const tokenCounts = {
      color: ds.tokens.color.length,
      spacing: ds.tokens.spacing.length,
      typography: ds.tokens.typography.length,
      radius: ds.tokens.radius.length,
      shadow: ds.tokens.shadow.length,
    }
    const tokenSamples = [
      ...ds.tokens.color.map((token) => `color.${token.name}=${token.value}`),
      ...ds.tokens.spacing.map((token) => `spacing.${token.name}=${token.value}`),
      ...ds.tokens.typography.map((token) => `type.${token.name}=${token.value}`),
      ...ds.tokens.radius.map((token) => `radius.${token.name}=${token.value}`),
      ...ds.tokens.shadow.map((token) => `shadow.${token.name}=${token.value}`),
    ].slice(0, 16)
    const summary: CorpusDesignSystemSummary = {
      sourcePath: sourceLabel,
      revision: ds.revision,
      approved: Boolean(ds.approvedAt),
      tokenCounts,
      tokenSamples,
      primitives: ds.primitives.slice(0, 20).map((primitive) => ({
        name: primitive.name,
        usage: primitive.usage,
      })),
      componentFiles,
      maturity: assessDesignSystemMaturity({
        tokenTotal: Object.values(tokenCounts).reduce((sum, value) => sum + value, 0),
        primitiveCount: ds.primitives.length,
        componentCount: componentFiles.length,
      }),
      recommendations: [],
    }
    summary.recommendations = designSystemRecommendations(summary)
    return summary
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    if (componentFiles.length < 4) return undefined
    const summary: CorpusDesignSystemSummary = {
      sourcePath: undefined,
      approved: false,
      tokenCounts: { color: 0, spacing: 0, typography: 0, radius: 0, shadow: 0 },
      tokenSamples: [],
      primitives: [],
      componentFiles,
      maturity: 'absent',
      recommendations: [],
    }
    summary.recommendations = designSystemRecommendations(summary)
    return summary
  }
}

function assessDesignSystemMaturity(input: {
  tokenTotal: number
  primitiveCount: number
  componentCount: number
}): CorpusDesignSystemSummary['maturity'] {
  if (input.tokenTotal === 0 && input.primitiveCount === 0) return 'absent'
  if (input.componentCount >= 8 && (input.tokenTotal < 8 || input.primitiveCount < 3)) return 'thin'
  if (input.tokenTotal >= 8 && input.primitiveCount >= 3) return 'established'
  return 'emerging'
}

function designSystemRecommendations(summary: CorpusDesignSystemSummary): string[] {
  const tokenTotal = Object.values(summary.tokenCounts).reduce((sum, value) => sum + value, 0)
  const recommendations: string[] = []
  if (summary.maturity === 'absent') {
    recommendations.push('No design-system document found; if UI work repeats colors, spacing, controls, or interaction rules, propose a small starter design system before adding more local styles.')
  }
  if (summary.maturity === 'thin') {
    recommendations.push('UI surface area is larger than the captured token/primitive set; prefer extending the design system when a second repeated treatment appears.')
  }
  if (summary.componentFiles.length >= 6 && summary.primitives.length < 3) {
    recommendations.push('Several component files exist but few primitives are documented; check whether common controls should be named as shared primitives.')
  }
  if (summary.componentFiles.length >= 4 && tokenTotal < 6) {
    recommendations.push('Component count suggests tokens may be under-specified; avoid adding raw color, spacing, radius, or shadow values unless they become named tokens.')
  }
  if (summary.approved) {
    recommendations.push('Approved design-system values are binding for UI work; extend them deliberately instead of bypassing them locally.')
  }
  return recommendations.slice(0, 5)
}

function applyAreaOverrides(areas: CorpusArea[], overrides?: CorpusOverrides): CorpusArea[] {
  if (!overrides?.conventions?.length) return areas
  return areas.map((area) => ({
    ...area,
    conventions: [
      ...area.conventions,
      ...overrides.conventions!
        .filter((item) => item.areaId === area.id && item.text.trim().length > 0)
        .map((item) => item.text.trim()),
    ],
  }))
}

function applyAbstractionOverrides(abstractions: CorpusAbstraction[], overrides?: CorpusOverrides): CorpusAbstraction[] {
  const merged = [...abstractions]
  for (const abstraction of overrides?.abstractions ?? []) {
    const index = merged.findIndex((item) => item.id === abstraction.id)
    if (index >= 0) merged[index] = abstraction
    else merged.push(abstraction)
  }
  return merged.map((abstraction) => ({
    ...abstraction,
    useWhen: [
      ...abstraction.useWhen,
      ...(overrides?.conventions ?? [])
        .filter((item) => item.abstractionId === abstraction.id && item.text.trim().length > 0)
        .map((item) => item.text.trim()),
    ],
  }))
}

function detectPackageManagers(files: Record<string, CorpusFileEntry>): string[] {
  const managers: string[] = []
  if (files['pnpm-lock.yaml'] || files['pnpm-workspace.yaml']) managers.push('pnpm')
  if (files['package-lock.json']) managers.push('npm')
  if (files['yarn.lock']) managers.push('yarn')
  if (files['bun.lockb']) managers.push('bun')
  if (files['package.json'] && managers.length === 0) managers.push('npm')
  return managers
}

function detectFrameworks(files: Record<string, CorpusFileEntry>): string[] {
  const paths = Object.keys(files)
  const frameworks = new Set<string>()
  if (paths.some((file) => file.endsWith('.svelte') || file.includes('svelte.config'))) frameworks.add('svelte')
  if (paths.some((file) => file.endsWith('.vue') || file.includes('vue.config'))) frameworks.add('vue')
  if (paths.some((file) => file.endsWith('.tsx') || file.endsWith('.jsx'))) frameworks.add('react')
  if (paths.some((file) => file.includes('vite.config'))) frameworks.add('vite')
  return [...frameworks].sort()
}

function detectVerificationCommands(files: Record<string, CorpusFileEntry>): string[] {
  const packageFile = files['package.json']
  if (!packageFile) return []
  // Re-read is avoided here; the MVP infers conventional package scripts by
  // project shape so context stays deterministic even when package contents are
  // absent from the map.
  const commands = ['pnpm test <focused test file>', 'pnpm typecheck', 'pnpm build']
  if (!detectPackageManagers(files).includes('pnpm')) return commands.map((cmd) => cmd.replace(/^pnpm/, 'npm run'))
  return commands
}

function isCanonicalFile(file: CorpusFileEntry): boolean {
  return (
    file.path.includes('/lib/') ||
    file.path.includes('/components/') ||
    file.path.endsWith('/index.ts') ||
    ['manifest', 'doc'].includes(file.kind)
  )
}

function defaultConventionsForArea(id: string): string[] {
  if (id === 'web-ui') {
    return [
      'Use shared Button, StatusButton, Select, FrameCard, and token variables before adding surface-local controls.',
      'Question and selection components must align behavior with hover/click affordances.',
    ]
  }
  if (id === 'runtime') return ['Keep runtime behavior behind typed helpers and focused tests.']
  if (id === 'corpus-map') return ['Corpus map entries store references and summaries, not full source content.']
  return []
}

function areaOwns(id: string): string[] {
  switch (id) {
    case 'web-ui': return ['src/web/**', 'packages/ui/**']
    case 'runtime': return ['src/runtime/**']
    case 'agents': return ['src/agents/**']
    case 'core': return ['src/core/**']
    case 'config': return ['src/config/**']
    case 'tools': return ['src/tools/**']
    case 'corpus-map': return ['src/corpus-map/**']
    case 'docs': return ['docs/**']
    default: return ['**/*']
  }
}

function affectedAreaIds(map: CodebaseMap, changedFiles: string[], removedFiles: string[]): string[] {
  const ids = new Set<string>()
  for (const file of changedFiles) for (const id of map.files[file]?.areaIds ?? []) ids.add(id)
  for (const file of removedFiles) {
    const fallbackArea = file.split('/')[0] ?? 'project'
    ids.add(fallbackArea)
  }
  return [...ids].sort()
}

function affectedAbstractionIds(map: CodebaseMap, changedFiles: string[]): string[] {
  return map.abstractions
    .filter((abstraction) =>
      changedFiles.includes(abstraction.canonicalPath) ||
      abstraction.related.some((file) => changedFiles.includes(file)),
    )
    .map((abstraction) => abstraction.id)
    .sort()
}

function titleize(value: string): string {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
