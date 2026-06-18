import textRoleDefinitions from './text-role-definitions.js'

export type ComponentTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent'
export type ComponentDensity = 'dense' | 'compact' | 'comfortable'
export type ComponentPadding = 'compact' | 'default' | 'roomy'
export type ComponentMode = 'operator' | 'display'
export type ComponentEmphasis = 'quiet' | 'default' | 'strong'
export type ComponentSize = 'sm' | 'md' | 'icon'

export type TextRole =
  | 'display-title'
  | 'page-title'
  | 'section-title'
  | 'panel-title'
  | 'body'
  | 'body-strong'
  | 'row-title'
  | 'row-title-current'
  | 'meta'
  | 'caption'
  | 'eyebrow'
  | 'history'
  | 'action'
  | 'state'
  | 'code'

export type SpacingRole =
  | 'cluster-tight'
  | 'cluster-default'
  | 'cluster-comfortable'
  | 'panel-compact'
  | 'panel-default'
  | 'panel-roomy'
  | 'section'

export type RadiusRole = 'tight' | 'default' | 'large' | 'full'

export interface RoleTokenSet {
  readonly size?: string
  readonly weight?: string
  readonly lineHeight?: string
  readonly color?: string
  readonly letterSpacing?: string
  readonly textTransform?: string
  readonly space?: string
  readonly radius?: string
}

export interface ComponentContract {
  readonly name: string
  readonly owns: string
  readonly useFor: readonly string[]
  readonly doNotUseFor: readonly string[]
  readonly accessibility: string
  readonly protectedBy: readonly string[]
  readonly allowedTones?: readonly ComponentTone[]
  readonly allowedDensities?: readonly ComponentDensity[]
  readonly allowedPadding?: readonly ComponentPadding[]
  readonly allowedModes?: readonly ComponentMode[]
  readonly allowedEmphasis?: readonly ComponentEmphasis[]
  readonly allowedSizes?: readonly ComponentSize[]
  readonly replacementFor?: readonly string[]
  readonly maxVariantAxes: number
}

export const componentTones = ['neutral', 'info', 'ok', 'warn', 'danger', 'accent'] as const satisfies readonly ComponentTone[]
export const componentDensities = ['dense', 'compact', 'comfortable'] as const satisfies readonly ComponentDensity[]
export const componentPadding = ['compact', 'default', 'roomy'] as const satisfies readonly ComponentPadding[]
export const componentModes = ['operator', 'display'] as const satisfies readonly ComponentMode[]
export const componentEmphasis = ['quiet', 'default', 'strong'] as const satisfies readonly ComponentEmphasis[]
export const componentSizes = ['sm', 'md', 'icon'] as const satisfies readonly ComponentSize[]

export const deprecatedVariantAliases = {
  regular: 'comfortable',
  attention: 'warn',
  default: 'neutral',
} as const

export const textRoleTokens = textRoleDefinitions as Record<TextRole, RoleTokenSet>

export const spacingRoleTokens: Record<SpacingRole, RoleTokenSet> = {
  'cluster-tight': { space: '--gh-space-2' },
  'cluster-default': { space: '--gh-space-3' },
  'cluster-comfortable': { space: '--gh-space-4' },
  'panel-compact': { space: '--gh-layout-frame-padding-compact' },
  'panel-default': { space: '--gh-layout-frame-padding-default' },
  'panel-roomy': { space: '--gh-layout-frame-padding-roomy' },
  section: { space: '--gh-space-6' },
}

export const radiusRoleTokens: Record<RadiusRole, RoleTokenSet> = {
  tight: { radius: '--gh-radius-1' },
  default: { radius: '--gh-radius-2' },
  large: { radius: '--gh-radius-3' },
  full: { radius: '--gh-radius-full' },
}

export const allowedDesignSystemExceptions = [
  {
    owner: 'packages/ui/src/components/HeroBand.svelte',
    reason: 'Public/display composition may use display-title sizing and positive eyebrow tracking when contained in the package primitive.',
    removalCondition: 'Replace with dedicated display-title and eyebrow component roles if a second display primitive needs the same treatment.',
  },
  {
    owner: 'packages/ui/src/components/GuildDiagram.svelte',
    reason: 'Tiny diagram labels are bound to the generated SVG/canvas scale, not ordinary product-surface text.',
    removalCondition: 'Move diagram label rendering into a typed diagram primitive with its own token contract.',
  },
] as const

export const componentContracts: readonly ComponentContract[] = [
  {
    name: 'FrameCard',
    owns: 'framed panel geometry and section-level grouping',
    useFor: ['settings panels', 'release criteria', 'contained repeated panels'],
    doNotUseFor: ['page sections', 'nested card stacks', 'buttons disguised as cards'],
    accessibility: 'Keeps semantic heading and landmark choices with the caller; the frame itself does not imply an interactive role.',
    protectedBy: ['scripts/design-token-audit.mjs', 'packages/ui typecheck'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger'],
    allowedDensities: ['dense', 'compact', 'comfortable'],
    allowedPadding: ['compact', 'default', 'roomy'],
    allowedModes: ['operator', 'display'],
    replacementFor: ['src/web/lib/Card.svelte', 'local .card classes'],
    maxVariantAxes: 3,
  },
  {
    name: 'NoticeBand',
    owns: 'inline status, warning, recovery, and empty-state notices',
    useFor: ['blocking setup notices', 'migration warnings', 'empty/error/loading states that need action'],
    doNotUseFor: ['normal section intros', 'decorative callouts', 'success badges'],
    accessibility: 'Uses caller-provided text and actions; warning and danger tones must remain perceivable without relying on color alone.',
    protectedBy: ['scripts/design-token-audit.mjs', 'packages/ui typecheck'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger'],
    allowedDensities: ['compact', 'comfortable'],
    replacementFor: ['src/web/lib/NoticeBand.svelte', 'local alert panels'],
    maxVariantAxes: 3,
  },
  {
    name: 'StatusPill',
    owns: 'short status labels with semantic tone',
    useFor: ['state chips', 'count labels', 'readiness labels'],
    doNotUseFor: ['primary actions', 'long prose labels', 'metadata that is not state'],
    accessibility: 'Status meaning must be present in text, not color alone.',
    protectedBy: ['scripts/design-token-audit.mjs', 'packages/ui typecheck'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger', 'accent'],
    allowedDensities: ['dense', 'compact', 'comfortable'],
    allowedEmphasis: ['quiet', 'default', 'strong'],
    replacementFor: ['state-colored Chip usage', 'ad hoc pill spans'],
    maxVariantAxes: 3,
  },
  {
    name: 'Skeleton',
    owns: 'loading placeholder geometry for content that is still hydrating',
    useFor: ['rectangular loading rows', 'circular avatar placeholders', 'card-local layout skeletons'],
    doNotUseFor: ['empty states', 'real progress indicators', 'decorative gradients'],
    accessibility: 'Decorative by default; callers provide a label only when the skeleton itself is the loading status.',
    protectedBy: ['scripts/design-token-audit.mjs', 'packages/ui typecheck'],
    replacementFor: ['local shimmer bars', 'bespoke loading placeholder spans'],
    maxVariantAxes: 3,
  },
  {
    name: 'SectionHeader',
    owns: 'page-section and panel heading rhythm',
    useFor: ['surface section headers', 'panel headers', 'headers with compact actions'],
    doNotUseFor: ['tiny row labels', 'hero-only display copy', 'button rows without a heading'],
    accessibility: 'Heading level stays explicit through the component props and must match document structure.',
    protectedBy: ['scripts/design-token-audit.mjs', 'packages/ui typecheck'],
    allowedDensities: ['compact', 'comfortable'],
    allowedModes: ['operator', 'display'],
    allowedEmphasis: ['quiet', 'default', 'strong'],
    replacementFor: ['local .head h2 clusters', 'raw heading blocks'],
    maxVariantAxes: 3,
  },
] as const
