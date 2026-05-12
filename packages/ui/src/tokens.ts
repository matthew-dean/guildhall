import tokenDefinitions from './token-definitions.js'

export type GuildhallTokenCategory = 'color' | 'spacing' | 'typography' | 'radius' | 'control' | 'layout'

export const guildhallSurfaceRoles = [
  'canvas',
  'sunken',
  'raised',
  'elevated',
  'accent',
  'info',
  'ok',
  'warn',
  'danger',
] as const

export type GuildhallSurfaceRole = (typeof guildhallSurfaceRoles)[number]

export const guildhallTypeRoles = ['eyebrow', 'label', 'title', 'meta', 'body'] as const

export type GuildhallTypeRole = (typeof guildhallTypeRoles)[number]

export const guildhallShellModes = ['display', 'operator'] as const

export type GuildhallShellMode = (typeof guildhallShellModes)[number]

export const guildhallDensityModes = ['comfortable', 'compact', 'dense'] as const

export type GuildhallDensityMode = (typeof guildhallDensityModes)[number]

export const guildhallEmphasisModes = ['quiet', 'default', 'strong'] as const

export type GuildhallEmphasisMode = (typeof guildhallEmphasisModes)[number]

export interface GuildhallToken {
  category: GuildhallTokenCategory
  name: string
  cssVariable: `--${string}`
  value: string
  description: string
}

export const guildhallTokens = tokenDefinitions as readonly GuildhallToken[]

export type GuildhallTokenName = (typeof guildhallTokens)[number]['name']

export const guildhallTokenMap = Object.freeze(
  Object.fromEntries(guildhallTokens.map((token) => [token.name, token])) as Record<
    GuildhallTokenName,
    (typeof guildhallTokens)[number]
  >,
)
