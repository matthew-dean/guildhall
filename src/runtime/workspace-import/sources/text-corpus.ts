import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import type { TaskSource, WorkspaceSignal } from '../types.js'

const TEXT_EXTENSIONS = new Set([
  '.adoc',
  '.asc',
  '.markdown',
  '.md',
  '.mdown',
  '.mkd',
  '.rst',
  '.text',
  '.txt',
])

const SKIP_DIRS = new Set([
  '.git',
  '.guildhall',
  '.nuxt',
  '.output',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 500

function listTextFiles(projectPath: string): string[] {
  const out: string[] = []
  const visit = (relDir: string) => {
    if (out.length >= MAX_FILES) return
    const absDir = join(projectPath, relDir)
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = readdirSync(absDir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }

    for (const entry of entries) {
      if (out.length >= MAX_FILES) break
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(rel)
    }
  }
  visit('')
  return out.sort((a, b) => a.localeCompare(b))
}

function cleanText(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .replace(/[✅❌⚠️🔄📋🚧🏁💓🆘]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function excerpt(raw: string, rel: string): string {
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (lines.length > 0) break
      continue
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      if (lines.length > 0) break
      continue
    }
    if (/^[-*]\s*$/.test(trimmed)) continue
    lines.push(trimmed.replace(/^[-*]\s+(?:\[[ xX]\]\s*)?/, ''))
    if (lines.join(' ').length >= 220) break
  }
  return cleanText(lines.join(' ')).slice(0, 240) || rel
}

function domainHint(rel: string): string | undefined {
  const first = rel.split('/').find(Boolean)
  if (!first || first === rel) return undefined
  return first
}

function fileTitle(raw: string, rel: string): string {
  const h1 = /^#\s+(.+?)\s*$/m.exec(raw)
  return h1 ? cleanText(h1[1]!) : rel
}

function isDoneSection(heading: string | null): boolean {
  return !!heading && /^(done|shipped|complete|completed|recent progress|milestones?)$/i.test(heading)
}

export const textCorpusSource: TaskSource = {
  id: 'text-corpus',
  label: 'Text corpus map',

  async detect({ projectPath }) {
    const signals: WorkspaceSignal[] = []
    for (const rel of listTextFiles(projectPath)) {
      const abs = join(projectPath, rel)
      let raw = ''
      try {
        if (statSync(abs).size > MAX_FILE_BYTES) continue
        raw = readFileSync(abs, 'utf-8')
      } catch {
        continue
      }
      if (!raw.trim()) continue

      const hint = domainHint(rel)
      signals.push({
        source: 'text-corpus',
        kind: 'context',
        title: `Text document (${rel}): ${fileTitle(raw, rel)}`,
        evidence: excerpt(raw, rel),
        references: [abs],
        ...(hint ? { domainHint: hint } : {}),
        confidence: 'medium',
      })

      let currentHeading: string | null = null
      for (const line of raw.split('\n')) {
        const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line)
        if (heading) {
          currentHeading = cleanText(heading[1]!)
          continue
        }
        const checklist = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)
        if (!checklist) continue

        const checked = checklist[1]!.toLowerCase() === 'x'
        if (checked || isDoneSection(currentHeading)) continue
        const title = cleanText(checklist[2]!)
        if (!title) continue
        signals.push({
          source: 'text-corpus',
          kind: 'open_work',
          title,
          evidence: `${rel}: ${line.trim()}`.slice(0, 240),
          references: [abs],
          ...(hint ? { domainHint: hint } : {}),
          confidence: 'medium',
        })
      }
    }
    return signals
  },
}
