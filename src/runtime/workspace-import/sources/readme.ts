import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskSource, WorkspaceSignal } from '../types.js'

const README_NAMES = ['README.md', 'README', 'Readme.md', 'readme.md'] as const

function findReadme(projectPath: string): string | undefined {
  for (const name of README_NAMES) {
    const p = join(projectPath, name)
    if (existsSync(p)) return p
  }
  return undefined
}

/**
 * Reads the first README candidate and extracts:
 * - a `goal` signal from the first H1 + the following lead paragraph, and
 * - a `goal` signal for each first-level bullet under a "Goals" / "What it
 *   does" / "Features" section (if present).
 *
 * The readme is already the authoritative single-source-of-truth for "what
 * this project is" in most repos — so we give its signals `confidence: 'high'`.
 */
export const readmeSource: TaskSource = {
  id: 'readme',
  label: 'README',

  async detect({ projectPath }) {
    const path = findReadme(projectPath)
    if (!path) return []

    const raw = readFileSync(path, 'utf-8')
    const signals: WorkspaceSignal[] = []

    const h1 = /^#\s+(.+?)\s*$/m.exec(raw)
    if (h1) {
      const title = h1[1]!.trim()
      const afterH1 = raw.slice(h1.index + h1[0].length)
      const lead = afterH1
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .find((s) => s.length > 0 && !s.startsWith('#') && !s.startsWith('!['))
      signals.push({
        source: 'readme',
        kind: 'goal',
        title,
        evidence: (lead ?? '').slice(0, 240),
        references: [path],
        confidence: 'high',
      })
    }

    const goalsBlock = extractSection(raw, /^#{1,3}\s+(goals?|what it does|features)\b/im)
    if (goalsBlock) {
      const bullets = extractTopLevelBullets(goalsBlock)
      for (const bullet of bullets) {
        signals.push({
          source: 'readme',
          kind: 'goal',
          title: bullet.slice(0, 120),
          evidence: bullet.slice(0, 240),
          references: [path],
          confidence: 'medium',
        })
      }
    }

    return signals
  },
}

function extractSection(md: string, headingRe: RegExp): string | undefined {
  const m = headingRe.exec(md)
  if (!m) return undefined
  const start = m.index + m[0].length
  const rest = md.slice(start)
  const nextHeading = /^#{1,6}\s+/m.exec(rest)
  return nextHeading ? rest.slice(0, nextHeading.index) : rest
}

function extractTopLevelBullets(block: string): string[] {
  const lines = block.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const m = /^[-*]\s+(.+?)\s*$/.exec(line)
    if (m) out.push(m[1]!)
  }
  return out
}
