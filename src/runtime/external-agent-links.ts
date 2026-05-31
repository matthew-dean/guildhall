import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const EXTERNAL_AGENT_LINKS_FILE = 'external-agent-links.json'

export const ExternalAgentLinkProvider = z.enum(['codex-subagent'])
export type ExternalAgentLinkProvider = z.infer<typeof ExternalAgentLinkProvider>

export const ExternalAgentLinkStatus = z.enum(['running', 'completed', 'failed', 'blocked', 'unknown'])
export type ExternalAgentLinkStatus = z.infer<typeof ExternalAgentLinkStatus>

export const ExternalAgentLink = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  provider: ExternalAgentLinkProvider,
  externalAgentId: z.string().min(1),
  label: z.string().min(1),
  status: ExternalAgentLinkStatus.default('unknown'),
  targetProjectPath: z.string().optional(),
  promptSummary: z.string().min(1),
  resultSummary: z.string().optional(),
  links: z.array(z.object({
    label: z.string().min(1),
    url: z.string().min(1),
  })).default([]),
  startedAt: z.string(),
  updatedAt: z.string(),
})
export type ExternalAgentLink = z.infer<typeof ExternalAgentLink>
export type ExternalAgentLinkInput = z.input<typeof ExternalAgentLink>

export const ExternalAgentLinksStore = z.object({
  version: z.literal(1).default(1),
  links: z.array(ExternalAgentLink).default([]),
})
export type ExternalAgentLinksStore = z.infer<typeof ExternalAgentLinksStore>

export async function readExternalAgentLinksStore(memoryDir: string): Promise<ExternalAgentLinksStore> {
  const file = path.join(memoryDir, EXTERNAL_AGENT_LINKS_FILE)
  try {
    return ExternalAgentLinksStore.parse(JSON.parse(await fsp.readFile(file, 'utf-8')))
  } catch {
    return ExternalAgentLinksStore.parse({})
  }
}

export async function listExternalAgentLinks(input: {
  memoryDir: string
  taskId?: string
}): Promise<ExternalAgentLinksStore> {
  const store = await readExternalAgentLinksStore(input.memoryDir)
  return {
    ...store,
    links: input.taskId
      ? store.links.filter(link => link.taskId === input.taskId)
      : store.links,
  }
}

export async function recordExternalAgentLink(input: {
  memoryDir: string
  link: Omit<ExternalAgentLinkInput, 'startedAt' | 'updatedAt'> & Partial<Pick<ExternalAgentLinkInput, 'startedAt' | 'updatedAt'>>
}): Promise<ExternalAgentLink> {
  const store = await readExternalAgentLinksStore(input.memoryDir)
  const existing = store.links.find(link => link.id === input.link.id)
  const now = new Date().toISOString()
  const link = ExternalAgentLink.parse({
    ...input.link,
    startedAt: input.link.startedAt ?? existing?.startedAt ?? now,
    updatedAt: input.link.updatedAt ?? now,
  })
  await writeExternalAgentLinksStore(input.memoryDir, {
    ...store,
    links: upsert(store.links, link),
  })
  return link
}

export async function updateExternalAgentLinkStatus(input: {
  memoryDir: string
  id: string
  status: ExternalAgentLinkStatus
  resultSummary?: string
}): Promise<ExternalAgentLink> {
  const store = await readExternalAgentLinksStore(input.memoryDir)
  const existing = store.links.find(link => link.id === input.id)
  if (!existing) throw new Error(`External agent link not found: ${input.id}`)

  const updated = ExternalAgentLink.parse({
    ...existing,
    status: input.status,
    resultSummary: input.resultSummary ?? existing.resultSummary,
    updatedAt: new Date().toISOString(),
  })
  await writeExternalAgentLinksStore(input.memoryDir, {
    ...store,
    links: upsert(store.links, updated),
  })
  return updated
}

async function writeExternalAgentLinksStore(memoryDir: string, store: ExternalAgentLinksStore): Promise<void> {
  await fsp.mkdir(memoryDir, { recursive: true })
  const file = path.join(memoryDir, EXTERNAL_AGENT_LINKS_FILE)
  const tmp = `${file}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(ExternalAgentLinksStore.parse(store), null, 2)}\n`, 'utf-8')
  await fsp.rename(tmp, file)
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return [...items.filter(existing => existing.id !== item.id), item]
    .sort((left, right) => left.id.localeCompare(right.id))
}
