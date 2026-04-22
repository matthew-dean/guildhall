import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { updateAgentSettings } from '@guildhall/config'
import type { AgentSettings } from '@guildhall/config'
import fs from 'node:fs/promises'

// ---------------------------------------------------------------------------
// saveAgentSetting — agents use this to persist learned configuration.
// Writes structured patch to memory/agent-overrides.yaml and a human-readable
// entry to DECISIONS.md. This closes the learning loop:
//   agents run → learn → save settings → next run starts smarter
// ---------------------------------------------------------------------------

const saveAgentSettingInputSchema = z.object({
  workspacePath: z.string().describe('Absolute path to workspace root (directory containing guildhall.yaml)'),
  decisionsPath: z.string().describe('Absolute path to DECISIONS.md'),
  agentRole: z.string().describe('Your agent role: coordinator, worker, reviewer, gateChecker, or spec'),
  rationale: z.string().describe('Why are you saving this setting? Be specific about what you observed.'),

  modelOverrides: z
    .object({
      spec: z.string().optional(),
      coordinator: z.string().optional(),
      worker: z.string().optional(),
      reviewer: z.string().optional(),
      gateChecker: z.string().optional(),
    })
    .optional()
    .describe('Override model assignments for specific roles'),

  coordinatorId: z.string().optional().describe('Coordinator id to refine (e.g. "looma", "knit")'),
  addConcern: z
    .object({
      id: z.string(),
      description: z.string(),
      reviewQuestions: z.array(z.string()),
    })
    .optional()
    .describe('New concern to add to this coordinator'),
  removeConcernId: z.string().optional().describe('id of a concern to remove from this coordinator'),
  addAutonomousDecision: z.string().optional().describe('New decision type this coordinator can make autonomously'),
  addEscalationTrigger: z.string().optional().describe('New condition that should trigger human escalation'),
  mandateAddendum: z.string().optional().describe("Additional text to append to this coordinator's mandate"),

  addIgnorePattern: z.string().optional().describe('File/dir pattern to add to the ignore list'),
  maxRevisions: z.number().int().positive().optional().describe('Override max revision cycles'),
})

export type SaveAgentSettingInput = z.input<typeof saveAgentSettingInputSchema>
export interface SaveAgentSettingResult {
  success: boolean
  summary?: string
  error?: string
}

export async function saveAgentSetting(input: SaveAgentSettingInput): Promise<SaveAgentSettingResult> {
  try {
    const {
      workspacePath,
      decisionsPath,
      agentRole,
      rationale,
      modelOverrides,
      coordinatorId,
      addConcern,
      removeConcernId,
      addAutonomousDecision,
      addEscalationTrigger,
      mandateAddendum,
      addIgnorePattern,
      maxRevisions,
    } = input

    const coordinators: AgentSettings['coordinators'] = {}
    if (coordinatorId) {
      coordinators[coordinatorId] = {
        addConcerns: addConcern ? [addConcern] : [],
        removeConcerns: removeConcernId ? [removeConcernId] : [],
        addAutonomousDecisions: addAutonomousDecision ? [addAutonomousDecision] : [],
        addEscalationTriggers: addEscalationTrigger ? [addEscalationTrigger] : [],
        ...(mandateAddendum ? { mandateAddendum } : {}),
        history: [],
      }
    }

    const patch: Partial<AgentSettings> = {
      coordinators,
      addIgnore: addIgnorePattern ? [addIgnorePattern] : [],
      history: [],
      ...(modelOverrides ? { models: modelOverrides } : {}),
      ...(maxRevisions !== undefined ? { maxRevisions } : {}),
    }

    updateAgentSettings(workspacePath, patch, { agentRole, rationale })

    const changes: string[] = []
    if (modelOverrides) {
      const overridden = Object.entries(modelOverrides).filter(([, v]) => v != null)
      if (overridden.length > 0) {
        changes.push(`Model overrides: ${overridden.map(([k, v]) => `${k} → ${v}`).join(', ')}`)
      }
    }
    if (coordinatorId) {
      if (addConcern) changes.push(`Added concern "${addConcern.id}" to coordinator ${coordinatorId}`)
      if (removeConcernId) changes.push(`Removed concern "${removeConcernId}" from coordinator ${coordinatorId}`)
      if (addAutonomousDecision)
        changes.push(`Added autonomous decision to ${coordinatorId}: "${addAutonomousDecision}"`)
      if (addEscalationTrigger)
        changes.push(`Added escalation trigger to ${coordinatorId}: "${addEscalationTrigger}"`)
      if (mandateAddendum) changes.push(`Appended mandate addendum to coordinator ${coordinatorId}`)
    }
    if (addIgnorePattern) changes.push(`Added ignore pattern: "${addIgnorePattern}"`)
    if (maxRevisions !== undefined) changes.push(`Updated maxRevisions to ${maxRevisions}`)

    const timestamp = new Date().toISOString()
    const block = [
      ``,
      `## [agent-setting] ${timestamp}`,
      `**Agent:** ${agentRole} (auto-learned)`,
      ``,
      `**Changes:**`,
      ...changes.map((c) => `- ${c}`),
      ``,
      `**Rationale:** ${rationale}`,
      ``,
      `_Written to memory/agent-overrides.yaml — edit or delete that file to revert._`,
      ``,
      `---`,
    ].join('\n')

    await fs.appendFile(decisionsPath, block, 'utf-8')

    const summary =
      changes.length > 0 ? `Saved: ${changes.join('; ')}` : 'No changes recorded (all inputs were empty)'

    return { success: true, summary }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const saveAgentSettingTool = defineTool({
  name: 'save-agent-setting',
  description: `
Persist a learned configuration change so future runs start with better settings.
Use this when you notice a recurring pattern, edge case, or quality issue that
should affect how agents behave going forward. Examples:

- You keep seeing accessibility regressions → add a new coordinator concern
- An escalation trigger fires as a false positive → record a refinement note
- A model keeps timing out on gate checks → request a model swap for that role
- You discover a directory that should always be ignored → add an ignore pattern
- You've learned a new safe autonomous decision type → record it

Every call also writes a human-readable entry to DECISIONS.md so the change
is auditable. Only call this for persistent behavioral changes, not routine observations.
  `.trim(),
  inputSchema: saveAgentSettingInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await saveAgentSetting(input)
    return {
      output: result.success
        ? result.summary ?? 'Saved'
        : `Error saving setting: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
