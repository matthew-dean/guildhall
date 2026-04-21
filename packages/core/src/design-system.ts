import { z } from 'zod'

// ---------------------------------------------------------------------------
// Design system (project-scoped)
//
// The design-system is a living document that captures the product's visual
// and interaction baseline so every implementing agent produces work that
// belongs to the same product. Authoring is progressive — a fresh project
// starts with nothing, the Spec Agent (or a human) fills it in over time,
// and a human approves the version that new work is measured against.
//
// Storage: memory/design-system.yaml (YAML for human-editability).
// Loader + writer live in @guildhall/runtime (they're filesystem-bound).
// ---------------------------------------------------------------------------

export const DesignToken = z.object({
  name: z.string(),
  value: z.string(),
  description: z.string().optional(),
})
export type DesignToken = z.infer<typeof DesignToken>

export const DesignPrimitive = z.object({
  name: z.string(),
  usage: z.string().describe('One-line rule for when to use this primitive'),
})
export type DesignPrimitive = z.infer<typeof DesignPrimitive>

export const CopyVoice = z.object({
  tone: z
    .enum(['plain', 'warm', 'precise', 'playful', 'authoritative'])
    .default('plain'),
  bannedTerms: z.array(z.string()).default([]),
  preferredTerms: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
})
export type CopyVoice = z.infer<typeof CopyVoice>

export const AccessibilityBaseline = z.object({
  minContrastRatio: z.number().default(4.5),
  focusOutlineRequired: z.boolean().default(true),
  keyboardRules: z.array(z.string()).default([]),
  reducedMotionRespected: z.boolean().default(true),
})
export type AccessibilityBaseline = z.infer<typeof AccessibilityBaseline>

export const Interactions = z.object({
  motionDurationsMs: z.array(z.number()).default([]),
  focusStyle: z.string().optional(),
  hoverRules: z.array(z.string()).default([]),
})
export type Interactions = z.infer<typeof Interactions>

export const DesignSystem = z.object({
  version: z.number().default(1),
  revision: z.number().default(0),
  tokens: z
    .object({
      color: z.array(DesignToken).default([]),
      spacing: z.array(DesignToken).default([]),
      typography: z.array(DesignToken).default([]),
      radius: z.array(DesignToken).default([]),
      shadow: z.array(DesignToken).default([]),
    })
    .default({ color: [], spacing: [], typography: [], radius: [], shadow: [] }),
  primitives: z.array(DesignPrimitive).default([]),
  interactions: Interactions.default({ motionDurationsMs: [], hoverRules: [] }),
  a11y: AccessibilityBaseline.default({
    minContrastRatio: 4.5,
    focusOutlineRequired: true,
    keyboardRules: [],
    reducedMotionRespected: true,
  }),
  copyVoice: CopyVoice.default({
    tone: 'plain',
    bannedTerms: [],
    preferredTerms: [],
    examples: [],
  }),
  notes: z.string().optional(),
  authoredBy: z.string().optional(),
  authoredAt: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
})
export type DesignSystem = z.infer<typeof DesignSystem>

/**
 * Filename within the memory directory. Callers already have `memoryDir`
 * resolved, so this is a bare filename — not a project-relative path.
 */
export const DESIGN_SYSTEM_FILE = 'design-system.yaml'

/**
 * Short summary rendered into each agent's context so implementers stay
 * aligned with the approved system without reading the full file.
 */
export function summarizeDesignSystem(ds: DesignSystem): string {
  const lines: string[] = []
  lines.push(
    `**Design system:** revision ${ds.revision}${ds.approvedAt ? ' (human-approved)' : ' (DRAFT — not yet approved)'}`,
  )
  const allTokens = [
    ...ds.tokens.color.map((t) => `color.${t.name}`),
    ...ds.tokens.spacing.map((t) => `spacing.${t.name}`),
    ...ds.tokens.typography.map((t) => `type.${t.name}`),
    ...ds.tokens.radius.map((t) => `radius.${t.name}`),
    ...ds.tokens.shadow.map((t) => `shadow.${t.name}`),
  ]
  if (allTokens.length > 0) {
    lines.push(`**Tokens:** ${allTokens.slice(0, 24).join(', ')}${allTokens.length > 24 ? ` (+${allTokens.length - 24} more)` : ''}`)
  }
  if (ds.primitives.length > 0) {
    lines.push(
      `**Primitives:**\n${ds.primitives.map((p) => `- **${p.name}** — ${p.usage}`).join('\n')}`,
    )
  }
  const voiceBits: string[] = [`tone=${ds.copyVoice.tone}`]
  if (ds.copyVoice.bannedTerms.length > 0)
    voiceBits.push(`banned: ${ds.copyVoice.bannedTerms.join(', ')}`)
  if (ds.copyVoice.preferredTerms.length > 0)
    voiceBits.push(`preferred: ${ds.copyVoice.preferredTerms.join(', ')}`)
  lines.push(`**Copy voice:** ${voiceBits.join(' · ')}`)
  lines.push(
    `**A11y:** min contrast ${ds.a11y.minContrastRatio}, focus outline ${ds.a11y.focusOutlineRequired ? 'required' : 'optional'}, reduced-motion ${ds.a11y.reducedMotionRespected ? 'respected' : 'ignored'}`,
  )
  return lines.join('\n')
}
