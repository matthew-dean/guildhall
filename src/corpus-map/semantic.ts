import { z } from 'zod'
import type {
  CodebaseMap,
  CorpusFileEntry,
  CorpusSemanticIndexer,
  CorpusSemanticSummary,
} from './types.js'

const SemanticAreaSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  canonicalFiles: z.array(z.string()).default([]),
})

const SemanticAbstractionSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  canonicalFiles: z.array(z.string()).default([]),
  reuseRule: z.string().default('Reuse the canonical files before adding a parallel pattern.'),
})

const SemanticReadNextSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
})

const SemanticResponseSchema = z.object({
  corpusKind: z.enum(['documentation', 'code', 'mixed', 'unknown']).default('unknown'),
  confidence: z.number().min(0).max(1).default(0.5),
  projectPurpose: z.string().min(1),
  currentTruth: z.array(z.string()).default([]),
  architectureAreas: z.array(SemanticAreaSchema).default([]),
  canonicalAbstractions: z.array(SemanticAbstractionSchema).default([]),
  gapsOrRisks: z.array(z.string()).default([]),
  readNext: z.array(SemanticReadNextSchema).default([]),
  workerGuidance: z.array(z.string()).default([]),
  needsBroaderRead: z.boolean().default(false),
})

export async function enrichCodebaseMapSemantics(
  map: CodebaseMap,
  indexer: CorpusSemanticIndexer,
  now = new Date(),
): Promise<CodebaseMap> {
  const prompt = buildSemanticIndexPrompt(map)
  const raw = await indexer.completeJson({ prompt, map })
  const parsed = await parseSemanticResponse(raw, map, indexer)
  const semantic: CorpusSemanticSummary = {
    generatedAt: now.toISOString(),
    modelId: indexer.modelId,
    corpusKind: parsed.corpusKind,
    confidence: parsed.confidence,
    projectPurpose: parsed.projectPurpose,
    currentTruth: parsed.currentTruth.slice(0, 12),
    architectureAreas: parsed.architectureAreas.slice(0, 12),
    canonicalAbstractions: parsed.canonicalAbstractions.slice(0, 16),
    gapsOrRisks: parsed.gapsOrRisks.slice(0, 12),
    readNext: parsed.readNext.slice(0, 16),
    workerGuidance: parsed.workerGuidance.slice(0, 12),
    needsBroaderRead: parsed.needsBroaderRead,
  }
  return { ...map, semantic }
}

async function parseSemanticResponse(
  raw: string,
  map: CodebaseMap,
  indexer: CorpusSemanticIndexer,
): Promise<z.infer<typeof SemanticResponseSchema>> {
  try {
    return SemanticResponseSchema.parse(parseSemanticJsonObject(raw))
  } catch (err) {
    if (!indexer.repairJson) throw err
    const message = err instanceof Error ? err.message : String(err)
    const repaired = await indexer.repairJson({
      raw,
      error: message,
      schemaHint: semanticResponseSchemaHint(),
      map,
    })
    return SemanticResponseSchema.parse(parseSemanticJsonObject(repaired))
  }
}

export function buildSemanticIndexPrompt(map: CodebaseMap): string {
  const files = Object.values(map.files)
  const byKind = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.kind] = (acc[file.kind] ?? 0) + 1
    return acc
  }, {})
  const excerpt = {
    project: map.project,
    fileCounts: byKind,
    entrypoints: map.entrypoints,
    areas: map.areas.map((area) => ({
      id: area.id,
      title: area.title,
      summary: area.summary,
      canonicalFiles: area.canonicalFiles.slice(0, 10),
      conventions: area.conventions.slice(0, 5),
      tests: area.tests.slice(0, 10),
    })),
    deterministicAbstractions: map.abstractions,
    designSystem: map.designSystem,
    source: summarizeFiles(files.filter((file) => file.kind === 'source'), 40),
    docs: summarizeFiles(files.filter((file) => file.kind === 'doc'), 40),
    tests: summarizeFiles(files.filter((file) => file.kind === 'test'), 30),
    verification: map.verification,
  }
  return [
    "You are Guildhall's contextIndexer.",
    'Analyze this compact deterministic Corpus Map and improve worker orientation without dumping source.',
    'Assume the deterministic map may be thin, stale, or too literal. Use the file summaries to infer purpose, contracts, canonical abstractions, risks, and read-next guidance.',
    'If the corpus is documentation-heavy, say so directly and do not claim product code exists.',
    'If the corpus is code-heavy, name the canonical source abstractions workers should inspect before editing.',
    '',
    'Return ONLY valid JSON with this exact shape:',
    '{',
    '  "corpusKind": "documentation" | "code" | "mixed" | "unknown",',
    '  "confidence": 0.0,',
    '  "projectPurpose": "string",',
    '  "currentTruth": ["string"],',
    '  "architectureAreas": [{"name": "string", "purpose": "string", "canonicalFiles": ["path"]}],',
    '  "canonicalAbstractions": [{"name": "string", "purpose": "string", "canonicalFiles": ["path"], "reuseRule": "string"}],',
    '  "gapsOrRisks": ["string"],',
    '  "readNext": [{"path": "path", "reason": "string"}],',
    '  "workerGuidance": ["string"],',
    '  "needsBroaderRead": false',
    '}',
    '',
    'Corpus Map excerpt:',
    JSON.stringify(excerpt, null, 2),
  ].join('\n')
}

function summarizeFiles(files: CorpusFileEntry[], limit: number): Array<{
  path: string
  symbols: string[]
  imports: string[]
  summary: string
}> {
  return files.slice(0, limit).map((file) => ({
    path: file.path,
    symbols: file.symbols.slice(0, 10),
    imports: file.imports.slice(0, 10),
    summary: file.summary,
  }))
}

export function parseSemanticJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // Continue to tolerant extraction below.
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) return JSON.parse(repairJsonText(fence[1]))
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('Context indexer returned no JSON object.')
  }
  return JSON.parse(repairJsonText(raw.slice(start, end + 1)))
}

function repairJsonText(raw: string): string {
  return raw
    .trim()
    .replace(/,\s*([}\]])/g, '$1')
}

function semanticResponseSchemaHint(): string {
  return [
    'Return ONLY valid JSON matching this schema:',
    '{',
    '  "corpusKind": "documentation" | "code" | "mixed" | "unknown",',
    '  "confidence": number from 0 to 1,',
    '  "projectPurpose": string,',
    '  "currentTruth": string[],',
    '  "architectureAreas": [{"name": string, "purpose": string, "canonicalFiles": string[]}],',
    '  "canonicalAbstractions": [{"name": string, "purpose": string, "canonicalFiles": string[], "reuseRule": string}],',
    '  "gapsOrRisks": string[],',
    '  "readNext": [{"path": string, "reason": string}],',
    '  "workerGuidance": string[],',
    '  "needsBroaderRead": boolean',
    '}',
    'Preserve the same substance; only repair JSON syntax or schema shape.',
  ].join('\n')
}
