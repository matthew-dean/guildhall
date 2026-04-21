import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { DesignSystem, DESIGN_SYSTEM_FILE } from '@guildhall/core'

// ---------------------------------------------------------------------------
// update-design-system: project-wide design-system authoring surface.
//
// The DS lives at `memory/design-system.yaml`. Re-authoring an approved
// revision drops the approval unless the material surface (tokens +
// primitives + a11y + copyVoice) is unchanged — notes alone don't void it.
// ---------------------------------------------------------------------------

function designSystemPath(memoryDir: string): string {
  return path.join(memoryDir, DESIGN_SYSTEM_FILE)
}

const TokenInput = z.object({
  name: z.string(),
  value: z.string(),
  description: z.string().optional(),
})

const PrimitiveInput = z.object({
  name: z.string(),
  usage: z.string(),
})

const updateDesignSystemInputSchema = z.object({
  memoryDir: z.string().describe('Absolute path to the memory directory'),
  tokens: z
    .object({
      color: z.array(TokenInput).default([]),
      spacing: z.array(TokenInput).default([]),
      typography: z.array(TokenInput).default([]),
      radius: z.array(TokenInput).default([]),
      shadow: z.array(TokenInput).default([]),
    })
    .default({ color: [], spacing: [], typography: [], radius: [], shadow: [] }),
  primitives: z.array(PrimitiveInput).default([]),
  interactions: z
    .object({
      motionDurationsMs: z.array(z.number()).default([]),
      focusStyle: z.string().optional(),
      hoverRules: z.array(z.string()).default([]),
    })
    .default({ motionDurationsMs: [], hoverRules: [] }),
  a11y: z
    .object({
      minContrastRatio: z.number().default(4.5),
      focusOutlineRequired: z.boolean().default(true),
      keyboardRules: z.array(z.string()).default([]),
      reducedMotionRespected: z.boolean().default(true),
    })
    .default({
      minContrastRatio: 4.5,
      focusOutlineRequired: true,
      keyboardRules: [],
      reducedMotionRespected: true,
    }),
  copyVoice: z
    .object({
      tone: z
        .enum(['plain', 'warm', 'precise', 'playful', 'authoritative'])
        .default('plain'),
      bannedTerms: z.array(z.string()).default([]),
      preferredTerms: z.array(z.string()).default([]),
      examples: z.array(z.string()).default([]),
    })
    .default({ tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] }),
  notes: z.string().optional(),
  authoredBy: z.string(),
})

export type UpdateDesignSystemInput = z.input<typeof updateDesignSystemInputSchema>

export interface UpdateDesignSystemResult {
  success: boolean
  error?: string
  revision?: number
}

function materialFingerprint(
  ds: Pick<DesignSystem, 'tokens' | 'primitives' | 'a11y' | 'copyVoice' | 'interactions'>,
): string {
  return JSON.stringify({
    tokens: ds.tokens,
    primitives: ds.primitives,
    a11y: ds.a11y,
    copyVoice: ds.copyVoice,
    interactions: ds.interactions,
  })
}

export async function updateDesignSystem(
  input: UpdateDesignSystemInput,
): Promise<UpdateDesignSystemResult> {
  try {
    const parsed = updateDesignSystemInputSchema.parse(input)
    const p = designSystemPath(parsed.memoryDir)

    let existing: DesignSystem | undefined
    try {
      const raw = await fs.readFile(p, 'utf-8')
      existing = DesignSystem.parse(yaml.load(raw) ?? {})
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    const now = new Date().toISOString()
    const nextBody = {
      tokens: parsed.tokens,
      primitives: parsed.primitives,
      interactions: parsed.interactions,
      a11y: parsed.a11y,
      copyVoice: parsed.copyVoice,
    }

    const materialUnchanged =
      existing && materialFingerprint(existing) === materialFingerprint(nextBody)

    const next: DesignSystem = DesignSystem.parse({
      version: 1,
      revision: (existing?.revision ?? 0) + (materialUnchanged ? 0 : 1),
      ...nextBody,
      notes: parsed.notes,
      authoredBy: parsed.authoredBy,
      authoredAt: now,
      ...(existing?.approvedAt && materialUnchanged
        ? { approvedBy: existing.approvedBy, approvedAt: existing.approvedAt }
        : {}),
    })

    const tmp = `${p}.tmp`
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(tmp, yaml.dump(next, { noRefs: true, lineWidth: 100 }), 'utf-8')
    await fs.rename(tmp, p)

    return { success: true, revision: next.revision }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const updateDesignSystemTool = defineTool({
  name: 'update-design-system',
  description:
    "Author or revise the project's design system — tokens, primitives, interactions, a11y baseline, and copy voice. Call this once you and the human have aligned on what the product's visual + interaction surface should feel like. Re-authoring an approved design system drops the approval unless the material surface is unchanged (notes can change without voiding approval).",
  inputSchema: updateDesignSystemInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await updateDesignSystem(input)
    return {
      output: result.success
        ? `Updated design system (revision ${result.revision})`
        : `Error updating design system: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
