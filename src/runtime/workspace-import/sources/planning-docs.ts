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
  /^(next up|in progress|blockers?(?:\s*\/\s*open questions)?|parity gaps|v1 polish(?:\s*\+\s*hardening)?|v2 priorities(?:\b.*)?|later(?:\b.*)?|current focus|p0|p1|p2|open defects|next in phase 1|current next milestone)$/i

const STAGE_HEADING_RE = /^stage\s+\d+\s*:/i
const DELIVERABLE_LABEL_RE = /^deliverables:\s*$/i
const SCOPE_LABEL_RE = /^(?:primary\s+)?scope:\s*$/i
const SUCCESS_GATES_LABEL_RE = /^success gates:\s*$/i
const DONE_GATE_LABEL_RE = /^done gate(?:\s+for\s+.+?)?:\s*$/i
const DO_NOT_START_LABEL_RE = /^do not start yet:\s*$/i
const GOAL_LABEL_RE = /^goal:\s*(.+?)\s*$/i
const RECOMMENDED_TASK_TITLE_RE = /^-\s+\*\*recommended first task title:\*\*\s+(.+?)\s*$/i
const RECOMMENDED_DOMAIN_RE = /^-\s+\*\*recommended domain:\*\*\s+(.+?)\s*$/i
const CORE_LOOP_HEADING_RE = /^core loop$/i
const SYSTEM_RECORDS_HEADING_RE = /^system records$/i
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

function recordRole(title: string): WorkspaceSignal['role'] {
  const normalized = cleanHeading(title).toLowerCase()
  if (
    /^(book brief|author voice profile|project author notes|global author database|author profile)$/.test(normalized)
  ) {
    return 'brief_input'
  }
  return 'capability'
}

function normalizeKey(text: string): string {
  return cleanHeading(text).toLowerCase()
}

function mergeCoreLoopStructuralContext(signals: WorkspaceSignal[]): WorkspaceSignal[] {
  const next: WorkspaceSignal[] = []
  const bookBriefRecordByRef = new Map<string, number>()

  for (const signal of signals) {
    if (
      signal.kind === 'context' &&
      signal.role === 'brief_input' &&
      signal.structure === 'record' &&
      normalizeKey(signal.title) === 'book brief'
    ) {
      const ref = signal.references?.[0]
      if (ref) bookBriefRecordByRef.set(ref, next.length)
    }
    next.push(signal)
  }

  return next.filter((signal) => {
    const ref = signal.references?.[0]
    if (
      signal.kind === 'context' &&
      signal.role === 'brief_input' &&
      !signal.structure &&
      /^author defines book intent\b/i.test(signal.title) &&
      ref &&
      bookBriefRecordByRef.has(ref)
    ) {
      const recordIndex = bookBriefRecordByRef.get(ref)!
      const record = next[recordIndex]
      if (record) {
        const supporting = cleanHeading(signal.title)
        if (supporting && !record.evidence.includes(supporting)) {
          record.evidence = `${record.evidence} Also described as: ${supporting}`.slice(0, 240)
        }
      }
      return false
    }
    return true
  })
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

function primaryDomainHint(relPaths: readonly string[], roots: ReadonlySet<string>): string | null {
  for (const rel of relPaths) {
    if (!/(^|\/)docs\/release-plan\.md$/i.test(rel) && !/(^|\/)PROJECT_STATE\.md$/i.test(rel)) continue
    const domain = inferDomainHint(rel, roots)
    if (domain) return domain
  }
  return null
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

function isDecompositionInventoryFile(rel: string): boolean {
  return /(^|\/)remaining-spec-decomposition-inventory\.md$/i.test(rel.replaceAll('\\', '/'))
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
    while (index + 1 < physicalLines.length) {
      const nextLine = physicalLines[index + 1] ?? ''
      if (isListCompletionAnnotation(nextLine.trim())) {
        index += 1
        while (index + 1 < physicalLines.length && isListMetadataContinuationLine(physicalLines[index + 1] ?? '')) {
          index += 1
        }
        continue
      }
      if (!isListContinuationLine(nextLine)) break
      line = `${line.trimEnd()} ${nextLine.trim()}`
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
  return !/^(?:#{1,6}\s+|[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+|goal:\s+|status:\s+|(?:primary\s+)?scope:\s*$|deliverables:\s*$|success gates:\s*$|done gate(?:\s+for\s+.+?)?:\s*$|do not start yet:\s*$|the next milestone is:\s+)/i.test(trimmed)
}

function isListContinuationLine(line: string): boolean {
  if (!/^\s{2,}\S/.test(line)) return false
  const trimmed = line.trim()
  if (isListCompletionAnnotation(trimmed)) return false
  return !/^(?:#{1,6}\s+|\|(?:.+)\||[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(trimmed)
}

function isListMetadataContinuationLine(line: string): boolean {
  if (!/^\s{2,}\S/.test(line)) return false
  const trimmed = line.trim()
  return !/^(?:#{1,6}\s+|\|(?:.+)\||[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(trimmed)
}

function isListCompletionAnnotation(trimmed: string): boolean {
  return /^(?:[✓✔✅]\s*)?(?:completed?|done|shipped|verified|proof|evidence)\b/i.test(trimmed)
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

function isMarkdownTableDividerRow(cells: readonly string[]): boolean {
  return cells.every(cell => /^:?-{3,}:?$/.test(cell))
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
  return /(roadmap|plan|tracker|milestone|inventory|bugs|todo)/i.test(fileBase)
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

function isEvidenceStatusBullet(title: string): boolean {
  const normalized = cleanHeading(title).toLowerCase().replace(/\s+/g, ' ').trim()
  return /^(implementation|fixture|verification|status|files created|acceptance criteria|review lanes?)\b/.test(normalized)
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
  const match = /^stage\s+(\d+)(?:\b|\s*[:(].*)/i.exec(label.trim())
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

function scopeHintForStage(
  stageLabel: string | null | undefined,
  currentMilestoneStage: string | null | undefined,
  unknown: WorkspaceSignal['scopeHint'] = 'current',
): WorkspaceSignal['scopeHint'] {
  const stageNumber = parseStageOrdinal(stageLabel)
  const currentStageNumber = parseStageOrdinal(currentMilestoneStage)
  if (stageNumber != null && currentStageNumber != null) {
    return stageNumber <= currentStageNumber ? 'current' : 'later'
  }
  return unknown
}

function scopeHintForOpenWorkSection(
  sectionHeading: string | null | undefined,
): WorkspaceSignal['scopeHint'] | undefined {
  if (!sectionHeading) return undefined
  if (/^(later|v2 priorities)(?:\b.*)?$/i.test(sectionHeading.trim())) return 'later'
  return undefined
}

function scopeHintForOpenWorkTitle(
  title: string | null | undefined,
): WorkspaceSignal['scopeHint'] | undefined {
  if (!title) return undefined
  if (/\b(deferred|post[-\s]?launch|later|v2)\b/i.test(title)) return 'later'
  return undefined
}

function scopeHintForOpenWork(
  sectionHeading: string | null | undefined,
  title: string | null | undefined,
): WorkspaceSignal['scopeHint'] | undefined {
  return scopeHintForOpenWorkSection(sectionHeading) ?? scopeHintForOpenWorkTitle(title)
}

function explicitReleaseLabelForHeading(heading: string): string | null {
  const cleaned = cleanHeading(heading).replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  const colonLabel =
    /^(?:current\s+)?(?:release|bounded scope|scope)\s*:\s*(.+?)\s*$/i.exec(cleaned)?.[1]
  if (colonLabel) return cleanReleaseLabel(colonLabel)
  const suffixLabel = /^(.+?)\s+release$/i.exec(cleaned)?.[1]
  return suffixLabel ? cleanReleaseLabel(suffixLabel) : null
}

function cleanReleaseLabel(label: string): string | null {
  const cleaned = cleanHeading(label).replace(/\s+/g, ' ').trim()
  if (!cleaned || /^(plan|roadmap|notes?|tbd)$/i.test(cleaned)) return null
  return cleaned
}

function releaseIdFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function currentReleaseIdForScope(
  releaseId: string | null,
  scopeHint: WorkspaceSignal['scopeHint'] | undefined,
): string | undefined {
  void scopeHint
  if (!releaseId) return undefined
  return releaseId
}

function scopeHintInsideExplicitRelease(
  releaseId: string | null,
  scopeHint: WorkspaceSignal['scopeHint'] | undefined,
): WorkspaceSignal['scopeHint'] | undefined {
  if (scopeHint) return scopeHint
  return releaseId ? 'current' : undefined
}

function isFutureStage(
  stageLabel: string | null | undefined,
  currentMilestoneStage: string | null | undefined,
): boolean {
  const stageNumber = parseStageOrdinal(stageLabel)
  const currentStageNumber = parseStageOrdinal(currentMilestoneStage)
  return stageNumber != null && currentStageNumber != null && stageNumber > currentStageNumber
}

function stageDeliverableSignal(
  currentSection: string,
  currentMilestoneStage: string | null,
  unknownStageScope: WorkspaceSignal['scopeHint'] = 'current',
): { kind: WorkspaceSignal['kind']; scopeHint?: WorkspaceSignal['scopeHint']; role?: WorkspaceSignal['role'] } {
  if (isFutureStage(currentSection, currentMilestoneStage)) {
    return {
      kind: 'open_work',
      scopeHint: 'later',
    }
  }
  return {
    kind: 'context',
    role: 'capability',
    scopeHint: scopeHintForStage(currentSection, currentMilestoneStage, unknownStageScope),
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
    const primaryDomain = primaryDomainHint(relPaths, multiProjectRoots)
    const availableFiles = new Set(relPaths)

    const fileContents = new Map<string, string>()
    for (const rel of relPaths) {
      const abs = join(projectPath, rel)
      if (!existsSync(abs)) continue
      const raw = readFileSync(abs, 'utf-8')
      if (!raw.trim()) continue
      fileContents.set(rel, raw)
    }
    const contentsByDomain = new Map<string, string[]>()
    for (const [rel, raw] of fileContents) {
      const domain = inferDomainHint(rel, multiProjectRoots) ?? ''
      const bucket = contentsByDomain.get(domain) ?? []
      bucket.push(raw)
      contentsByDomain.set(domain, bucket)
    }
    const currentMilestoneStageByDomain = new Map<string, string | null>()
    for (const [domain, contents] of contentsByDomain) {
      currentMilestoneStageByDomain.set(
        domain,
        multiProjectRoots.size > 1 && domain && domain !== primaryDomain
          ? detectExplicitCurrentMilestoneStage(contents)
          : detectCurrentMilestoneStage(contents),
      )
    }

    const signals: WorkspaceSignal[] = []
    for (const rel of relPaths) {
      const abs = join(projectPath, rel)
      const raw = fileContents.get(rel)
      if (!raw) continue
      if (!raw.trim()) continue
      const fileBase = basename(rel)
      const domainHint = inferDomainHint(rel, multiProjectRoots)
      const domainKey = domainHint ?? ''
      const currentMilestoneStage = currentMilestoneStageByDomain.get(domainKey) ?? null
      const unknownStageScope: WorkspaceSignal['scopeHint'] =
        multiProjectRoots.size > 1 && domainHint && domainHint !== primaryDomain ? 'later' : 'current'
      const defaultOpenWorkScopeHint: WorkspaceSignal['scopeHint'] | undefined =
        multiProjectRoots.size > 1 && domainHint && domainHint !== primaryDomain ? 'later' : undefined
      let currentSection: string | null = null
      let currentSectionRaw: string | null = null
      let currentLabel: 'deliverables' | 'scope' | 'success_gates' | 'done_gate' | 'do_not_start' | null = null
      let pendingRecommendedTaskTitle: string | null = null
      let pendingRecommendedTaskSection: string | null = null
      let pendingRecommendedTaskSectionRaw: string | null = null
      let currentRecommendedStageAlignment: string | null = null
      let currentRecommendedDomain: string | null = null
      let currentReleaseId: string | null = null
      let currentReleaseLabel: string | null = null
      let currentReleaseDepth: number | null = null
      const bulletStack: Array<{ indent: number; title: string; grouping: boolean }> = []
      let pendingTableHeaders: string[] | null = null
      let activeTableHeaders: string[] | null = null

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
          const scopeHint = scopeHintInsideExplicitRelease(
            currentReleaseId,
            scopeHintForStage(currentRecommendedStageAlignment, currentMilestoneStage, unknownStageScope),
          )
          const domain = currentRecommendedDomain ?? domainHint
          const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
          const releaseLabel = releaseId ? currentReleaseLabel : null
          if (isDecompositionInventoryFile(rel) && scopeHint === 'later' && relatedSpec) {
            signals.push({
              source: 'planning-docs',
              kind: 'context',
              role: 'capability',
              title: `Spec: ${humanizeSpecStem(path.basename(relatedSpec))}`,
              evidence: `${rel}: ${pendingRecommendedTaskSection ?? currentSection ?? title}`.slice(0, 240),
              references: [relatedSpec, abs],
              linkedTaskHints: [title],
              ...(domain ? { domainHint: domain } : {}),
              scopeHint,
              confidence: 'high',
            })
          } else {
            signals.push({
              source: 'planning-docs',
              kind: 'open_work',
              title,
              evidence: `${rel}: ${pendingRecommendedTaskSection ?? currentSection ?? title}`.slice(0, 240),
              references,
              ...(domain ? { domainHint: domain } : {}),
              scopeHint,
              ...(releaseId ? { releaseId } : {}),
              ...(releaseLabel ? { releaseLabel } : {}),
              confidence: 'high',
            })
          }
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
          const headingDepth = heading[1]!.length
          if (currentReleaseDepth != null && headingDepth <= currentReleaseDepth) {
            currentReleaseId = null
            currentReleaseLabel = null
            currentReleaseDepth = null
          }
          currentSection = cleanHeading(heading[2]!)
          currentSectionRaw = heading[2]!.trim()
          const releaseLabel = explicitReleaseLabelForHeading(currentSection)
          if (releaseLabel) {
            currentReleaseId = releaseIdFromLabel(releaseLabel)
            currentReleaseLabel = releaseLabel
            currentReleaseDepth = headingDepth
          } else if (STAGE_HEADING_RE.test(currentSection)) {
            currentReleaseId = releaseIdFromLabel(currentSection)
            currentReleaseLabel = currentSection
            currentReleaseDepth = headingDepth
          }
          currentLabel = null
          bulletStack.length = 0
          pendingTableHeaders = null
          activeTableHeaders = null
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
            const scopeHint = scopeHintForStage(currentSection, currentMilestoneStage, unknownStageScope)
            const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
            const releaseLabel = releaseId ? currentReleaseLabel : null
            signals.push({
              source: 'planning-docs',
              kind: 'context',
              title: currentSection,
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              scopeHint,
              ...(releaseId ? { releaseId } : {}),
              ...(releaseLabel ? { releaseLabel } : {}),
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          }
          continue
        }

        const goalLabel = GOAL_LABEL_RE.exec(line.trim())
        if (goalLabel && currentSection && STAGE_HEADING_RE.test(currentSection)) {
          const scopeHint = scopeHintForStage(currentSection, currentMilestoneStage, unknownStageScope)
          const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
          const releaseLabel = releaseId ? currentReleaseLabel : null
          signals.push({
            source: 'planning-docs',
            kind: 'context',
            title: currentSection,
            evidence: `${rel}: ${cleanHeading(goalLabel[1]!)}`.slice(0, 240),
            references: [abs],
            role: 'capability',
            scopeHint,
            ...(releaseId ? { releaseId } : {}),
            ...(releaseLabel ? { releaseLabel } : {}),
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
          continue
        }

        const trimmedLine = line.trim()
        const tableCells = splitMarkdownTableRow(line)
        if (tableCells) {
          if (isMarkdownTableDividerRow(tableCells)) {
            if (pendingTableHeaders) {
              activeTableHeaders = pendingTableHeaders
              pendingTableHeaders = null
            }
            continue
          }
          if (!activeTableHeaders) {
            pendingTableHeaders = tableCells
            continue
          }
          if (
            currentSection &&
            SYSTEM_RECORDS_HEADING_RE.test(currentSection) &&
            activeTableHeaders[0]?.toLowerCase() === 'record' &&
            activeTableHeaders[1]?.toLowerCase() === 'purpose' &&
            tableCells.length >= 2
          ) {
            const recordTitle = cleanHeading(tableCells[0] ?? '')
            const recordPurpose = cleanHeading(tableCells[1] ?? '')
            if (recordTitle && recordPurpose) {
              signals.push({
                source: 'planning-docs',
                kind: 'context',
                title: recordTitle,
                evidence: `${rel}: ${recordPurpose}`.slice(0, 240),
                references: [abs],
                role: recordRole(recordTitle),
                structure: 'record',
                ...(domainHint ? { domainHint } : {}),
                confidence: 'high',
              })
            }
          }
          continue
        }
        pendingTableHeaders = null
        activeTableHeaders = null
        if (currentSection && STAGE_HEADING_RE.test(currentSection)) {
          if (DELIVERABLE_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'deliverables'
            bulletStack.length = 0
            continue
          }
          if (SCOPE_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'scope'
            bulletStack.length = 0
            continue
          }
          if (SUCCESS_GATES_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'success_gates'
            bulletStack.length = 0
            continue
          }
          if (DONE_GATE_LABEL_RE.test(trimmedLine)) {
            currentLabel = 'done_gate'
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
          const scopeHint = scopeHintInsideExplicitRelease(
            currentReleaseId,
            scopeHintForOpenWork(currentSection, unchecked[1]) ?? defaultOpenWorkScopeHint,
          )
          const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
          const releaseLabel = releaseId ? currentReleaseLabel : null
          signals.push({
            source: 'planning-docs',
            kind: 'open_work',
            title: cleanHeading(unchecked[1]!),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(scopeHint ? { scopeHint } : {}),
            ...(releaseId ? { releaseId } : {}),
            ...(releaseLabel ? { releaseLabel } : {}),
            ...(domainHint ? { domainHint } : {}),
            confidence: 'high',
          })
          continue
        }

        const bullet = /^(\s*)[-*]\s+(.+?)\s*$/.exec(line)
        if (bullet && currentSection && (OPEN_HEADING_RE.test(currentSection) || STAGE_HEADING_RE.test(currentSection))) {
          const indent = bullet[1]!.replace(/\t/g, '  ').length
          const title = cleanHeading(bullet[2]!)
          const evidenceStatusBullet = isEvidenceStatusBullet(title)
          const stageScopedSignal = currentLabel === 'deliverables'
            ? stageDeliverableSignal(currentSection, currentMilestoneStage, unknownStageScope)
            : currentLabel === 'scope'
              ? stageDeliverableSignal(currentSection, currentMilestoneStage, unknownStageScope)
            : currentLabel === 'success_gates'
              ? { kind: 'context' as const }
              : currentLabel === 'done_gate'
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
          if (evidenceStatusBullet) {
            const scopeHint = scopeHintInsideExplicitRelease(
              currentReleaseId,
              scopeHintForOpenWork(currentSection, title) ?? defaultOpenWorkScopeHint,
            )
            const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
            const releaseLabel = releaseId ? currentReleaseLabel : null
            signals.push({
              source: 'planning-docs',
              kind: 'context',
              title: title.replace(/:$/, ''),
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(scopeHint ? { scopeHint } : {}),
              ...(releaseId ? { releaseId } : {}),
              ...(releaseLabel ? { releaseLabel } : {}),
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          } else if (grouping && !groupingChildrenAreTasks) {
            const scopeHint = scopeHintInsideExplicitRelease(
              currentReleaseId,
              scopeHintForOpenWork(currentSection, title) ?? defaultOpenWorkScopeHint,
            )
            const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
            const releaseLabel = releaseId ? currentReleaseLabel : null
            signals.push({
              source: 'planning-docs',
              kind:
                isProjectStateCurrentFocus(fileBase, currentSection)
                  ? 'context'
                  : 'open_work',
              title: title.replace(/:$/, ''),
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(scopeHint ? { scopeHint } : {}),
              ...(releaseId ? { releaseId } : {}),
              ...(releaseLabel ? { releaseLabel } : {}),
              ...(domainHint ? { domainHint } : {}),
              confidence: 'medium',
            })
          } else if (!grouping) {
            if (currentLabel === 'deliverables' && stageScopedSignal?.kind === 'context') {
              const releaseId = currentReleaseIdForScope(currentReleaseId, stageScopedSignal.scopeHint)
              const releaseLabel = releaseId ? currentReleaseLabel : null
              signals.push({
                source: 'planning-docs',
                kind: 'context',
                role: 'capability',
                title,
                evidence: `${rel}: ${line.trim()}`.slice(0, 240),
                references: [abs],
                ...(stageScopedSignal?.scopeHint ? { scopeHint: stageScopedSignal.scopeHint } : {}),
                ...(releaseId ? { releaseId } : {}),
                ...(releaseLabel ? { releaseLabel } : {}),
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
            const scopeHint = scopeHintInsideExplicitRelease(
              currentReleaseId,
              stageScopedSignal?.scopeHint ?? scopeHintForOpenWork(currentSection, title) ?? defaultOpenWorkScopeHint,
            )
            const releaseId = currentReleaseIdForScope(currentReleaseId, scopeHint)
            const releaseLabel = releaseId ? currentReleaseLabel : null
            signals.push({
              source: 'planning-docs',
              kind,
              title,
              evidence: `${rel}: ${line.trim()}`.slice(0, 240),
              references: [abs],
              ...(stageScopedSignal?.role
                ? { role: stageScopedSignal.role }
                : kind === 'context' && (currentLabel === 'deliverables' || currentLabel === 'scope')
                  ? { role: 'capability' as const }
                  : {}),
              ...(scopeHint ? { scopeHint } : {}),
              ...(releaseId ? { releaseId } : {}),
              ...(releaseLabel ? { releaseLabel } : {}),
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
          const scopeHint = scopeHintInsideExplicitRelease(
            currentReleaseId,
            scopeHintForOpenWork(currentSection, numbered[1]) ?? defaultOpenWorkScopeHint,
          )
          const releaseId = kind === 'open_work'
            ? currentReleaseIdForScope(currentReleaseId, scopeHint)
            : undefined
          const releaseLabel = releaseId ? currentReleaseLabel : null
          signals.push({
            source: 'planning-docs',
            kind,
            title: cleanHeading(numbered[1]!),
            evidence: `${rel}: ${line.trim()}`.slice(0, 240),
            references: [abs],
            ...(scopeHint ? { scopeHint } : {}),
            ...(releaseId ? { releaseId } : {}),
            ...(releaseLabel ? { releaseLabel } : {}),
            ...(domainHint ? { domainHint } : {}),
            confidence: 'medium',
          })
        }
      }

      flushPendingRecommendedTask()
    }

    return mergeCoreLoopStructuralContext(signals).map(signal =>
      signal.kind === 'context' &&
      !signal.role &&
      signal.scopeHint &&
      signal.releaseId &&
      !STAGE_HEADING_RE.test(signal.title)
        ? { ...signal, role: 'capability' as const }
        : signal,
    )
  },
}

function detectCurrentMilestoneStage(contents: Iterable<string>): string | null {
  const all = [...contents]
  const explicit = detectExplicitCurrentMilestoneStage(all)
  if (explicit) return explicit
  let earliestStage: number | null = null
  let earliestNonBaselineStage: number | null = null
  for (const raw of all) {
    for (const stageMatch of raw.matchAll(/^#{2,4}\s+Stage\s+(\d+)(?:\b|\s*[:(].*)/gim)) {
      const stage = Number.parseInt(stageMatch[1] ?? '', 10)
      if (!Number.isFinite(stage)) continue
      earliestStage = earliestStage == null ? stage : Math.min(earliestStage, stage)
      if (stage > 0) {
        earliestNonBaselineStage = earliestNonBaselineStage == null
          ? stage
          : Math.min(earliestNonBaselineStage, stage)
      }
    }
  }
  const fallbackStage = earliestNonBaselineStage ?? earliestStage
  return fallbackStage == null ? null : normalizeStageLabel(`Stage ${fallbackStage}`)
}

function detectExplicitCurrentMilestoneStage(contents: Iterable<string>): string | null {
  for (const raw of contents) {
    const match = raw.match(/##\s+Current Next Milestone[\s\S]*?The next milestone is\s+(Stage\s+\d+)/i)
    if (match?.[1]) return normalizeStageLabel(match[1])
  }
  return null
}

function normalizeStageLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
