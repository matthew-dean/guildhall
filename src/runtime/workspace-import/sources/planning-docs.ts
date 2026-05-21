import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, basename, isAbsolute, relative } from 'node:path'
import type { TaskSource, WorkspaceSignal, TaskSourceContext } from '../types.js'

type Exec = NonNullable<TaskSourceContext['exec']>

const IGNORE_PATH_RE =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.nuxt|memory)(\/|$)/

const MARKDOWN_FILE_RE = /\.md$/i

const DONE_HEADING_RE =
  /^(done|shipped|complete|completed|recent progress|milestone snapshot|verification snapshot)$/i

const OPEN_HEADING_RE =
  /^(next up|in progress|blockers?(?:\s*\/\s*open questions)?|parity gaps|v1 polish(?:\s*\+\s*hardening)?|v2 priorities|later|current focus|p0|p1|p2|open defects|next in phase 1)$/i

function likelyRelevantFile(rel: string): boolean {
  return MARKDOWN_FILE_RE.test(rel) && !IGNORE_PATH_RE.test(rel)
}

function listMarkdownFiles(projectPath: string): string[] {
  const out: string[] = []
  const walk = (relDir: string) => {
    const absDir = join(projectPath, relDir)
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (IGNORE_PATH_RE.test(rel)) continue
      if (entry.isDirectory()) {
        walk(rel)
      } else if (entry.isFile() && likelyRelevantFile(rel)) {
        out.push(rel)
      }
    }
  }
  walk('')
  return out.sort((a, b) => a.localeCompare(b))
}

function inferDomainHint(rel: string, enabledRoots: ReadonlySet<string>): string | undefined {
  const first = rel.split('/').find(Boolean)?.toLowerCase()
  if (!first) return undefined
  return enabledRoots.has(first) ? first : undefined
}

function detectMultiProjectRoots(relPaths: readonly string[]): Set<string> {
  const roots = new Set<string>()
  for (const rel of relPaths) {
    const parts = rel.split('/').filter(Boolean)
    if (parts.length < 2) continue
    const [first, second] = parts
    if (!first || !second) continue
    const lowerSecond = second.toLowerCase()
    if (
      lowerSecond === 'project_state.md' ||
      lowerSecond === 'docs' ||
      lowerSecond === 'specs'
    ) {
      roots.add(first.toLowerCase())
    }
  }
  return roots.size > 1 ? roots : new Set<string>()
}

function cleanHeading(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .replace(/[✅❌⚠️🔄📋🚧🏁💓🆘]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanSpecTitle(text: string): string {
  return cleanHeading(text).replace(/^spec:\s*/i, '').trim()
}

function summarizeMarkdownAfterTitle(raw: string): string {
  const withoutTitle = raw.replace(/^#\s+.+?\s*$/m, '').trim()
  const lines: string[] = []
  for (const line of withoutTitle.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (lines.length > 0) break
      continue
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      if (lines.length > 0) break
      continue
    }
    lines.push(trimmed.replace(/^[-*]\s+/, ''))
    if (lines.join(' ').length >= 220) break
  }
  return cleanHeading(lines.join(' ')).slice(0, 240).trim()
}

function fileLooksLikeTaskList(fileBase: string, rel: string): boolean {
  if (/^PROJECT_STATE\.md$/i.test(fileBase)) return true
  if (/\/specs\/[^/]+\.md$/i.test(rel)) return false
  return /(roadmap|plan|milestone|inventory|bugs|todo)/i.test(fileBase)
}

function isProjectStateCurrentFocus(fileBase: string, sectionHeading: string | null): boolean {
  return /^PROJECT_STATE\.md$/i.test(fileBase) && /^current focus$/i.test(sectionHeading ?? '')
}

function groupingChildrenAreTaskCandidates(title: string): boolean {
  const normalized = title.toLowerCase().replace(/:$/, '').trim()
  return (
    /^add missing\b/.test(normalized) ||
    /^missing\b/.test(normalized) ||
    /\bmissing high-frequency\b/.test(normalized) ||
    /^deepen\b.*\bhigh-frequency\b/.test(normalized) ||
    /^close\b.*\beditor parity gaps\b/.test(normalized)
  )
}

function headingSignalKind(
  fileBase: string,
  rel: string,
  heading: string,
  sectionHeading: string | null,
): WorkspaceSignal['kind'] | null {
  if (/\/specs\/[^/]+\.md$/i.test(rel)) return 'context'
  if (/README\.md$/i.test(fileBase) && /^(goals?|features|what it does)$/i.test(heading)) return 'goal'
  if (/^PROJECT_STATE\.md$/i.test(fileBase)) {
    if (sectionHeading && DONE_HEADING_RE.test(sectionHeading)) return 'milestone'
    if (sectionHeading && OPEN_HEADING_RE.test(sectionHeading)) return 'open_work'
    return null
  }
  if (sectionHeading && DONE_HEADING_RE.test(sectionHeading)) return 'milestone'
  if (sectionHeading && OPEN_HEADING_RE.test(sectionHeading)) return 'open_work'
  return null
}

export const planningDocsSource: TaskSource = {
  id: 'planning-docs',
  label: 'Nested planning docs and specs',

  async detect({ projectPath, exec }) {
    const run: Exec = exec ?? (await import('./exec-default.js')).execDefault
    const listed = await run('rg', ['--files', projectPath], {
      cwd: projectPath,
      timeoutMs: 15_000,
    }).catch(() => ({ stdout: '', stderr: '', code: 127 }))
    const relPaths = listed.code === 0 || listed.code === 1
      ? listed.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((entry) => (isAbsolute(entry) ? relative(projectPath, entry) : entry))
          .filter((rel) => likelyRelevantFile(rel))
      : listMarkdownFiles(projectPath)
    const multiProjectRoots = detectMultiProjectRoots(relPaths)

    const signals: WorkspaceSignal[] = []
    for (const rel of relPaths) {
      const abs = join(projectPath, rel)
      if (!existsSync(abs)) continue
      const raw = readFileSync(abs, 'utf-8')
      if (!raw.trim()) continue
      const fileBase = basename(rel)
      const domainHint = inferDomainHint(rel, multiProjectRoots)
      let currentSection: string | null = null
      const bulletStack: Array<{ indent: number; title: string; grouping: boolean }> = []

      // Treat spec files as framing even if they have no checklists.
      if (/\/specs\/[^/]+\.md$/i.test(rel)) {
        const h1 = /^#\s+(.+?)\s*$/m.exec(raw)
        if (h1) {
          const specTitle = cleanSpecTitle(h1[1]!)
          if (!specTitle || /^\[feature name\]$/i.test(specTitle)) continue
          signals.push({
            source: 'planning-docs',
            kind: 'context',
            title: `Spec: ${specTitle}`,
            evidence: summarizeMarkdownAfterTitle(raw) || rel,
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
        }
      }

      for (const line of raw.split('\n')) {
        const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
        if (heading) {
          currentSection = cleanHeading(heading[2]!)
          bulletStack.length = 0
          const kind = headingSignalKind(fileBase, rel, currentSection, currentSection)
          if (kind && !DONE_HEADING_RE.test(currentSection) && !OPEN_HEADING_RE.test(currentSection)) {
            signals.push({
              source: 'planning-docs',
              kind,
              title: currentSection.slice(0, 120),
              evidence: line.trim().slice(0, 240),
              references: [abs],
              ...(domainHint ? { domainHint } : {}),
              confidence: kind === 'context' ? 'medium' : 'medium',
            })
          }
          continue
        }

        const checked = /^\s*[-*]\s*\[[xX]\]\s+(.+?)\s*$/.exec(line)
        if (
          checked &&
          (fileLooksLikeTaskList(fileBase, rel) || (currentSection && DONE_HEADING_RE.test(currentSection)))
        ) {
          bulletStack.length = 0
          signals.push({
            source: 'planning-docs',
            kind: 'milestone',
            title: cleanHeading(checked[1]!).slice(0, 120),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'high',
          })
          continue
        }

        const unchecked = /^\s*[-*]\s*\[\s?\]\s+(.+?)\s*$/.exec(line)
        if (
          unchecked &&
          (fileLooksLikeTaskList(fileBase, rel) || (currentSection && OPEN_HEADING_RE.test(currentSection)))
        ) {
          bulletStack.length = 0
          signals.push({
            source: 'planning-docs',
            kind: 'open_work',
            title: cleanHeading(unchecked[1]!).slice(0, 120),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'high',
          })
          continue
        }

        const bullet = /^(\s*)[-*]\s+(.+?)\s*$/.exec(line)
        if (bullet && currentSection && OPEN_HEADING_RE.test(currentSection)) {
          const indent = bullet[1]!.replace(/\t/g, '  ').length
          const title = cleanHeading(bullet[2]!).slice(0, 120)
          while (bulletStack.length > 0 && bulletStack[bulletStack.length - 1]!.indent >= indent) {
            bulletStack.pop()
          }
          const parent = bulletStack[bulletStack.length - 1]
          const grouping = title.endsWith(':')
          const groupingChildrenAreTasks = grouping && groupingChildrenAreTaskCandidates(title)
          if (grouping && !groupingChildrenAreTasks) {
            signals.push({
              source: 'planning-docs',
              kind: isProjectStateCurrentFocus(fileBase, currentSection) ? 'context' : 'open_work',
              title: title.replace(/:$/, ''),
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          } else if (!grouping) {
            const kind: WorkspaceSignal['kind'] =
              isProjectStateCurrentFocus(fileBase, currentSection) ||
              (parent && indent > parent.indent && !parent.grouping)
                ? 'context'
                : 'open_work'
            signals.push({
              source: 'planning-docs',
              kind,
              title,
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          }
          bulletStack.push({ indent, title, grouping: groupingChildrenAreTasks })
          continue
        }

        const numbered = /^\s*\d+\.\s+(.+?)\s*$/.exec(line)
        if (numbered && currentSection && OPEN_HEADING_RE.test(currentSection)) {
          const kind: WorkspaceSignal['kind'] = isProjectStateCurrentFocus(fileBase, currentSection)
            ? 'context'
            : 'open_work'
          signals.push({
            source: 'planning-docs',
            kind,
            title: cleanHeading(numbered[1]!).slice(0, 120),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
        }
      }
    }

    return signals
  },
}
