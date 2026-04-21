import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { DecisionEntry, ProgressEntry } from '@guildhall/core'

const logDecisionInputSchema = z.object({
  decisionsPath: z.string().describe('Absolute path to DECISIONS.md'),
  entry: DecisionEntry,
})

export type LogDecisionInput = z.input<typeof logDecisionInputSchema>
export interface LogDecisionResult {
  success: boolean
  error?: string
}

export async function logDecision(input: LogDecisionInput): Promise<LogDecisionResult> {
  try {
    const { entry } = input
    const block = [
      `\n## [${entry.id}] ${entry.title}`,
      `**Date:** ${entry.timestamp}`,
      `**Agent:** ${entry.agentId} (${entry.domain})`,
      entry.taskId ? `**Task:** ${entry.taskId}` : null,
      entry.overridesSoftGate ? `**Overrides soft gate:** ${entry.overridesSoftGate}` : null,
      '',
      `**Context:** ${entry.context}`,
      '',
      `**Decision:** ${entry.decision}`,
      '',
      `**Consequences:** ${entry.consequences}`,
      '',
      '---',
    ]
      .filter((line) => line !== null)
      .join('\n')

    await fs.appendFile(input.decisionsPath, block, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const logDecisionTool = defineTool({
  name: 'log-decision',
  description:
    'Append an architectural decision record (ADR) to DECISIONS.md. Use whenever a significant decision is made, especially soft gate overrides.',
  inputSchema: logDecisionInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await logDecision(input)
    return {
      output: result.success ? `Logged decision ${input.entry.id}` : `Error: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const logProgressInputSchema = z.object({
  progressPath: z.string().describe('Absolute path to PROGRESS.md'),
  entry: ProgressEntry,
})

export type LogProgressInput = z.input<typeof logProgressInputSchema>
export interface LogProgressResult {
  success: boolean
  error?: string
}

export async function logProgress(input: LogProgressInput): Promise<LogProgressResult> {
  try {
    const { entry } = input
    const emoji = {
      heartbeat: '💓',
      milestone: '🏁',
      blocked: '🚧',
      escalation: '🆘',
    }[entry.type]

    const block = [
      `\n### ${emoji} ${entry.type.toUpperCase()} — ${entry.timestamp}`,
      `**Agent:** ${entry.agentId} | **Domain:** ${entry.domain}`,
      entry.taskId ? `**Task:** ${entry.taskId}` : null,
      '',
      entry.summary,
      '',
      '---',
    ]
      .filter((line) => line !== null)
      .join('\n')

    await fs.appendFile(input.progressPath, block, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const logProgressTool = defineTool({
  name: 'log-progress',
  description:
    "Append a progress update to PROGRESS.md. Call after completing significant work, hitting milestones, or when blocked. This is how the human tracks what's happening.",
  inputSchema: logProgressInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await logProgress(input)
    return {
      output: result.success ? `Logged ${input.entry.type} progress` : `Error: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const updateMemoryInputSchema = z.object({
  memoryPath: z.string().describe('Absolute path to MEMORY.md'),
  section: z.string().describe('Section heading'),
  content: z.string().describe('Content to append under this section'),
})

export type UpdateMemoryInput = z.input<typeof updateMemoryInputSchema>
export interface UpdateMemoryResult {
  success: boolean
  error?: string
}

export async function updateMemory(input: UpdateMemoryInput): Promise<UpdateMemoryResult> {
  try {
    const block = `\n## ${input.section}\n\n${input.content}\n\n---\n`
    await fs.appendFile(input.memoryPath, block, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const updateMemoryTool = defineTool({
  name: 'update-memory',
  description:
    'Append new knowledge to MEMORY.md. Use to record conventions, architectural patterns, or anything a future agent should know about this project.',
  inputSchema: updateMemoryInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await updateMemory(input)
    return {
      output: result.success ? `Updated memory: ${input.section}` : `Error: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
