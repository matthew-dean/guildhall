#!/usr/bin/env node
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const rubricDimensions = [
  'contextAssembly',
  'compactionQuality',
  'temporalCorrectness',
  'provenance',
  'configurability',
  'localFirstFit',
  'repoLocalThinness',
  'integrationSurface',
  'costLatency',
  'failureBehavior',
]

const forbiddenTaskFields = [
  'notes',
  'reviewVerdicts',
  'adjudications',
  'gateResults',
  'escalations',
  'agentIssues',
  'worktreePath',
  'branchName',
  'baseBranch',
  'mergeRecord',
  'revisionCount',
  'retryWindow',
  'remediationAttempts',
  'handoffStep',
]

export const candidateProfiles = [
  {
    id: 'mastra-memory',
    name: 'Mastra Memory / Observational Memory',
    role: 'Best fit for TypeScript-native memory substrate, compaction workflow, scoped recall, and context support without replacing Guildhall reasoning.',
    sourceRefs: [
      'https://mastra.ai/blog/changelog-2026-02-04',
      'https://mastra.ai/reference/memory/observational-memory',
      'https://mastra.ai/en/reference/memory/query',
    ],
    scores: {
      contextAssembly: 4,
      compactionQuality: 5,
      temporalCorrectness: 3,
      provenance: 4,
      configurability: 5,
      localFirstFit: 4,
      repoLocalThinness: 5,
      integrationSurface: 5,
      costLatency: 4,
      failureBehavior: 4,
    },
    strengths: [
      'Observational Memory is explicitly about compressing long-running agent context into observations and reflections rather than replaying huge histories.',
      'Thread/resource scoping, recall, raw-message ranges, semantic search, and memory processors match Guildhall substrate needs.',
      'TypeScript-native integration is a much better fit than Python-first graph memory for Guildhall runtime plumbing.',
    ],
    risks: [
      'Does not automatically solve Guildhall-specific task truth, stale/current state, or context-inclusion policy.',
      'Resource-scoped memory is still a quality risk for simultaneous project threads unless Guildhall constrains scope and prompts carefully.',
    ],
  },
  {
    id: 'langgraph',
    name: 'LangGraph / LangMem-style memory',
    role: 'Best immediate fit for context assembly and checkpoint-aware short-term memory.',
    sourceRefs: [
      'https://docs.langchain.com/oss/javascript/langgraph/add-memory',
    ],
    scores: {
      contextAssembly: 5,
      compactionQuality: 4,
      temporalCorrectness: 2,
      provenance: 3,
      configurability: 5,
      localFirstFit: 3,
      repoLocalThinness: 5,
      integrationSurface: 4,
      costLatency: 3,
      failureBehavior: 4,
    },
    strengths: [
      'JavaScript/TypeScript docs show trimming, deletion, summarization, checkpoints, and long-term stores.',
      'Good fit for assembling next-agent context packets from selected memories plus recent state.',
      'Can keep repo-local state thin because memory/checkpoints live in stores outside the project checkout.',
    ],
    risks: [
      'Less opinionated about temporal fact supersession than graph-first memory systems.',
      'Adopting graph runtime patterns may be broader than Guildhall needs if used beyond memory/context.',
    ],
  },
  {
    id: 'letta',
    name: 'Letta / MemGPT',
    role: 'Strong memory architecture reference for core/recall/archival hierarchy.',
    sourceRefs: [
      'https://docs.letta.com/guides/agents/architectures/memgpt',
      'https://docs.letta.com/guides/agents/memory',
    ],
    scores: {
      contextAssembly: 5,
      compactionQuality: 5,
      temporalCorrectness: 3,
      provenance: 3,
      configurability: 4,
      localFirstFit: 3,
      repoLocalThinness: 5,
      integrationSurface: 2,
      costLatency: 2,
      failureBehavior: 3,
    },
    strengths: [
      'Memory hierarchy directly addresses what stays in context versus recall/archival storage.',
      'Automatic compaction of older messages into recursive summaries is close to Guildhall context pressure needs.',
      'Self-editing memory model is a useful design reference for agents managing their own context.',
    ],
    risks: [
      'May be too agent-architecture-shaped for Guildhall to embed as only a memory/context subsystem.',
      'The agent deciding what to remember is useful but needs Guildhall policy guards for evidence and provenance.',
    ],
  },
  {
    id: 'mem0',
    name: 'Mem0',
    role: 'Practical durable memory extraction layer with broad integrations.',
    sourceRefs: [
      'https://docs.mem0.ai/',
      'https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-operations/add.mdx',
    ],
    scores: {
      contextAssembly: 3,
      compactionQuality: 4,
      temporalCorrectness: 3,
      provenance: 3,
      configurability: 4,
      localFirstFit: 3,
      repoLocalThinness: 5,
      integrationSurface: 3,
      costLatency: 3,
      failureBehavior: 3,
    },
    strengths: [
      'Open-source memory SDK supports adding inferred memories or raw messages and exposes search/list/update/delete style operations.',
      'Good candidate for extracting durable lessons from noisy task interactions.',
      'Could keep project checkout clean because memory state is external to repo-local files.',
    ],
    risks: [
      'Likely optimized for user preference/conversation memory rather than typed project/task evidence.',
      'Context packet assembly would still need a Guildhall layer.',
    ],
  },
  {
    id: 'llamaindex-memory',
    name: 'LlamaIndex memory',
    role: 'Useful reference for token-budgeted flushing and memory blocks.',
    sourceRefs: [
      'https://developers.llamaindex.ai/python/framework-api-reference/memory/memory',
    ],
    scores: {
      contextAssembly: 4,
      compactionQuality: 4,
      temporalCorrectness: 2,
      provenance: 2,
      configurability: 4,
      localFirstFit: 2,
      repoLocalThinness: 5,
      integrationSurface: 2,
      costLatency: 3,
      failureBehavior: 3,
    },
    strengths: [
      'Token limits, flush size, chat-history ratios, and memory blocks are directly relevant to compaction mechanics.',
      'Good pattern library for context-window management.',
    ],
    risks: [
      'Python-first and RAG-framework-shaped; less direct fit for Guildhall TypeScript runtime.',
      'Does not solve project temporal truth or evidence provenance by itself.',
    ],
  },
  {
    id: 'guildhall-baseline',
    name: 'Minimal Guildhall baseline',
    control: true,
    role: 'Control: strict writer boundary plus deterministic rollups and context packets.',
    sourceRefs: [
      'internal/plans/2026-06-04-project-state-storage-governance-and-cleanup.md',
    ],
    scores: {
      contextAssembly: 3,
      compactionQuality: 3,
      temporalCorrectness: 3,
      provenance: 5,
      configurability: 5,
      localFirstFit: 5,
      repoLocalThinness: 5,
      integrationSurface: 5,
      costLatency: 4,
      failureBehavior: 5,
    },
    strengths: [
      'Smallest operational surface and easiest to make repo-local state off/thin by default.',
      'Can enforce Guildhall-specific writer boundary and provenance rules exactly.',
    ],
    risks: [
      'Would reinvent memory extraction and context compaction patterns unless paired with an external system or adopted patterns.',
      'Lower upside for semantic/temporal retrieval unless we build more custom machinery.',
    ],
  },
]

const fixtureSpecs = [
  {
    id: 'fair-labor-license',
    label: 'Fair Labor License task-state bloat',
    projectRoot: '/Users/matthew/git/oss/fair-labor-license',
    files: ['.guildhall/TASKS.json', '.guildhall/TASKS.before-0.10.0-task-hierarchy-links.json', '.guildhall/PROGRESS.md'],
    queries: [
      'What is the current auth task status?',
      'What evidence matters for the next worker context?',
      'Which review/escalation history is stale or superseded?',
    ],
  },
  {
    id: 'looma-knit',
    label: 'Looma + Knit progress bloat',
    projectRoot: '/Users/matthew/git/oss/looma-knit',
    files: ['.guildhall/PROGRESS.md', '.guildhall/TASKS.json'],
    queries: [
      'What happened recently?',
      'What remains actionable?',
      'Which progress churn should be compacted?',
    ],
  },
  {
    id: 'jess',
    label: 'Jess generated intelligence bloat',
    projectRoot: '/Users/matthew/git/oss/jess',
    files: ['.guildhall/codebase-map.yaml', '.guildhall/structural-map/accepted.json', '.guildhall/structural-map/drafts/structural-map-mpyrvqjg.json'],
    queries: [
      'What project structure should enter the next context packet?',
      'Which generated details should remain searchable but out of prompt?',
    ],
  },
  {
    id: 'narrative-harness',
    label: 'Narrative Harness migration backup',
    projectRoot: '/Users/matthew/git/oss/narrative-harness',
    files: ['.guildhall/TASKS.json', '.guildhall/TASKS.before-0.10.0-task-hierarchy-links.json', '.guildhall/PROGRESS.md'],
    queries: [
      'What is durable task state versus migration safety artifact?',
    ],
  },
]

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tasksFromQueue(queue) {
  if (Array.isArray(queue)) return queue
  if (isRecord(queue) && Array.isArray(queue.tasks)) return queue.tasks
  return []
}

export function analyzeTaskQueue(queue) {
  const tasks = tasksFromQueue(queue)
  const fieldBytes = new Map()
  const forbiddenFieldCounts = Object.fromEntries(forbiddenTaskFields.map(field => [field, 0]))
  const largestTasks = []

  for (const task of tasks) {
    if (!isRecord(task)) continue
    largestTasks.push({
      id: typeof task.id === 'string' ? task.id : 'unknown',
      title: typeof task.title === 'string' ? task.title : 'Untitled task',
      status: typeof task.status === 'string' ? task.status : 'unknown',
      bytes: byteLength(task),
    })
    for (const [field, value] of Object.entries(task)) {
      fieldBytes.set(field, (fieldBytes.get(field) ?? 0) + byteLength(value))
      if (field in forbiddenFieldCounts) forbiddenFieldCounts[field] += 1
    }
  }

  return {
    kind: 'task-queue',
    taskCount: tasks.length,
    topFieldBytes: [...fieldBytes.entries()]
      .map(([field, bytes]) => ({ field, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 12),
    forbiddenFieldCounts,
    largestTasks: largestTasks.sort((a, b) => b.bytes - a.bytes).slice(0, 8),
  }
}

function analyzeProgressMarkdown(content) {
  const blocks = content.split(/\n(?=###\s+)/).filter(block => block.trim().length > 0)
  const counts = {
    heartbeat: 0,
    milestone: 0,
    blocked: 0,
    escalation: 0,
    other: 0,
  }
  for (const block of blocks) {
    if (/\bHEARTBEAT\b/i.test(block)) counts.heartbeat += 1
    else if (/\bMILESTONE\b/i.test(block)) counts.milestone += 1
    else if (/\bBLOCKED\b/i.test(block)) counts.blocked += 1
    else if (/\bESCALATION\b/i.test(block)) counts.escalation += 1
    else counts.other += 1
  }
  return {
    kind: 'progress-log',
    blocks: blocks.length,
    counts,
    tailPreview: blocks.slice(-3).map(block => block.trim().split('\n').slice(0, 5).join('\n')),
  }
}

function analyzeGeneratedMap(content, relativePath) {
  const lines = content.split('\n')
  const fileLikeEntries = lines.filter(line => /^\s{2,}[^:\s][^:]*\.(?:ts|tsx|js|jsx|svelte|vue|md|json|yaml|yml):\s*$/.test(line)).length
  return {
    kind: 'generated-map',
    path: relativePath,
    lines: lines.length,
    fileLikeEntries,
    duplicateDraftRisk: /structural-map\/drafts\//.test(relativePath),
  }
}

function analyzeJsonFile(parsed, relativePath) {
  if (/TASKS(?:\.before-[^.]+)?\.json$/.test(relativePath)) return analyzeTaskQueue(parsed)
  if (/structural-map/.test(relativePath)) {
    return {
      kind: 'structural-map',
      topKeys: isRecord(parsed) ? Object.keys(parsed).slice(0, 12) : [],
      duplicateDraftRisk: /structural-map\/drafts\//.test(relativePath),
    }
  }
  return {
    kind: 'json',
    topKeys: isRecord(parsed) ? Object.keys(parsed).slice(0, 12) : [],
  }
}

async function readFixtureFile(projectRoot, relativePath) {
  const absolutePath = path.join(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    return {
      relativePath,
      exists: false,
      bytes: 0,
      analysis: { kind: 'missing' },
    }
  }

  const content = await fs.readFile(absolutePath, 'utf8')
  let analysis
  if (/\.json$/i.test(relativePath)) {
    try {
      analysis = analyzeJsonFile(JSON.parse(content), relativePath)
    } catch (err) {
      analysis = { kind: 'json-parse-error', error: String(err) }
    }
  } else if (/PROGRESS\.md$/i.test(relativePath)) {
    analysis = analyzeProgressMarkdown(content)
  } else if (/\.(yaml|yml)$/i.test(relativePath) || /codebase-map|structural-map/.test(relativePath)) {
    analysis = analyzeGeneratedMap(content, relativePath)
  } else {
    analysis = { kind: 'text', lines: content.split('\n').length }
  }
  return {
    relativePath,
    exists: true,
    bytes: byteLength(content),
    analysis,
  }
}

export async function auditFixtures(specs = fixtureSpecs) {
  const fixtures = []
  for (const spec of specs) {
    const files = []
    for (const relativePath of spec.files) {
      files.push(await readFixtureFile(spec.projectRoot, relativePath))
    }
    fixtures.push({
      ...spec,
      files,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    })
  }
  return fixtures
}

export function buildBaselineContextPacket(fixture, query) {
  const sections = [
    `# Context packet: ${fixture.label}`,
    `Query: ${query}`,
    `Project: ${fixture.projectRoot}`,
  ]
  const provenance = []
  for (const file of fixture.files ?? []) {
    if (!file.exists && file.exists !== undefined) continue
    provenance.push({
      projectRoot: fixture.projectRoot,
      path: file.relativePath,
      reason: 'fixture-summary',
    })
    const analysis = file.analysis ?? {}
    if (analysis.kind === 'task-queue') {
      const topFields = (analysis.topFieldBytes ?? [])
        .slice(0, 4)
        .map(item => `${item.field} ${formatBytes(item.bytes)}`)
        .join(', ')
      const largest = (analysis.largestTasks ?? [])
        .slice(0, 3)
        .map(task => `${task.id}: ${task.title}`)
        .join('; ')
      sections.push(`Task queue ${file.relativePath}: ${analysis.taskCount} tasks. Heavy fields: ${topFields}. Largest tasks: ${largest}.`)
    } else if (analysis.kind === 'progress-log') {
      sections.push(`Progress ${file.relativePath}: ${analysis.blocks} blocks; milestones ${analysis.counts?.milestone ?? 0}, escalations ${analysis.counts?.escalation ?? 0}, heartbeats ${analysis.counts?.heartbeat ?? 0}.`)
    } else if (analysis.kind === 'generated-map') {
      sections.push(`Generated map ${file.relativePath}: ${analysis.lines} lines, ${analysis.fileLikeEntries} file-like entries.`)
    } else {
      sections.push(`${file.relativePath}: ${analysis.kind ?? 'unknown'} (${formatBytes(file.bytes ?? 0)}).`)
    }
  }
  const text = sections.join('\n')
  return {
    query,
    sections,
    provenance,
    bytes: byteLength(text),
  }
}

export function evaluateCandidate(candidate) {
  const total = rubricDimensions.reduce((sum, dimension) => sum + (candidate.scores[dimension] ?? 0), 0)
  return {
    id: candidate.id,
    name: candidate.name,
    role: candidate.role,
    scores: Object.fromEntries(rubricDimensions.map(dimension => [dimension, candidate.scores[dimension] ?? 0])),
    total,
    maxTotal: rubricDimensions.length * 5,
    average: Number((total / rubricDimensions.length).toFixed(2)),
    strengths: candidate.strengths,
    risks: candidate.risks,
    sourceRefs: candidate.sourceRefs,
  }
}

function recommendationFor(evaluations) {
  const top = evaluations.find(candidate => candidate.id === 'mastra-memory')
  return {
    primary: top?.id ?? 'none',
    primaryLabel: top?.name ?? 'No candidate',
    secondary: null,
    summary:
      'Adopt Mastra Memory / Observational Memory as the TypeScript-native substrate for storage, compaction workflow, scoped recall, and context support. Graphiti was explored and did not bear fruit for Guildhall, so it is not on the roadmap. Keep repo-local storage off/thin by default regardless of candidate.',
  }
}

export function buildReport(fixtures, candidates = candidateProfiles) {
  const evaluations = candidates.map(evaluateCandidate)
  const contextPackets = fixtures.flatMap(fixture =>
    (fixture.queries ?? ['What should enter context?']).slice(0, 2).map(query =>
      buildBaselineContextPacket(fixture, query),
    ),
  )
  return {
    generatedAt: new Date().toISOString(),
    fixtures,
    candidates: evaluations,
    recommendation: recommendationFor(evaluations),
    contextPackets,
  }
}

export function renderMarkdown(report) {
  const lines = [
    '# LLM Memory And Context Evaluation Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Recommendation',
    '',
    report.recommendation.summary,
    '',
    `Primary prototype: **${report.recommendation.primaryLabel}**.`,
    '',
    '## Candidate Scores',
    '',
    '| Candidate | Total / 50 | Best fit | Main risk |',
    '| --- | ---: | --- | --- |',
    ...report.candidates
      .sort((a, b) => b.total - a.total)
      .map(candidate => `| ${candidate.name} | ${candidate.total} | ${candidate.role} | ${candidate.risks[0] ?? ''} |`),
    '',
    '## Fixture Audit',
    '',
  ]

  for (const fixture of report.fixtures) {
    lines.push(`### ${fixture.label}`, '')
    lines.push(`Project: \`${fixture.projectRoot}\``)
    lines.push(`Total audited bytes: ${formatBytes(fixture.totalBytes)}`, '')
    lines.push('| File | Bytes | Finding |')
    lines.push('| --- | ---: | --- |')
    for (const file of fixture.files) {
      lines.push(`| \`${file.relativePath}\` | ${formatBytes(file.bytes)} | ${findingSummary(file.analysis)} |`)
    }
    lines.push('')
  }

  lines.push('## Context Packet Control')
  lines.push('')
  lines.push('The minimal Guildhall baseline produced compact packets from fixture summaries only. This is not a final implementation, but it proves the evaluation should judge compact context assembly rather than raw history loading.')
  lines.push('')
  for (const packet of report.contextPackets.slice(0, 6)) {
    lines.push(`- ${packet.sections[0].replace(/^#\s+/, '')}: ${formatBytes(packet.bytes)} with ${packet.provenance.length} provenance refs.`)
  }

  lines.push('')
  lines.push('## Source Notes')
  lines.push('')
  lines.push('- LangGraph docs describe short-term memory trimming, deletion, summarization, checkpoints, long-term stores, and semantic search hooks.')
  lines.push('- Mastra docs describe Observational Memory, thread/resource scopes, observation/reflection compaction, recall over source ranges, semantic search, and memory processors.')
  lines.push('- Letta docs describe core memory, recall memory, archival memory, and automatic recursive summarization when context fills.')
  lines.push('- Graphiti was explored separately and retired because its local prototype did not produce enough Guildhall product value to justify keeping it as a roadmap path.')
  lines.push('- Mem0 docs describe open-source memory add/search/get/list/update/delete style operations and inferred versus raw memory ingestion.')
  lines.push('- LlamaIndex docs describe token-budgeted FIFO memory, flush size, memory blocks, and context insertion.')
  lines.push('')
  lines.push('## Source Links')
  lines.push('')
  for (const source of unique(report.candidates.flatMap(candidate => candidate.sourceRefs))) {
    lines.push(`- ${source}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function findingSummary(analysis = {}) {
  if (analysis.kind === 'task-queue') {
    const heavy = (analysis.topFieldBytes ?? []).slice(0, 3).map(item => `${item.field} ${formatBytes(item.bytes)}`).join(', ')
    const forbidden = Object.entries(analysis.forbiddenFieldCounts ?? {}).filter(([, count]) => count > 0).length
    return `${analysis.taskCount} tasks; heavy fields ${heavy}; forbidden field kinds present ${forbidden}`
  }
  if (analysis.kind === 'progress-log') {
    return `${analysis.blocks} progress blocks; ${analysis.counts?.heartbeat ?? 0} heartbeats, ${analysis.counts?.escalation ?? 0} escalations`
  }
  if (analysis.kind === 'generated-map') {
    return `${analysis.lines} lines; ${analysis.fileLikeEntries} file-like entries${analysis.duplicateDraftRisk ? '; draft duplication risk' : ''}`
  }
  if (analysis.kind === 'structural-map') {
    return `structural map keys: ${(analysis.topKeys ?? []).join(', ')}${analysis.duplicateDraftRisk ? '; draft duplication risk' : ''}`
  }
  return analysis.kind ?? 'unknown'
}

function unique(values) {
  return [...new Set(values)]
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

async function main() {
  const args = process.argv.slice(2)
  const outFlag = args.indexOf('--out')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.resolve(repoRoot, outFlag >= 0 ? args[outFlag + 1] : `artifacts/memory-context-eval/${timestamp}/candidate-report.json`)
  const mdPath = outPath.replace(/\.json$/i, '.md')
  const fixtures = await auditFixtures()
  const report = buildReport(fixtures)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8')
  console.log(`memory-context-eval: wrote ${path.relative(repoRoot, outPath)}`)
  console.log(`memory-context-eval: wrote ${path.relative(repoRoot, mdPath)}`)
  console.log(report.recommendation.summary)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
