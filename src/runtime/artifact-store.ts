import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { compileRichArtifact, type RichArtifact, type RichArtifactRenderTree } from '@guildhall/protocol'
import { atomicWriteText } from '@guildhall/sessions'

export const RichArtifactRecord = z.object({
  id: z.string(),
  taskId: z.string(),
  contentType: z.literal('guildhall-html-v1'),
  artifactKind: z.string(),
  title: z.string(),
  source: z.object({ html: z.string() }),
  renderTree: z.custom<RichArtifactRenderTree>(),
  fallbackMarkdown: z.string(),
  validation: z.object({
    ok: z.boolean(),
    errors: z.array(z.string()).default([]),
  }),
  provenance: z.object({
    createdBy: z.string(),
    createdAt: z.string(),
  }),
  hash: z.string(),
})
export type RichArtifactRecord = z.infer<typeof RichArtifactRecord>

export async function saveRichArtifactRecord(input: {
  memoryDir: string
  taskId: string
  artifact: RichArtifact
}): Promise<RichArtifactRecord> {
  const compiled = compileRichArtifact(input.artifact)
  if (!compiled.ok) {
    throw new Error(`Invalid rich artifact: ${compiled.errors.join('; ')}`)
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(input.artifact)).digest('hex')
  const id = `${slugify(input.artifact.title)}-${hash.slice(0, 12)}`
  const record: RichArtifactRecord = {
    id,
    taskId: input.taskId,
    contentType: input.artifact.contentType,
    artifactKind: input.artifact.artifactKind,
    title: input.artifact.title.trim(),
    source: { html: input.artifact.html },
    renderTree: compiled.renderTree,
    fallbackMarkdown: input.artifact.fallbackMarkdown,
    validation: { ok: true, errors: [] },
    provenance: {
      createdBy: input.artifact.createdBy ?? 'unknown',
      createdAt: new Date().toISOString(),
    },
    hash,
  }
  const filePath = artifactPath(input.memoryDir, input.taskId, id)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(record, null, 2) + '\n')
  return record
}

export async function loadRichArtifactRecord(input: {
  memoryDir: string
  taskId: string
  artifactId: string
}): Promise<RichArtifactRecord> {
  const raw = await fsp.readFile(artifactPath(input.memoryDir, input.taskId, input.artifactId), 'utf-8')
  return RichArtifactRecord.parse(JSON.parse(raw))
}

function artifactPath(memoryDir: string, taskId: string, artifactId: string): string {
  return path.join(memoryDir, 'tasks', taskId, 'artifacts', `${artifactId}.json`)
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artifact'
}
