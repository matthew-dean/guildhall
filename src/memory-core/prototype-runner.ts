import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { createDeterministicGuildhallMemory } from './deterministic.js'
import { ingestProjectStateForMemoryPrototype } from './project-state-ingest.js'

export interface MemoryCorePrototypeOptions {
  projectRoots?: readonly string[]
  outputDir?: string
}

export interface MemoryCorePrototypeProjectReport {
  projectRoot: string
  projectLocalBytes: number
  memoryStoreBytes: number
  packetBytes: number
  eventsRecorded: number
  filesScanned: number
  largestFiles: Array<{ relativePath: string, bytes: number, action: string, summary: string }>
  includedSummaries: string[]
  omittedCount: number
}

export interface MemoryCorePrototypeReport {
  generatedAt: string
  storageRoot: string
  projects: MemoryCorePrototypeProjectReport[]
}

const DEFAULT_PROJECT_ROOTS = [
  '/Users/matthew/git/oss/fair-labor-license',
  '/Users/matthew/git/oss/looma-knit',
  '/Users/matthew/git/oss/jess',
  '/Users/matthew/git/oss/narrative-harness',
]

export async function runMemoryCorePrototype(
  options: MemoryCorePrototypeOptions = {},
): Promise<MemoryCorePrototypeReport> {
  const outputDir = options.outputDir ?? path.resolve('artifacts', 'memory-core-prototype')
  const storageRoot = path.join(outputDir, 'storage')
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const projectReports: MemoryCorePrototypeProjectReport[] = []
  for (const projectRoot of options.projectRoots ?? DEFAULT_PROJECT_ROOTS) {
    if (!existsSync(path.join(projectRoot, '.guildhall'))) continue
    const memory = createDeterministicGuildhallMemory({ projectRoot, storageRoot })
    const ingest = await ingestProjectStateForMemoryPrototype({ projectRoot, memory })
    const compaction = await memory.compact({
      scope: { kind: 'project', projectRoot },
      reason: 'prototype-after-project-state-ingest',
      maxObservationBytes: 2_400,
    })
    const packet = await memory.buildCandidatePacket({
      scope: { kind: 'project', projectRoot },
      intent: 'Identify memory and project-state bloat, preserve decisions, and prepare a next worker context.',
      maxBytes: 3_500,
    })
    projectReports.push({
      projectRoot,
      projectLocalBytes: ingest.projectLocalBytes,
      memoryStoreBytes: compaction.bytesAfter,
      packetBytes: packet.byteEstimate,
      eventsRecorded: ingest.eventsRecorded,
      filesScanned: ingest.files.length,
      largestFiles: ingest.files.slice(0, 8).map((file) => ({
        relativePath: file.relativePath,
        bytes: file.bytes,
        action: file.action,
        summary: file.summary,
      })),
      includedSummaries: packet.included.map((item) => item.summary),
      omittedCount: packet.omitted.length,
    })
  }

  const report: MemoryCorePrototypeReport = {
    generatedAt: new Date().toISOString(),
    storageRoot,
    projects: projectReports,
  }
  await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(outputDir, 'report.md'), renderReport(report), 'utf8')
  return report
}

function renderReport(report: MemoryCorePrototypeReport): string {
  const lines = [
    '# Memory Core Prototype Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Storage root: ${report.storageRoot}`,
    '',
  ]
  for (const project of report.projects) {
    lines.push(`## ${project.projectRoot}`)
    lines.push('')
    lines.push(`- project-local bytes scanned: ${project.projectLocalBytes}`)
    lines.push(`- memory-store bytes after compaction: ${project.memoryStoreBytes}`)
    lines.push(`- candidate packet bytes: ${project.packetBytes}`)
    lines.push(`- events recorded: ${project.eventsRecorded}`)
    lines.push(`- files scanned: ${project.filesScanned}`)
    lines.push('')
    lines.push('Largest project-state files:')
    for (const file of project.largestFiles) {
      lines.push(`- ${file.relativePath}: ${file.bytes} bytes; ${file.action}; ${file.summary}`)
    }
    lines.push('')
    lines.push('Included packet summaries:')
    for (const summary of project.includedSummaries) lines.push(`- ${summary}`)
    lines.push(`- omitted candidates: ${project.omittedCount}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runMemoryCorePrototype()
  console.log(JSON.stringify({
    projects: report.projects.length,
    storageRoot: report.storageRoot,
    report: path.resolve('artifacts', 'memory-core-prototype', 'report.md'),
  }, null, 2))
}
