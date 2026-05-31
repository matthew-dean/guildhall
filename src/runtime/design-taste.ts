import fsp from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'
import { guildhallHomeDir } from '@guildhall/config'

export const DESIGN_TASTE_FILE = 'design-taste.yaml'

const SourceKind = z.enum(['platform-guideline', 'design-system-guideline', 'trend-research', 'owner-preference', 'project-memory'])
const Confidence = z.enum(['low', 'medium', 'high'])

export const DesignTasteSource = z.object({
  id: z.string().min(1),
  url: z.string().optional(),
  kind: SourceKind,
  confidence: Confidence.default('medium'),
})
export type DesignTasteSource = z.infer<typeof DesignTasteSource>

export const InteractionSemanticsTaste = z.object({
  mutuallyExclusiveModes: z.string().default('segmented-control-or-tabs'),
  oneShotCommand: z.string().default('button'),
  independentBoolean: z.string().default('checkbox'),
  persistentBinaryState: z.string().default('switch'),
  navigation: z.string().default('link-or-tab'),
})
export type InteractionSemanticsTaste = z.infer<typeof InteractionSemanticsTaste>

export const PaletteStrategyTaste = z.object({
  defaultMode: z.string().default('semantic-oklch-roles'),
  saturationBudget: z.string().default('controlled'),
  avoid: z.array(z.string()).default([]),
})
export type PaletteStrategyTaste = z.infer<typeof PaletteStrategyTaste>

export const VisualDirectionTaste = z.object({
  default: z.string().default('warm-functional-polish'),
  avoid: z.array(z.string()).default([]),
})
export type VisualDirectionTaste = z.infer<typeof VisualDirectionTaste>

export const PatternRecipeTaste = z.object({
  preferred: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
})
export type PatternRecipeTaste = z.infer<typeof PatternRecipeTaste>

export const DesignTasteOpinions = z.object({
  interactionSemantics: InteractionSemanticsTaste.default({}),
  paletteStrategy: PaletteStrategyTaste.default({}),
  visualDirection: VisualDirectionTaste.default({}),
})
export type DesignTasteOpinions = z.infer<typeof DesignTasteOpinions>

export const DesignTaste = z.object({
  version: z.literal(1).default(1),
  updatedAt: z.string().optional(),
  sourceSet: z.array(DesignTasteSource).default([]),
  opinions: DesignTasteOpinions.default({}),
  patternRecipes: z.record(z.string(), PatternRecipeTaste).default({}),
})
export type DesignTaste = z.infer<typeof DesignTaste>
export type DesignTasteInput = z.input<typeof DesignTaste>

const DesignTasteOverride = z.object({
  version: z.literal(1).optional(),
  updatedAt: z.string().optional(),
  sourceSet: z.array(DesignTasteSource).optional(),
  opinions: z.object({
    interactionSemantics: InteractionSemanticsTaste.partial().optional(),
    paletteStrategy: PaletteStrategyTaste.partial().optional(),
    visualDirection: VisualDirectionTaste.partial().optional(),
  }).optional(),
  patternRecipes: z.record(z.string(), PatternRecipeTaste.partial().extend({
    preferred: z.string().min(1).optional(),
  })).optional(),
})
type DesignTastePartial = {
  version?: 1
  updatedAt?: string
  sourceSet?: DesignTasteSource[]
  opinions?: {
    interactionSemantics?: Partial<InteractionSemanticsTaste>
    paletteStrategy?: Partial<PaletteStrategyTaste>
    visualDirection?: Partial<VisualDirectionTaste>
  }
  patternRecipes?: Record<string, Partial<PatternRecipeTaste>>
}

export const DesignTasteLayer = z.object({
  id: z.enum(['builtin', 'user', 'project']),
  label: z.string(),
  path: z.string().optional(),
  applied: z.boolean(),
})
export type DesignTasteLayer = z.infer<typeof DesignTasteLayer>

export const EffectiveDesignTastePacket = z.object({
  taste: DesignTaste,
  summary: z.string(),
  layers: z.array(DesignTasteLayer),
})
export type EffectiveDesignTastePacket = z.infer<typeof EffectiveDesignTastePacket>

export function designTastePath(memoryDir: string): string {
  return path.join(memoryDir, DESIGN_TASTE_FILE)
}

export function userDesignTastePath(): string {
  return path.join(guildhallHomeDir(), DESIGN_TASTE_FILE)
}

export async function loadEffectiveDesignTaste(input: {
  memoryDir: string
  userTastePath?: string
}): Promise<EffectiveDesignTastePacket> {
  const userPath = input.userTastePath ?? userDesignTastePath()
  const projectPath = designTastePath(input.memoryDir)
  const user = await readOptionalTaste(userPath)
  const project = await readOptionalTaste(projectPath)
  const taste = DesignTaste.parse(mergeDesignTaste(BUILTIN_DESIGN_TASTE, user.taste, project.taste))
  return {
    taste,
    summary: summarizeDesignTaste(taste),
    layers: [
      { id: 'builtin', label: 'Guildhall defaults', applied: true },
      { id: 'user', label: 'User overrides', path: userPath, applied: user.applied },
      { id: 'project', label: 'Project overrides', path: projectPath, applied: project.applied },
    ],
  }
}

export function summarizeDesignTaste(taste: DesignTaste): string {
  const interaction = taste.opinions.interactionSemantics
  const palette = taste.opinions.paletteStrategy
  const visual = taste.opinions.visualDirection
  const recipes = Object.entries(taste.patternRecipes)
    .slice(0, 3)
    .map(([id, recipe]) => `${id}: ${recipe.preferred}`)
  return [
    `Interaction: mutually exclusive modes use ${interaction.mutuallyExclusiveModes}; commands use ${interaction.oneShotCommand}; persistent binary state uses ${interaction.persistentBinaryState}.`,
    `palette ${palette.defaultMode} with ${palette.saturationBudget} saturation; avoid ${palette.avoid.slice(0, 4).join(', ') || 'unreviewed one-note palettes'}.`,
    `Visual direction: ${visual.default}; avoid ${visual.avoid.slice(0, 4).join(', ') || 'generic visual filler'}.`,
    recipes.length ? `Recipes: ${recipes.join('; ')}.` : 'Recipes: use the project design system or portable Guildhall defaults.',
  ].join(' ')
}

async function readOptionalTaste(file: string): Promise<{ applied: boolean; taste: DesignTastePartial }> {
  try {
    const parsed = yaml.load(await fsp.readFile(file, 'utf-8')) ?? {}
    return { applied: true, taste: DesignTasteOverride.parse(parsed) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { applied: false, taste: {} }
    throw err
  }
}

function mergeDesignTaste(...layers: Array<DesignTastePartial | undefined>): DesignTastePartial {
  return layers.reduce<DesignTastePartial>((merged, layer) => {
    if (!layer) return merged
    return {
      ...merged,
      ...withoutUndefined({
        version: layer.version,
        updatedAt: layer.updatedAt ?? merged.updatedAt,
        sourceSet: mergeById(merged.sourceSet ?? [], layer.sourceSet ?? []),
        opinions: mergeOpinions(merged.opinions, layer.opinions),
        patternRecipes: mergePatternRecipes(merged.patternRecipes, layer.patternRecipes),
      }),
    }
  }, {})
}

function mergeOpinions(
  base: DesignTastePartial['opinions'] | undefined,
  override: DesignTastePartial['opinions'] | undefined,
): DesignTasteInput['opinions'] {
  if (!override) return base
  return {
    ...base,
    interactionSemantics: { ...base?.interactionSemantics, ...override.interactionSemantics },
    paletteStrategy: {
      ...base?.paletteStrategy,
      ...override.paletteStrategy,
      avoid: mergeStrings(base?.paletteStrategy?.avoid, override.paletteStrategy?.avoid),
    },
    visualDirection: {
      ...base?.visualDirection,
      ...override.visualDirection,
      avoid: mergeStrings(base?.visualDirection?.avoid, override.visualDirection?.avoid),
    },
  }
}

function mergePatternRecipes(
  base: DesignTastePartial['patternRecipes'] | undefined,
  override: DesignTastePartial['patternRecipes'] | undefined,
): DesignTastePartial['patternRecipes'] {
  if (!override) return base
  const merged = { ...(base ?? {}) }
  for (const [key, recipe] of Object.entries(override)) {
    const previous = merged[key]
    merged[key] = {
      ...previous,
      ...recipe,
      alternatives: mergeStrings(previous?.alternatives, recipe.alternatives),
      avoid: mergeStrings(previous?.avoid, recipe.avoid),
    }
  }
  return merged
}

function mergeStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): string[] {
  return Array.from(new Set([...(left ?? []), ...(right ?? [])]))
}

function mergeById<T extends { id: string }>(left: readonly T[], right: readonly T[]): T[] {
  return [...left, ...right].reduce<T[]>((items, item) => {
    return [...items.filter(existing => existing.id !== item.id), item]
  }, [])
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

const BUILTIN_DESIGN_TASTE = DesignTaste.parse({
  sourceSet: [
    {
      id: 'guildhall-design-quality-0-9',
      kind: 'project-memory',
      confidence: 'high',
    },
  ],
  opinions: {
    interactionSemantics: {
      mutuallyExclusiveModes: 'segmented-control-or-tabs',
      oneShotCommand: 'button',
      independentBoolean: 'checkbox',
      persistentBinaryState: 'switch',
      navigation: 'link-or-tab',
    },
    paletteStrategy: {
      defaultMode: 'semantic-oklch-roles',
      saturationBudget: 'controlled',
      avoid: [
        'all-purple-gradient-app',
        'beige-only-product',
        'generic-cool-blue-utility-app',
        'medical-blue-for-domestic-products',
        'generic-dark-saas-slate',
        'undifferentiated-neon',
      ],
    },
    visualDirection: {
      default: 'warm-functional-polish',
      avoid: [
        'over-carded-layout',
        'hero-marketing-shell-for-tool',
        'stock-gradient-background',
        'tiny-unexplained-controls',
      ],
    },
  },
  patternRecipes: {
    filterModes: {
      preferred: 'segmented-control',
      alternatives: ['tabs'],
    },
    binarySettings: {
      preferred: 'switch-or-checkbox-by-persistence',
      alternatives: ['checkbox', 'switch'],
    },
    pantryPulsePalette: {
      preferred: 'warm-off-white-plus-sage-primary',
      alternatives: ['warm-off-white-plus-leaf-green-primary', 'warm-off-white-plus-amber-primary'],
      avoid: ['generic-cool-blue-utility-app', 'medical-blue-for-domestic-products', 'beige-only-product'],
    },
  },
})
