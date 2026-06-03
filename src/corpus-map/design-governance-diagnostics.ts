import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CodebaseMap,
  CorpusDesignGovernanceSummary,
  CorpusDesignSystemSummary,
  CorpusFileEntry,
  DesignGovernanceDiagnostic,
  DesignGovernanceDiagnosticKind,
  DesignGovernanceLearningProposal,
  DesignGovernanceLearningProposalKind,
  DesignGovernanceReviewerRole,
} from './types.js'

const REQUIRED_REVIEWER_CHECKS = [
  'Name the token/component roles reused or extended.',
  'Name the semantic text hierarchy role for every new text treatment.',
  'Justify every new token or variant as a distinct communication need, with a budget and removal path.',
  'Reject local one-off styling when a governed primitive exists.',
  'Reject new variant names unless a component contract changed.',
]

const VARIANT_ALIASES = {
  attention: /\b(?:tone-)?attention\b|['"`]attention['"`]/i,
  default: /\b(?:tone-)?default\b|['"`]default['"`]/i,
  regular: /\b(?:density-)?regular\b|['"`]regular['"`]/i,
} as const

const SURFACE_OWNERSHIP_SIGNALS = [
  { label: 'readiness', pattern: /\breadiness\b|\bbootstrap\b|\bsetup\b/i },
  { label: 'providers', pattern: /\bproviders?\b/i },
  { label: 'facts', pattern: /\bfacts?\b/i },
  { label: 'memory', pattern: /\bmemory\b|\blearning\b/i },
  { label: 're-intake', pattern: /\bre[-_ ]?intake\b/i },
  { label: 'design feedback', pattern: /\bdesign[-_ ]?(?:feedback|system|taste|review)\b/i },
  { label: 'project graph', pattern: /\bproject[-_ ]?graph\b|\bprojectGraph\b/i },
  { label: 'advanced levers', pattern: /\badvanced\b|\blevers?\b|\bprofile\b/i },
]

const RAW_VISUAL_VALUE_PATTERNS = [
  /\bfont-size\s*:\s*(?!var\()[^;]+/i,
  /\bfont-weight\s*:\s*(?:[5-9]\d{2}|bold|bolder)\b/i,
  /\bline-height\s*:\s*(?!var\()[^;]+/i,
  /\b(?:padding|margin|gap|inset|top|right|bottom|left)\s*:\s*(?!var\()[^;]*(?:px|rem|em)/i,
  /\bborder-radius\s*:\s*(?!var\()[^;]+/i,
  /\bbox-shadow\s*:\s*(?!var\()[^;]+/i,
  /\bz-index\s*:\s*(?!var\()[0-9]+/i,
  /\b(?:color|background(?:-color)?|border-color)\s*:\s*(?:#[0-9a-f]{3,8}|rgb\(|hsl\()/i,
]

interface BuildDesignGovernanceDiagnosticsInput {
  projectRoot: string
  files: Record<string, CorpusFileEntry>
  designSystem?: CorpusDesignSystemSummary
  now?: Date
}

type Evidence = DesignGovernanceDiagnostic['evidence'][number]

export async function buildDesignGovernanceDiagnostics(
  input: BuildDesignGovernanceDiagnosticsInput,
): Promise<CorpusDesignGovernanceSummary | undefined> {
  const paths = Object.keys(input.files).sort()
  const uiPaths = paths.filter(isUiPath)
  const componentAuthorityPaths = paths.filter(isPackageComponentPath)
  const hasUiShape = uiPaths.length > 0 || componentAuthorityPaths.length > 0 || Boolean(input.designSystem)
  if (!hasUiShape) return undefined

  const contents = await readRelevantContents(input.projectRoot, paths)
  const tokenAuthority = detectTokenAuthority(paths)
  const duplicateFamilies = detectDuplicatePrimitiveFamilies(paths)
  const variantRisks = detectVariantVocabularyRisks(contents)
  const diagnostics: DesignGovernanceDiagnostic[] = [
    ...detectTokenFamilySplit(paths, contents),
    ...detectRawVisualValues(contents),
    ...diagnosticIf(
      variantRisks.length > 0,
      'variant_vocabulary_sprawl',
      'warn',
      `Deprecated or drifting variant vocabulary detected: ${variantRisks.join(', ')}.`,
      variantEvidence(contents),
      'Use shared variant axes and aliases from the component contract before adding or approving new variant names.',
      ['design', 'maintainability'],
    ),
    ...diagnosticIf(
      duplicateFamilies.length > 0,
      'duplicate_primitive_family',
      'warn',
      `Duplicate primitive families detected: ${duplicateFamilies.join(', ')}.`,
      duplicatePrimitiveEvidence(paths),
      'Route repeated cards, notices, chips, status rows, and button-like wrappers through the canonical component owner or record a reviewed exception.',
      ['design', 'accessibility', 'maintainability'],
    ),
    ...detectSurfaceOwnershipSprawl(contents),
    ...detectMissingComponentContract(paths, input.designSystem),
    ...detectUnreviewedDesignExceptions(contents),
  ]
  const learningProposals = proposeDesignGovernanceLearningProposals(diagnostics, { minimumOccurrences: 1 })

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    canonicalDesignSystemAuthority: input.designSystem?.sourcePath,
    tokenAuthority,
    componentAuthorityPaths: componentAuthorityPaths.slice(0, 12),
    knownDuplicatePrimitiveFamilies: duplicateFamilies,
    variantVocabularyRisks: variantRisks,
    requiredReviewerChecks: REQUIRED_REVIEWER_CHECKS,
    learningProposals,
    diagnostics,
  }
}

export function renderDesignGovernancePacket(
  map: Pick<CodebaseMap, 'designGovernance' | 'designSystem'>,
): string {
  const summary = map.designGovernance
  const canonicalAuthority = summary?.canonicalDesignSystemAuthority ?? map.designSystem?.sourcePath ?? 'absent'
  const tokenAuthority = summary?.tokenAuthority ?? 'absent'
  const componentAuthority = summary?.componentAuthorityPaths.length
    ? summary.componentAuthorityPaths.join(', ')
    : 'absent'
  const duplicateFamilies = summary?.knownDuplicatePrimitiveFamilies.length
    ? summary.knownDuplicatePrimitiveFamilies.join(', ')
    : 'none detected'
  const variantRisks = summary?.variantVocabularyRisks.length
    ? summary.variantVocabularyRisks.join(', ')
    : 'none detected'
  const checks = summary?.requiredReviewerChecks.length
    ? summary.requiredReviewerChecks
    : REQUIRED_REVIEWER_CHECKS
  const learningProposals = summary?.learningProposals.length
    ? summary.learningProposals.map((proposal) => titleizeProposalKind(proposal.kind)).join(', ')
    : 'none'

  const lines = [
    '## Design Governance',
    '',
    `- Canonical design-system authority: ${canonicalAuthority}`,
    `- Token authority: ${tokenAuthority}`,
    `- Component authority: ${componentAuthority}`,
    `- Known duplicate primitive families: ${duplicateFamilies}`,
    `- Variant vocabulary risks: ${variantRisks}`,
    `- Learning proposals require owner approval: ${learningProposals}`,
  ]
  lines.push('- Required reviewer checks:')
  for (const check of checks) lines.push(`  - ${check}`)
  return lines.join('\n')
}

export function proposeDesignGovernanceLearningProposals(
  diagnostics: DesignGovernanceDiagnostic[],
  options: { minimumOccurrences?: number } = {},
): DesignGovernanceLearningProposal[] {
  const minimumOccurrences = options.minimumOccurrences ?? 2
  const byProposal = new Map<DesignGovernanceLearningProposalKind, DesignGovernanceDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    const kind = proposalKindForDiagnostic(diagnostic.kind)
    const bucket = byProposal.get(kind) ?? []
    bucket.push(diagnostic)
    byProposal.set(kind, bucket)
  }
  if (new Set(diagnostics.map((diagnostic) => diagnostic.kind)).size >= 3) {
    byProposal.set('guildhall_product_learning', diagnostics)
  }
  return [...byProposal.entries()]
    .filter(([, bucket]) => bucket.length >= minimumOccurrences)
    .map(([kind, bucket]) => ({
      id: `design-governance-proposal:${kind}`,
      kind,
      diagnosticKinds: [...new Set(bucket.map((diagnostic) => diagnostic.kind))].sort(),
      summary: proposalSummary(kind, bucket),
      evidence: bucket.flatMap((diagnostic) => diagnostic.evidence).slice(0, 8),
      ownerApprovalRequired: true as const,
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind))
}

function detectTokenFamilySplit(
  paths: string[],
  contents: Map<string, string>,
): DesignGovernanceDiagnostic[] {
  const canonical = paths.find((file) => file === 'packages/ui/src/styles.css')
  const appLocal = paths.find((file) => file === 'src/web/tokens.css')
  if (!canonical || !appLocal) return []
  const appLocalContent = contents.get(appLocal) ?? ''
  if (!/--(?:fs|s|r|lh)-/.test(appLocalContent)) return []
  const evidence = [
    lineEvidence(canonical, contents.get(canonical) ?? '', /--gh-/),
    lineEvidence(appLocal, appLocalContent, /--(?:fs|s|r|lh)-/),
  ].filter(Boolean) as Evidence[]
  return makeDiagnostic({
    kind: 'token_family_split',
    severity: 'warn',
    summary: 'Canonical package tokens and app-local token scales both define visual roles.',
    evidence,
    recommendation: 'Choose one token authority for each role; convert legacy app-local scales to canonical role tokens or document a temporary alias with an owner and removal condition.',
    appliesToReviewerRoles: ['design', 'maintainability'],
  })
}

function detectRawVisualValues(contents: Map<string, string>): DesignGovernanceDiagnostic[] {
  const evidence: Evidence[] = []
  for (const [file, content] of contents) {
    if (!isAppUiImplementationPath(file)) continue
    for (const pattern of RAW_VISUAL_VALUE_PATTERNS) {
      const match = lineEvidence(file, content, pattern)
      if (match) {
        evidence.push(match)
        break
      }
    }
    if (evidence.length >= 8) break
  }
  return diagnosticIf(
    evidence.length > 0,
    'raw_visual_values',
    'warn',
    'Surface or app-local UI code contains raw visual values outside a canonical token/component layer.',
    evidence,
    'Replace raw values with role tokens or move the repeated treatment into a governed primitive before approving new UI work.',
    ['design', 'accessibility', 'maintainability'],
  )
}

function detectSurfaceOwnershipSprawl(contents: Map<string, string>): DesignGovernanceDiagnostic[] {
  const diagnostics: DesignGovernanceDiagnostic[] = []
  for (const [file, content] of contents) {
    if (!isSurfacePath(file)) continue
    const labels = SURFACE_OWNERSHIP_SIGNALS
      .filter((signal) => signal.pattern.test(content))
      .map((signal) => signal.label)
    if (labels.length < 5) continue
    const evidence = labels
      .map((label) => {
        const signal = SURFACE_OWNERSHIP_SIGNALS.find((item) => item.label === label)
        return signal ? lineEvidence(file, content, signal.pattern) : undefined
      })
      .filter(Boolean)
      .slice(0, 5) as Evidence[]
    diagnostics.push(...makeDiagnostic({
      kind: 'surface_ownership_sprawl',
      severity: 'warn',
      summary: `${file} owns unrelated UI jobs: ${labels.join(', ')}.`,
      evidence,
      recommendation: 'Keep route surfaces as shells; move unrelated review, data, provider, memory, graph, and advanced control flows to focused panels before adding more UI states.',
      appliesToReviewerRoles: ['product', 'design', 'maintainability'],
    }))
  }
  return diagnostics
}

function detectMissingComponentContract(
  paths: string[],
  designSystem?: CorpusDesignSystemSummary,
): DesignGovernanceDiagnostic[] {
  const packageComponents = paths.filter(isPackageComponentPath)
  const appComponents = paths.filter(isAppComponentPath)
  const hasComponentLibrary = packageComponents.length >= 2 || packageComponents.length + appComponents.length >= 4
  if (!hasComponentLibrary) return []
  const hasContract = paths.some((file) => file.endsWith('component-constitution.ts')) ||
    (designSystem?.primitives.length ?? 0) > 0
  if (hasContract) return []
  const evidence = [...packageComponents, ...appComponents]
    .slice(0, 6)
    .map((file) => ({ path: file }))
  return makeDiagnostic({
    kind: 'missing_component_contract',
    severity: 'warn',
    summary: 'Component library files exist without a component contract that names ownership, variants, accessibility, and replacement paths.',
    evidence,
    recommendation: 'Create or update a component contract before broadening primitive usage or adding variant axes.',
    appliesToReviewerRoles: ['design', 'accessibility', 'maintainability'],
  })
}

function detectUnreviewedDesignExceptions(contents: Map<string, string>): DesignGovernanceDiagnostic[] {
  const evidence: Evidence[] = []
  for (const [file, content] of contents) {
    const exception = lineEvidence(file, content, /\b(?:design exception|design override|lint:design|stylelint-disable)\b/i)
    if (!exception) continue
    if (/\bowner\b/i.test(content) && /\bremoval condition\b/i.test(content)) continue
    evidence.push(exception)
    if (evidence.length >= 5) break
  }
  return diagnosticIf(
    evidence.length > 0,
    'unreviewed_design_exception',
    'info',
    'Design exceptions or suppressions appear without nearby owner and removal-condition language.',
    evidence,
    'Treat design exceptions as temporary records: name the owner, violated rule, and removal condition before workers rely on them.',
    ['design', 'maintainability'],
  )
}

function detectVariantVocabularyRisks(contents: Map<string, string>): string[] {
  const risks = new Set<string>()
  for (const [file, content] of contents) {
    if (!isUiPath(file)) continue
    for (const [name, pattern] of Object.entries(VARIANT_ALIASES)) {
      if (pattern.test(content)) risks.add(name)
    }
  }
  return [...risks].sort()
}

function variantEvidence(contents: Map<string, string>): Evidence[] {
  const evidence: Evidence[] = []
  for (const [file, content] of contents) {
    if (!isUiPath(file)) continue
    for (const pattern of Object.values(VARIANT_ALIASES)) {
      const match = lineEvidence(file, content, pattern)
      if (match) {
        evidence.push(match)
        break
      }
    }
    if (evidence.length >= 6) break
  }
  return evidence
}

function detectDuplicatePrimitiveFamilies(paths: string[]): string[] {
  const families = new Set<string>()
  const packageNames = new Set(paths.filter(isPackageComponentPath).map(componentNameFromPath))
  const appNames = new Set(paths.filter(isAppComponentPath).map(componentNameFromPath))
  for (const name of packageNames) {
    if (appNames.has(name)) families.add(name)
  }
  if (packageNames.has('FrameCard') && appNames.has('Card')) families.add('FrameCard/Card')
  return [...families].sort()
}

function duplicatePrimitiveEvidence(paths: string[]): Evidence[] {
  const packageComponents = paths.filter(isPackageComponentPath)
  const appComponents = paths.filter(isAppComponentPath)
  const evidence = [
    ...packageComponents.filter((file) => /(?:FrameCard|NoticeBand)\.svelte$/.test(file)),
    ...appComponents.filter((file) => /(?:Card|NoticeBand)\.svelte$/.test(file)),
  ]
  return [...new Set(evidence)].sort().map((file) => ({ path: file }))
}

function detectTokenAuthority(paths: string[]): string | undefined {
  if (paths.includes('packages/ui/src/styles.css')) return 'packages/ui/src/styles.css'
  return paths.find((file) => /(?:^|\/)tokens\.css$/.test(file))
}

function proposalKindForDiagnostic(kind: DesignGovernanceDiagnosticKind): DesignGovernanceLearningProposalKind {
  switch (kind) {
    case 'duplicate_primitive_family':
    case 'missing_component_contract':
      return 'component_contract_addition'
    case 'surface_ownership_sprawl':
      return 'corpus_map_override'
    case 'raw_visual_values':
    case 'token_family_split':
    case 'unreviewed_design_exception':
    case 'variant_vocabulary_sprawl':
      return 'project_design_system_memory_update'
  }
}

function proposalSummary(
  kind: DesignGovernanceLearningProposalKind,
  diagnostics: DesignGovernanceDiagnostic[],
): string {
  const kinds = [...new Set(diagnostics.map((diagnostic) => diagnostic.kind))].sort().join(', ')
  switch (kind) {
    case 'component_contract_addition':
      return `Propose a component contract addition for repeated governance diagnostics: ${kinds}.`
    case 'corpus_map_override':
      return `Propose a corpus-map override or area convention for repeated surface-ownership diagnostics: ${kinds}.`
    case 'guildhall_product_learning':
      return `Propose a Guildhall product learning if these design-governance diagnostics recur across managed products: ${kinds}.`
    case 'project_design_system_memory_update':
      return `Propose a project-local design-system memory update for repeated token, variant, or exception diagnostics: ${kinds}.`
  }
}

function titleizeProposalKind(kind: DesignGovernanceLearningProposalKind): string {
  return kind.replace(/_/g, ' ')
}

async function readRelevantContents(
  projectRoot: string,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const file of paths.filter((candidate) => isUiPath(candidate) || isDesignGovernancePath(candidate))) {
    try {
      out.set(file, await fs.readFile(path.join(projectRoot, file), 'utf-8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  return out
}

function diagnosticIf(
  condition: boolean,
  kind: DesignGovernanceDiagnosticKind,
  severity: DesignGovernanceDiagnostic['severity'],
  summary: string,
  evidence: Evidence[],
  recommendation: string,
  appliesToReviewerRoles: DesignGovernanceReviewerRole[],
): DesignGovernanceDiagnostic[] {
  if (!condition) return []
  return makeDiagnostic({ kind, severity, summary, evidence, recommendation, appliesToReviewerRoles })
}

function makeDiagnostic(input: Omit<DesignGovernanceDiagnostic, 'id'>): DesignGovernanceDiagnostic[] {
  return [{
    id: `design-governance:${input.kind}`,
    ...input,
    evidence: input.evidence.slice(0, 8),
  }]
}

function lineEvidence(pathLabel: string, content: string, pattern: RegExp): Evidence | undefined {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!pattern.test(line)) continue
    return {
      path: pathLabel,
      line: index + 1,
      excerpt: line.trim().slice(0, 160),
    }
  }
  return undefined
}

function isUiPath(file: string): boolean {
  return /\.(?:svelte|vue|tsx|jsx|css|scss)$/.test(file) &&
    /(?:^packages\/ui\/|^src\/web\/|\/components\/|\/surfaces\/|\/routes\/|\/pages\/|\/ui\/)/.test(file)
}

function isDesignGovernancePath(file: string): boolean {
  return file === '.guildhall/design-system.yaml' ||
    file.endsWith('component-constitution.ts') ||
    file.endsWith('design-system.md') ||
    file.endsWith('design-system.yaml')
}

function isPackageComponentPath(file: string): boolean {
  return /^packages\/ui\/src\/components\/[^/]+\.(?:svelte|vue|tsx|jsx)$/.test(file)
}

function isAppComponentPath(file: string): boolean {
  return /^src\/web\/lib\/[^/]+\.(?:svelte|vue|tsx|jsx)$/.test(file) ||
    /^src\/(?:components|ui)\/[^/]+\.(?:svelte|vue|tsx|jsx)$/.test(file)
}

function isAppUiImplementationPath(file: string): boolean {
  if (!/^src\/web\//.test(file)) return false
  if (file === 'src/web/tokens.css') return false
  return /\.(?:svelte|vue|tsx|jsx|css|scss)$/.test(file)
}

function isSurfacePath(file: string): boolean {
  return /(?:^src\/web\/surfaces\/|\/routes\/|\/pages\/|Tab\.svelte$)/.test(file)
}

function componentNameFromPath(file: string): string {
  return path.basename(file).replace(/\.(?:svelte|vue|tsx|jsx)$/, '')
}
