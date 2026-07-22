import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getProjectSystemStatePathFromMemoryDir } from '@guildhall/sessions'
import { z } from 'zod'
import type { SkillDefinition } from './types.js'

export const ProjectSkillProposalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Exact machine routing keys. Free-form task prose is never consulted. */
  routingKeys: z.array(z.string().min(1)).default([]),
  content: z.string().min(1),
  status: z.enum(['suggested', 'active', 'dismissed']).default('suggested'),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  requiresApproval: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
  activatedAt: z.string().optional(),
  dismissedAt: z.string().optional(),
})

const ProjectSkillStoreSchema = z.object({
  version: z.literal(1).default(1),
  proposals: z.array(ProjectSkillProposalSchema).default([]),
})

export type ProjectSkillProposal = z.infer<typeof ProjectSkillProposalSchema>

export interface ProjectSkillProposalInput {
  id: string
  name: string
  description: string
  routingKeys?: string[]
  content: string
  risk?: 'low' | 'medium' | 'high'
  requiresApproval?: boolean
}

export function projectSkillProposalsPath(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'project-skills.json')
}

function readProjectSkillStore(memoryDir: string): z.infer<typeof ProjectSkillStoreSchema> {
  const storePath = projectSkillProposalsPath(memoryDir)
  if (!existsSync(storePath)) return { version: 1, proposals: [] }
  try {
    return ProjectSkillStoreSchema.parse(JSON.parse(readFileSync(storePath, 'utf-8')))
  } catch {
    return { version: 1, proposals: [] }
  }
}

function writeProjectSkillStore(
  memoryDir: string,
  store: z.infer<typeof ProjectSkillStoreSchema>,
): void {
  mkdirSync(dirname(projectSkillProposalsPath(memoryDir)), { recursive: true })
  writeFileSync(
    projectSkillProposalsPath(memoryDir),
    `${JSON.stringify(ProjectSkillStoreSchema.parse(store), null, 2)}\n`,
    'utf-8',
  )
}

export function readProjectSkillProposals(memoryDir: string): ProjectSkillProposal[] {
  return readProjectSkillStore(memoryDir).proposals
}

export async function proposeProjectSkill(input: {
  memoryDir: string
  proposal: ProjectSkillProposalInput
}): Promise<ProjectSkillProposal> {
  const store = readProjectSkillStore(input.memoryDir)
  const now = new Date().toISOString()
  const existing = store.proposals.find((proposal) => proposal.id === input.proposal.id)
  const next = ProjectSkillProposalSchema.parse({
    ...existing,
    ...input.proposal,
    routingKeys: input.proposal.routingKeys ?? existing?.routingKeys ?? [],
    status: existing?.status ?? 'suggested',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  store.proposals = [
    ...store.proposals.filter((proposal) => proposal.id !== next.id),
    next,
  ].sort((a, b) => a.id.localeCompare(b.id))
  writeProjectSkillStore(input.memoryDir, store)
  return next
}

export async function activateProjectSkillProposal(input: {
  memoryDir: string
  id: string
  approved?: boolean
}): Promise<ProjectSkillProposal> {
  const store = readProjectSkillStore(input.memoryDir)
  const index = store.proposals.findIndex((proposal) => proposal.id === input.id)
  if (index === -1) throw new Error(`Project skill proposal not found: ${input.id}`)
  const existing = store.proposals[index]!
  if (existing.status === 'dismissed') {
    throw new Error(`Project skill proposal was dismissed: ${input.id}`)
  }
  if ((existing.requiresApproval || existing.risk !== 'low') && input.approved !== true) {
    throw new Error(`Project skill proposal requires approval before activation: ${input.id}`)
  }
  const now = new Date().toISOString()
  const next = ProjectSkillProposalSchema.parse({
    ...existing,
    status: 'active',
    activatedAt: now,
    updatedAt: now,
  })
  store.proposals[index] = next
  writeProjectSkillStore(input.memoryDir, store)
  return next
}

export async function dismissProjectSkillProposal(input: {
  memoryDir: string
  id: string
}): Promise<ProjectSkillProposal> {
  const store = readProjectSkillStore(input.memoryDir)
  const index = store.proposals.findIndex((proposal) => proposal.id === input.id)
  if (index === -1) throw new Error(`Project skill proposal not found: ${input.id}`)
  const now = new Date().toISOString()
  const next = ProjectSkillProposalSchema.parse({
    ...store.proposals[index],
    status: 'dismissed',
    dismissedAt: now,
    updatedAt: now,
  })
  store.proposals[index] = next
  writeProjectSkillStore(input.memoryDir, store)
  return next
}

export async function resetProjectSkillProposals(memoryDir: string): Promise<void> {
  writeProjectSkillStore(memoryDir, { version: 1, proposals: [] })
}

function matchesRoutingKey(proposal: ProjectSkillProposal, routingKeys: readonly string[]): boolean {
  const available = new Set(routingKeys.map((key) => key.trim().toLowerCase()).filter(Boolean))
  return proposal.routingKeys.some((key) => available.has(key.trim().toLowerCase()))
}

export function selectRelevantProjectSkills(
  proposals: readonly ProjectSkillProposal[],
  routingKeys: readonly string[],
): SkillDefinition[] {
  return proposals
    .filter((proposal) => proposal.status === 'active')
    .filter((proposal) => proposal.routingKeys.length > 0)
    .filter((proposal) => matchesRoutingKey(proposal, routingKeys))
    .map((proposal) => ({
      name: proposal.name,
      description: proposal.description,
      content: proposal.content,
      source: 'project',
      path: `project-skills.json#${proposal.id}`,
    }))
}
