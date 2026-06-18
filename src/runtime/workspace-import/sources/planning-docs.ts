import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path, { join, basename, isAbsolute, relative } from 'node:path'
import type { TaskSource, WorkspaceSignal, TaskSourceContext } from '../types.js'

type Exec = NonNullable<TaskSourceContext['exec']>

const IGNORE_PATH_RE =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.nuxt|memory)(\/|$)/

const MARKDOWN_FILE_RE = /\.md$/i

const DONE_HEADING_RE =
  /^(done|shipped|complete|completed|recent progress|milestone snapshot|verification snapshot)$/i

const OPEN_HEADING_RE =
  /^(next up|in progress|blockers?(?:\s*\/\s*open questions)?|parity gaps|v1 polish(?:\s*\+\s*hardening)?|v2 priorities|later|current focus|p0|p1|p2|open defects|next in phase 1|current next milestone)$/i

const STAGE_HEADING_RE = /^stage\s+\d+\s*:/i
const DELIVERABLE_LABEL_RE = /^deliverables:\s*$/i
const SUCCESS_GATES_LABEL_RE = /^success gates:\s*$/i
const DO_NOT_START_LABEL_RE = /^do not start yet:\s*$/i
const GOAL_LABEL_RE = /^goal:\s*(.+?)\s*$/i
const RECOMMENDED_TASK_TITLE_RE = /^-\s+\*\*recommended first task title:\*\*\s+(.+?)\s*$/i
const RECOMMENDED_DOMAIN_RE = /^-\s+\*\*recommended domain:\*\*\s+(.+?)\s*$/i
const CORE_LOOP_HEADING_RE = /^core loop$/i
const MARKDOWN_TABLE_ROW_RE = /^\|.+\|\s*$/

function coreLoopRole(title: string): WorkspaceSignal['role'] {
  const normalized = cleanHeading(title).toLowerCase()
  if (
    /^author defines\b/.test(normalized) ||
    /^author builds a house\b/.test(normalized) ||
    (/\bauthor\b/.test(normalized) &&
      /\b(intent|genre|form|theme|themes|voice|audience|premise|world|cast|outline|chapter goals|review standards)\b/.test(normalized))
  ) {
    return 'brief_input'
  }
  return 'capability'
}

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

function markdownFilenameFromHeading(text: string | null): string | null {
  if (!text) return null
  const codeMatch = text.match(/`([^`]+\.md)`/i)
  if (codeMatch?.[1]) return codeMatch[1]
  const plainMatch = text.match(/([a-z0-9][a-z0-9-]*\.md)\b/i)
  return plainMatch?.[1] ?? null
}

function relatedSpecReference(
  projectPath: string,
  sourceRel: string,
  headingRaw: string | null,
  availableFiles: ReadonlySet<string>,
): string | null {
  const fileName = markdownFilenameFromHeading(headingRaw)
  if (!fileName) return null
  const normalized = fileName.replaceAll('\\', '/')
  const preferredCandidates = [
    `docs/specs/${normalized}`,
    `specs/${normalized}`,
    path.join(path.dirname(sourceRel), normalized).replaceAll('\\', '/'),
  ]
  for (const candidate of preferredCandidates) {
    if (availableFiles.has(candidate)) {
      return join(projectPath, candidate)
    }
  }
  const basenameMatches = [...availableFiles]
    .filter(candidate => path.basename(candidate) === normalized)
    .sort((left, right) => {
      const leftScore = Number(left.includes('/specs/'))
      const rightScore = Number(right.includes('/specs/'))
      return rightScore - leftScore || left.localeCompare(right)
    })
  return basenameMatches[0] ? join(projectPath, basenameMatches[0]) : null
}

function logicalMarkdownLines(raw: string): string[] {
  const physicalLines = raw.split('\n')
  const logicalLines: string[] = []

  for (let index = 0; index < physicalLines.length; index += 1) {
    let line = physicalLines[index] ?? ''
    if (startsWrappedLabel(line)) {
      while (index + 1 < physicalLines.length && isWrappedLabelContinuationLine(physicalLines[index + 1] ?? '')) {
        line = `${line.trimEnd()} ${(physicalLines[index + 1] ?? '').trim()}`
        index += 1
      }
      logicalLines.push(line)
      continue
    }
    if (!startsListItem(line)) {
      logicalLines.push(line)
      continue
    }
    while (index + 1 < physicalLines.length && isListContinuationLine(physicalLines[index + 1] ?? '')) {
      line = `${line.trimEnd()} ${(physicalLines[index + 1] ?? '').trim()}`
      index += 1
    }
    logicalLines.push(line)
  }

  return logicalLines
}

function startsListItem(line: string): boolean {
  return /^\s*(?:[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(line)
}

function startsWrappedLabel(line: string): boolean {
  return /^\s*(?:goal|status|the next milestone is):\s+\S/i.test(line)
}

function isWrappedLabelContinuationLine(line: string): boolean {
  if (!line.trim()) return false
  const trimmed = line.trim()
  return !/^(?:#{1,6}\s+|[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+|goal:\s+|status:\s+|deliverables:\s*$|success gates:\s*$|do not start yet:\s*$|the next milestone is:\s+)/i.test(trimmed)
}

function isListContinuationLine(line: string): boolean {
  if (!/^\s{2,}\S/.test(line)) return false
  const trimmed = line.trim()
  return !/^(?:#{1,6}\s+|\|(?:.+)\||[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(trimmed)
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

function humanizeSpecStem(fileName: string): string {
  return fileName
    .replace(/\.md$/i, '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function splitMarkdownTableRow(line: string): string[] | null {
  if (!MARKDOWN_TABLE_ROW_RE.test(line.trim())) return null
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = trimmed.split('|').map(cell => cleanHeading(cell.trim()))
  return cells.length > 0 ? cells : null
}

function parseLinkedTaskHints(cell: string): string[] {
  const normalized = cleanHeading(cell)
  if (!normalized || /^\*?\(?none\b/i.test(normalized) || normalized === '—') return []
  const codeMatches = [...cell.matchAll(/`([^`]+)`/g)].map(match => cleanHeading(match[1] ?? ''))
  const raw = codeMatches.length > 0 ? codeMatches : normalized.split(/,\s*/)
  return raw
    .map(entry => cleanHeading(entry))
    .filter(entry => entry.length > 0 && entry !== '—')
}

function specCoverageSignalsForFile(input: {
  projectPath: string
  sourceRel: string
  sourceAbs: string
  raw: string
  availableFiles: ReadonlySet<string>
  domainHint?: string
}): WorkspaceSignal[] {
  const signals: WorkspaceSignal[] = []
  const seen = new Set<string>()
  for (const line of input.raw.split('\n')) {
    const cells = splitMarkdownTableRow(line)
    if (!cells || cells.length < 2) continue
    const specFile = markdownFilenameFromHeading(cells[0] ?? '')
    if (!specFile || /^index\.md$/i.test(specFile)) continue
    const linkedTaskHints = parseLinkedTaskHints(cells[1] ?? '')
    if (linkedTaskHints.length === 0) continue
    const specRef = relatedSpecReference(
      input.projectPath,
      input.sourceRel,
      `\`${specFile}\``,
      input.availableFiles,
    )
    if (!specRef) continue
    const dedupeKey = `${specRef}::${linkedTaskHints.join('::')}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    signals.push({
      source: 'planning-docs',
      kind: 'context',
      title: `Spec coverage: ${humanizeSpecStem(specFile)}`,
      evidence: `${input.sourceRel}: ${cleanHeading(cells[1] ?? '')}`.slice(0, 240),
      references: [specRef, input.sourceAbs],
      role: 'reference',
      linkedTaskHints,
      ...(input.domainHint ? { domainHint: input.domainHint } : {}),
      confidence: 'medium',
    })
  }
  return signals
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

function parseStageOrdinal(label: string | null | undefined): number | null {
  if (!label) return null
  const match = /^stage\s+(\d+)(?:\s*[:(].*)?$/i.exec(label.trim())
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

function scopeHintForStage(
  stageLabel: string | null | undefined,
  currentMilestoneStage: string | null | undefined,
): WorkspaceSignal['scopeHint'] {
  const stageNumber = parseStageOrdinal(stageLabel)
  const currentStageNumber = parseStageOrdinal(currentMilestoneStage)
  if (stageNumber != null && currentStageNumber != null) {
    if (stageNumber > currentStageNumber) {
      return 'later'
    }
    return 'current'
  }
  return 'current'
}

function stageDeliverableSignal(
  currentSection: string,
  currentMilestoneStage: string | null,
): { kind: WorkspaceSignal['kind']; scopeHint?: WorkspaceSignal['scopeHint']; role?: WorkspaceSignal['role'] } {
  return {
    kind: 'context',
    role: 'capability',
    scopeHint: scopeHintForStage(currentSection, currentMilestoneStage),
  }
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
    const availableFiles = new Set(relPaths)

    const fileContents = new Map<string, string>()
    for (const rel of relPaths) {
      const abs = join(projectPath, rel)
      if (!existsSync(abs)) continue
      const raw = readFileSync(abs, 'utf-8')
      if (!raw.trim()) continue
      fileContents.set(rel, raw)
    }
    const currentMilestoneStage = detectCurrentMilestoneStage(fileContents.values())

    const signals: WorkspaceSignal[] = []
    for (const rel of relPaths) {
      const abs = join(projectPath, rel)
      const raw = fileContents.get(rel)
      if (!raw) continue
      if (!raw.trim()) continue
      const fileBase = basename(rel)
      const domainHint = inferDomainHint(rel, multiProjectRoots)
      let currentSection: string | null = null
      let currentSectionRaw: string | null = null
      let currentLabel: 'deliverables' | 'success_gates' | 'do_not_start' | null = null
      let pendingRecommendedTaskTitle: string | null = null
      let pendingRecommendedTaskSection: string | null = null
      let pendingRecommendedTaskSectionRaw: string | null = null
      let currentRecommendedStageAlignment: string | null = null
      let currentRecommendedDomain: string | null = null
      const bulletStack: Array<{ indent: number; title: string; grouping: boolean }> = []

      const flushPendingRecommendedTask = () => {
        if (!pendingRecommendedTaskTitle) return
        const title = pendingRecommendedTaskTitle
        if (!/^\(?none\b/i.test(title)) {
          const references = [abs]
          const relatedSpec = relatedSpecReference(
            projectPath,
            rel,
            pendingRecommendedTaskSectionRaw,
            availableFiles,
          )
          if (relatedSpec && !references.includes(relatedSpec)) {
            references.push(relatedSpec)
          }
          signals.push({
            source: 'planning-docs',
            kind: 'open_work',
            title,
            evidence: `${rel}: ${pendingRecommendedTaskSection ?? currentSection ?? title}`.slice(0, 240),
            references,
            ...(currentRecommendedDomain ? { domainHint: currentRecommendedDomain } : domainHint ? { domainHint } : {}),
            scopeHint: scopeHintForStage(currentRecommendedStageAlignment, currentMilestoneStage),
            confidence: 'high',
          })
        }
        pendingRecommendedTaskTitle = null
        pendingRecommendedTaskSection = null
        currentRecommendedStageAlignment = null
        currentRecommendedDomain = null
      }

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
            role: 'capability',
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
        }
      }
      signals.push(...specCoverageSignalsForFile({
        projectPath,
        sourceRel: rel,
        sourceAbs: abs,
        raw,
        availableFiles,
        ...(domainHint ? { domainHint } : {}),
      }))

      for (const line of logicalMarkdownLines(raw)) {
        const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
        if (heading) {
          flushPendingRecommendedTask()
          currentSection = cleanHeading(heading[2]!)
          currentSectionRaw = heading[2]!.trim()
          currentLabel = null
          bulletStack.length = 0
          const kind = headingSignalKind(fileBase, rel, currentSection, currentSection)
          if (kind && !DONE_HEADING_RE.test(currentSection) && !OPEN_HEADING_RE.test(currentSection)) {
            signals.push({
              source: 'planning-docs',
              kind,
              title: currentSection,
              evidence: line.trim().slice(0, 240),
              references: [abs],
              ...(domainHint ? { domainHint } : {}),
              confidence: kind === 'context' ? 'medium' : 'medium',
            })
          }
          if (STAGE_HEADING_RE.test(currentSection)) {
            signals.push({
              source: 'planning-docs',
              kind: 'context',
              title: currentSection,
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          }
          continue
        }

        const goalLabel = GOAL_LABEL_RE.exec(line.trim())
        if (goalLabel && currentSection && STAGE_HEADING_RE.test(currentSection)) {
          signals.push({
            source: 'planning-docs',
            kind: 'goal',
            title: cleanHeading(goalLabel[1]!),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
          continue
        }

        const trimmedLine = line.trim()
        if (currentSection && STAGE_HEADING_RE.test(currentSection)) {
          if (DELIVERABLE_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'deliverables'
            bulletStack.length = 0
            continue
          }
          if (SUCCESS_GATES_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'success_gates'
            bulletStack.length = 0
            continue
          }
          if (DO_NOT_START_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'do_not_start'
            bulletStack.length = 0
            continue
          }
        }

        const stageAlignment = /^-\s+\*\*stage alignment:\*\*\s+(.+?)\s*$/i.exec(trimmedLine)
        if (stageAlignment) {
          currentRecommendedStageAlignment = cleanHeading(stageAlignment[1]!)
          continue
        }

        const recommendedDomain = RECOMMENDED_DOMAIN_RE.exec(trimmedLine)
        if (recommendedDomain) {
          currentRecommendedDomain = cleanHeading(recommendedDomain[1]!)
          continue
        }

        const recommendedTask = RECOMMENDED_TASK_TITLE_RE.exec(trimmedLine)
        if (recommendedTask && currentSection) {
          pendingRecommendedTaskTitle = cleanHeading(recommendedTask[1]!)
          pendingRecommendedTaskSection = currentSection
          pendingRecommendedTaskSectionRaw = currentSectionRaw
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
            title: cleanHeading(checked[1]!),
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
            title: cleanHeading(unchecked[1]!),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'high',
          })
          continue
        }

        const bullet = /^(\s*)[-*]\s+(.+?)\s*$/.exec(line)
        if (bullet && currentSection && (OPEN_HEADING_RE.test(currentSection) || STAGE_HEADING_RE.test(currentSection))) {
          const indent = bullet[1]!.replace(/\t/g, '  ').length
          const title = cleanHeading(bullet[2]!)
          const stageScopedSignal = currentLabel === 'deliverables'
            ? stageDeliverableSignal(currentSection, currentMilestoneStage)
            : currentLabel === 'success_gates'
              ? { kind: 'context' as const }
              : currentLabel === 'do_not_start'
              ? { kind: 'context' as const }
                : null
          while (bulletStack.length > 0 && bulletStack[bulletStack.length - 1]!.indent >= indent) {
            bulletStack.pop()
          }
          const parent = bulletStack[bulletStack.length - 1]
          const grouping = title.endsWith(':')
          const groupingChildrenAreTasks = grouping && groupingChildrenAreTaskCandidates(title)
          if (grouping && !groupingChildrenAreTasks) {
            signals.push({
              source: 'planning-docs',
              kind:
                isProjectStateCurrentFocus(fileBase, currentSection)
                  ? 'context'
                  : 'open_work',
              title: title.replace(/:$/, ''),
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          } else if (!grouping) {
            if (currentLabel === 'deliverables') {
              signals.push({
                source: 'planning-docs',
                kind: 'context',
                role: 'capability',
                title,
                evidence: `${rel}: ${line.trim()}`.slice(0, 240),
                references: [abs],
                ...(stageScopedSignal?.scopeHint ? { scopeHint: stageScopedSignal.scopeHint } : {}),
                ...(domainHint ? { domainHint } : {}),
                confidence: 'medium',
              })
              bulletStack.push({ indent, title, grouping: groupingChildrenAreTasks })
              continue
            }
            const kind: WorkspaceSignal['kind'] = stageScopedSignal?.kind ?? (
              isProjectStateCurrentFocus(fileBase, currentSection) ||
              (parent && indent > parent.indent && !parent.grouping)
                ? 'context'
                : 'open_work'
            )
            signals.push({
              source: 'planning-docs',
              kind,
              title,
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(stageScopedSignal?.role ? { role: stageScopedSignal.role } : {}),
              ...(stageScopedSignal?.scopeHint ? { scopeHint: stageScopedSignal.scopeHint } : {}),
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          }
          bulletStack.push({ indent, title, grouping: groupingChildrenAreTasks })
          continue
        }

        const numbered = /^\s*\d+\.\s+(.+?)\s*$/.exec(line)
        if (numbered && currentSection && CORE_LOOP_HEADING_RE.test(currentSection)) {
          signals.push({
            source: 'planning-docs',
            kind: 'context',
            title: cleanHeading(numbered[1]!),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            role: coreLoopRole(numbered[1]!),
            ...(domainHint ? { domainHint } : {}),
            confidence: 'high',
          })
          continue
        }
        if (numbered && currentSection && (OPEN_HEADING_RE.test(currentSection) || /^current next milestone$/i.test(currentSection))) {
          const kind: WorkspaceSignal['kind'] = isProjectStateCurrentFocus(fileBase, currentSection)
            ? 'context'
            : 'open_work'
          signals.push({
            source: 'planning-docs',
            kind,
            title: cleanHeading(numbered[1]!),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
        }
      }

      flushPendingRecommendedTask()
    }

    return signals
  },
}

function detectCurrentMilestoneStage(contents: Iterable<string>): string | null {
  for (const raw of contents) {
    const match = raw.match(/##\s+Current Next Milestone[\s\S]*?The next milestone is\s+(Stage\s+\d+)/i)
    if (match?.[1]) {
      return normalizeStageLabel(match[1])
    }
  }
  return null
}

function normalizeStageLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
