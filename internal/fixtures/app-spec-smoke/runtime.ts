export type PantryPulseWorkKind = 'app_spec' | 'feature_spec' | 'implementation' | 'verification' | 'handoff'

export interface PantryPulseWorkItem {
  id: string
  title: string
  kind: PantryPulseWorkKind
  parentId?: string
  status: 'done' | 'ready' | 'blocked'
  completionBoundary?: string
}

export type PantryPulseEvidenceKind =
  | 'command'
  | 'dev-server'
  | 'browser'
  | 'review'
  | 'gate'
  | 'handoff'
  | 'memory'
  | 'mcp'
  | 'design-foundation'
  | 'screenshot'
  | 'design-decision'
  | 'design-finding'

export interface PantryPulseEvidence {
  id: string
  kind: PantryPulseEvidenceKind
  summary: string
  ref: string
}

export interface PantryPulseBrowserProof {
  id: string
  assertion: string
  evidenceRef: string
}

export interface PantryPulseOwnerIntervention {
  prompt: string
  classification: 'necessary' | 'avoidable' | 'non-delegable'
  reason: string
}

export interface PantryPulseMcpAuditAnswer {
  question: string
  answerableWithoutShell: boolean
  resource: string
}

export interface PantryPulseDesignQualityAssessment {
  screenshotRefs: string[]
  domEvidence: string[]
  critiqueSummary: string
  appStoreCaliberGaps: string[]
  paletteTarget: PantryPulsePaletteTarget
  paletteTokenAudit: PantryPulsePaletteAudit
  specBoundaryRecovery: string
  designTasteInfluence: string
}

export interface PantryPulsePaletteTarget {
  mood: string
  base: string
  primaryFamilies: string[]
  accentFamilies: string[]
  statusFamilies: string[]
  avoidFamilies: string[]
}

export interface PantryPulsePaletteRole {
  name: string
  value: string
  hue: number
  saturation: number
  lightness: number
  family: string
}

export interface PantryPulsePaletteAudit {
  ok: boolean
  roles: PantryPulsePaletteRole[]
  primaryRole?: PantryPulsePaletteRole
  findings: string[]
}

export interface PantryPulseSmokeRun {
  appName: 'Pantry Pulse'
  fixturePath: string
  status: 'completed' | 'incomplete'
  hierarchy: PantryPulseWorkItem[]
  ownerInterventions: PantryPulseOwnerIntervention[]
  runtimeEvidence: PantryPulseEvidence[]
  designProof: PantryPulseEvidence[]
  designQualityAssessment: PantryPulseDesignQualityAssessment
  browserProof: PantryPulseBrowserProof[]
  reviewVerdicts: PantryPulseEvidence[]
  gateResults: PantryPulseEvidence[]
  completionHandoff: PantryPulseEvidence
  memoryCandidates: PantryPulseEvidence[]
  mcpAudit: {
    answers: PantryPulseMcpAuditAnswer[]
  }
  followUps: string[]
}

export interface ZeroInfoSpecIntakeRun {
  fixturePath: string
  startState: string
  roughIdea: string
  completionPoint: string
  appGoal: string
  firstFeature: string
  stackAssumption: string
  nonGoals: string[]
  proofPath: string
  firstRunnableWorkItem: string
  ownerInterventions: PantryPulseOwnerIntervention[]
}

export interface PantryPulseSmokeRunValidation {
  ok: boolean
  missing: string[]
}

export function buildPantryPulseSmokeRun(): PantryPulseSmokeRun {
  return {
    appName: 'Pantry Pulse',
    fixturePath: 'internal/fixtures/app-spec-smoke',
    status: 'completed',
    hierarchy: [
      work('app-spec', 'Pantry Pulse app spec', 'app_spec', undefined, 'done', 'All required child work is done and proof/handoff evidence exists.'),
      work('feature-list', 'Pantry item list feature', 'feature_spec', 'app-spec', 'done', 'Seeded item list, filter, used action, and count update are complete.'),
      work('data-model', 'Build seeded pantry data model', 'implementation', 'feature-list', 'done'),
      work('visual-state', 'Build item list and expiring-soon visual state', 'implementation', 'feature-list', 'done'),
      work('filter', 'Build all / expiring-soon filter', 'implementation', 'feature-list', 'done'),
      work('mark-used', 'Build Mark used interaction and count update', 'implementation', 'feature-list', 'done'),
      work('proof-root', 'Runtime proof and completion', 'verification', 'app-spec', 'done', 'Runtime commands, design proof, browser proof, review, gate, handoff, memory, and MCP audit exist.'),
      work('checks', 'Run automated unit/component checks', 'verification', 'proof-root', 'done'),
      work('server', 'Start runtime dev server', 'verification', 'proof-root', 'done'),
      work('design-proof', 'Record design proof and decision packet', 'verification', 'proof-root', 'done'),
      work('browser-proof', 'Browser-proof expiring-soon filter and Mark used flow', 'verification', 'proof-root', 'done'),
      work('handoff', 'Produce completion handoff', 'handoff', 'proof-root', 'done'),
    ],
    ownerInterventions: [
      {
        prompt: 'Confirm the app should stay local-only with seeded data and no accounts.',
        classification: 'necessary',
        reason: 'This confirms product boundary and non-goals without asking the owner to choose Guildhall process.',
      },
    ],
    runtimeEvidence: [
      evidence('install', 'command', 'Dependencies installed or verified.', 'runtime-command://pantry-pulse/install'),
      evidence('test', 'command', 'Automated checks passed.', 'runtime-command://pantry-pulse/test'),
      evidence('build', 'command', 'Production build passed.', 'runtime-command://pantry-pulse/build'),
      evidence('dev-server', 'dev-server', 'Runtime dev server started with host port mapping.', 'runtime-dev-server://pantry-pulse/5173'),
    ],
    designProof: [
      evidence('design-foundation', 'design-foundation', 'Portable Looma-compatible design foundation selected before implementation.', 'design-foundation://pantry-pulse/looma-portable'),
      evidence('desktop-screenshot', 'screenshot', 'Desktop rendered proof captured for Pantry Pulse.', 'screenshot://pantry-pulse/desktop'),
      evidence('mobile-screenshot', 'screenshot', 'Mobile rendered proof captured for Pantry Pulse.', 'screenshot://pantry-pulse/mobile'),
      evidence('control-semantics', 'design-decision', 'All/Expiring soon uses a segmented mutually-exclusive filter pattern instead of a command-looking toggle.', 'design-decision://pantry-pulse/control-semantics'),
      evidence('palette-rationale', 'design-decision', 'Palette rationale uses warm grocery/domestic roles with controlled saturation and accessible contrast.', 'design-decision://pantry-pulse/palette-rationale'),
      evidence('finding-classification', 'design-finding', 'Design finding classification recorded: project-specific pantry interaction plus reusable segmented-filter pattern candidate.', 'design-finding://pantry-pulse/reusable-vs-local'),
      evidence('decision-packet', 'design-decision', 'Accepted owner/design feedback compiled into a worker and reviewer decision packet.', 'design-decision-packet://pantry-pulse/final'),
    ],
    designQualityAssessment: {
      screenshotRefs: [
        'screenshot://pantry-pulse/desktop',
        'screenshot://pantry-pulse/mobile',
      ],
      domEvidence: [
        'Heading "Pantry Pulse" is visible.',
        'At least five pantry item cards render with category, quantity, and expiration data.',
        'The All / Expiring soon filter exposes a persistent selected mode.',
        'Mark used removes an item and updates the visible count.',
      ],
      critiqueSummary: 'Pantry Pulse should feel like a finished tiny utility: warm, calm, scannable, responsive, and deliberate in its filter and status semantics rather than a generic generated card grid.',
      appStoreCaliberGaps: [
        'Reject the run if screenshots show an unstyled scaffold, unclear selected filter state, weak hierarchy, or mobile crowding.',
        'Reject the run if expiring status relies on color alone or if the palette reads as one-note beige, purple, generic dark SaaS, or generic cool-blue utility UI.',
      ],
      paletteTarget: PANTRY_PULSE_PALETTE_TARGET,
      paletteTokenAudit: auditPantryPulsePaletteTokens([
        ':root {',
        '  --surface: #fbf7ee;',
        '  --accent: #6f8f4e;',
        '  --warn: #c9792b;',
        '  --danger: #b84a3a;',
        '}',
      ].join('\n')),
      specBoundaryRecovery: 'The fixed spec may be refined or split only when the resulting work still preserves the Pantry Pulse completion boundary and routes runnable implementation/proof work to a child item.',
      designTasteInfluence: 'The design foundation, segmented-control semantics, palette rationale, and reusable-vs-local finding classification must appear in worker/reviewer context or the run only proves functional completion.',
    },
    browserProof: [
      proof('open', 'The Pantry Pulse page opens.', 'browser-proof://pantry-pulse/open'),
      proof('seeded-items', 'At least five seeded pantry items are visible.', 'browser-proof://pantry-pulse/seeded-items'),
      proof('expiring-filter', 'The expiring-soon filter hides later items.', 'browser-proof://pantry-pulse/expiring-filter'),
      proof('mark-used', 'Mark used updates the visible count.', 'browser-proof://pantry-pulse/mark-used'),
    ],
    reviewVerdicts: [
      evidence('review', 'review', 'Reviewer approved product behavior, code quality, tests, and proof path.', 'review://pantry-pulse/final'),
      evidence('design-review', 'review', 'Design reviewer approved foundation, screenshots, control semantics, palette rationale, and reusable-vs-local finding classification.', 'review://pantry-pulse/design'),
    ],
    gateResults: [
      evidence('gate', 'gate', 'Gate checker approved commands, browser proof, and completion handoff.', 'gate://pantry-pulse/final'),
    ],
    completionHandoff: evidence('handoff', 'handoff', 'Handoff explains what shipped, how to launch, what was verified, out-of-scope work, residual risk, and evidence refs.', 'handoff://pantry-pulse/final'),
    memoryCandidates: [
      evidence('memory-default-stack', 'memory', 'When an empty local app has no stack preference, propose a runtime-compatible local web default before asking.', 'memory://pantry-pulse/default-stack'),
    ],
    mcpAudit: {
      answers: [
        mcp('What project is this?', 'guildhall://project'),
        mcp('What work hierarchy exists?', 'guildhall://project/tasks'),
        mcp('Which work items are active, blocked, ready, done, or hidden by default?', 'guildhall://project/tasks'),
        mcp('What runtime evidence exists?', 'guildhall://project/artifacts'),
        mcp('What feedback and decision packets should agents carry forward?', 'guildhall://project/feedback'),
        mcp('What proof path proves the app?', 'guildhall://project/artifacts'),
        mcp('What memory did Guildhall use or propose?', 'guildhall://project/memory'),
        mcp('What is the final completion handoff?', 'guildhall://project/artifacts'),
      ],
    },
    followUps: [],
  }
}

export function buildZeroInfoSpecIntakeRun(): ZeroInfoSpecIntakeRun {
  return {
    fixturePath: 'internal/fixtures/zero-info-spec-intake',
    startState: 'Empty directory with no source files, README, package.json, guildhall.yaml, or project history.',
    roughIdea: 'I want to build a tiny pantry tracker app, but I have not chosen a stack or written anything down yet.',
    completionPoint: 'reviewed initial app spec, hierarchy, first runnable work item, and proof path.',
    appGoal: 'Build a tiny local pantry tracker app.',
    firstFeature: 'Pantry item list feature.',
    stackAssumption: 'Use a runtime-compatible local web default before asking the owner to choose tooling.',
    nonGoals: ['Accounts', 'Remote persistence', 'Barcode scanning', 'Deployment'],
    proofPath: 'Open app, verify seeded items, filter expiring-soon items, mark one used, and confirm count update.',
    firstRunnableWorkItem: 'Scaffold minimal local web app shell.',
    ownerInterventions: [
      {
        prompt: 'Confirm whether local-only seeded data is acceptable for the first app spec.',
        classification: 'necessary',
        reason: 'This confirms product boundary rather than asking the owner to choose Guildhall process.',
      },
    ],
  }
}

export function validatePantryPulseSmokeRun(run: PantryPulseSmokeRun): PantryPulseSmokeRunValidation {
  const missing: string[] = []
  const titles = new Set(run.hierarchy.map(item => item.title))
  for (const title of EXPECTED_TITLES) {
    if (!titles.has(title)) missing.push(`Hierarchy is missing "${title}".`)
  }
  if (run.hierarchy.some(item => item.status !== 'done')) {
    missing.push('All required work items must be done or explicitly represented as deferred outside the recorded smoke run.')
  }
  if (!run.runtimeEvidence.some(evidence => evidence.kind === 'command')) {
    missing.push('Runtime command evidence is missing.')
  }
  if (!run.runtimeEvidence.some(evidence => evidence.kind === 'dev-server')) {
    missing.push('Runtime dev-server evidence is missing.')
  }
  if (!run.designProof.some(evidence => evidence.kind === 'design-foundation')) {
    missing.push('Design proof is missing the design foundation.')
  }
  const screenshots = new Set(run.designProof.filter(evidence => evidence.kind === 'screenshot').map(evidence => evidence.ref))
  if (!screenshots.has('screenshot://pantry-pulse/desktop') || !screenshots.has('screenshot://pantry-pulse/mobile')) {
    missing.push('Design proof is missing desktop and mobile screenshots.')
  }
  if (!run.designProof.some(evidence => /control semantics|segmented|mutually-exclusive/i.test(evidence.summary))) {
    missing.push('Design proof is missing correct control semantics rationale.')
  }
  if (!run.designProof.some(evidence => /palette rationale|controlled saturation|contrast/i.test(evidence.summary))) {
    missing.push('Design proof is missing palette rationale.')
  }
  if (!run.designProof.some(evidence => /project-specific|reusable/i.test(evidence.summary))) {
    missing.push('Design proof is missing reusable-vs-local design finding classification.')
  }
  if (!run.designProof.some(evidence => evidence.ref.startsWith('design-decision-packet://'))) {
    missing.push('Design proof is missing a design decision packet.')
  }
  if (run.designQualityAssessment.screenshotRefs.length < 2) {
    missing.push('Design assessment is missing desktop and mobile screenshot refs.')
  }
  if (run.designQualityAssessment.domEvidence.length === 0) {
    missing.push('Design assessment is missing DOM evidence.')
  }
  if (!run.designQualityAssessment.critiqueSummary.trim()) {
    missing.push('Design assessment is missing a critique summary.')
  }
  if (run.designQualityAssessment.appStoreCaliberGaps.length === 0) {
    missing.push('Design assessment is missing app-store-caliber gaps.')
  }
  if (!run.designQualityAssessment.appStoreCaliberGaps.some(gap => /cool-blue|generic blue|medical blue/i.test(gap))) {
    missing.push('Design assessment must explicitly reject generic cool-blue Pantry Pulse palettes.')
  }
  if (!run.designQualityAssessment.paletteTarget.primaryFamilies.some(family => /sage|leaf|amber/i.test(family))) {
    missing.push('Design assessment palette target is missing Pantry Pulse primary hue families.')
  }
  if (!run.designQualityAssessment.paletteTokenAudit.ok) {
    missing.push(`Design palette token audit failed: ${run.designQualityAssessment.paletteTokenAudit.findings.join(' ')}`)
  }
  if (!/boundary|recovered|preserves/i.test(run.designQualityAssessment.specBoundaryRecovery)) {
    missing.push('Design assessment is missing spec-boundary recovery analysis.')
  }
  if (!/taste|design foundation|segmented|palette|reviewer/i.test(run.designQualityAssessment.designTasteInfluence)) {
    missing.push('Design assessment is missing design-taste influence analysis.')
  }
  if (!run.browserProof.some(proof => proof.assertion.includes('Pantry Pulse'))) {
    missing.push('Browser proof is missing the app-open check.')
  }
  if (!run.browserProof.some(proof => proof.assertion.includes('expiring-soon filter'))) {
    missing.push('Browser proof is missing the expiring-soon filter.')
  }
  if (!run.browserProof.some(proof => proof.assertion.includes('Mark used') && proof.assertion.includes('count'))) {
    missing.push('Browser proof is missing the Mark used count-update flow.')
  }
  if (run.reviewVerdicts.length === 0) missing.push('Review verdict is missing.')
  if (!run.reviewVerdicts.some(evidence => /design reviewer approved/i.test(evidence.summary))) {
    missing.push('Design reviewer approval is missing.')
  }
  if (run.gateResults.length === 0) missing.push('Gate result is missing.')
  if (!run.completionHandoff?.ref) missing.push('Completion handoff is missing.')
  if (run.memoryCandidates.length === 0) missing.push('Memory candidate evidence is missing.')
  if (run.mcpAudit.answers.length === 0 || run.mcpAudit.answers.some(answer => !answer.answerableWithoutShell)) {
    missing.push('MCP/context audit must answer every required question without shell fallback.')
  }
  if (run.ownerInterventions.some(intervention => intervention.classification === 'avoidable')) {
    missing.push('Recorded smoke run still contains avoidable owner intervention.')
  }
  return { ok: missing.length === 0, missing }
}

export function validateZeroInfoSpecIntakeRun(run: ZeroInfoSpecIntakeRun): PantryPulseSmokeRunValidation {
  const missing: string[] = []
  if (!run.completionPoint.includes('reviewed initial app spec')) {
    missing.push('Zero-information run is missing the reviewed initial app spec completion point.')
  }
  if (!run.appGoal.trim()) missing.push('Zero-information run is missing the app goal.')
  if (!run.firstFeature.trim()) missing.push('Zero-information run is missing the first feature.')
  if (!run.stackAssumption.trim()) missing.push('Zero-information run is missing a stack/tooling assumption or default.')
  if (run.nonGoals.length === 0) missing.push('Zero-information run is missing non-goals.')
  if (!run.proofPath.trim()) missing.push('Zero-information run is missing the proof path.')
  if (!run.firstRunnableWorkItem.trim()) missing.push('Zero-information run is missing the first runnable work item.')
  if (run.ownerInterventions.some(intervention => intervention.classification === 'avoidable')) {
    missing.push('Zero-information run still contains avoidable owner intervention.')
  }
  if (run.ownerInterventions.some(intervention => /process path|parent task|containing work versus task/i.test(intervention.prompt))) {
    missing.push('Zero-information run asks the owner to choose a Guildhall process path.')
  }
  return { ok: missing.length === 0, missing }
}

const EXPECTED_TITLES = [
  'Pantry Pulse app spec',
  'Pantry item list feature',
  'Build seeded pantry data model',
  'Build item list and expiring-soon visual state',
  'Build all / expiring-soon filter',
  'Build Mark used interaction and count update',
  'Runtime proof and completion',
  'Run automated unit/component checks',
  'Start runtime dev server',
  'Record design proof and decision packet',
  'Browser-proof expiring-soon filter and Mark used flow',
  'Produce completion handoff',
]

export const PANTRY_PULSE_PALETTE_TARGET: PantryPulsePaletteTarget = {
  mood: 'fresh, calm, household-friendly, confident, lightly warm',
  base: 'warm off-white or soft neutral, not gray-blue and not beige-only',
  primaryFamilies: ['sage', 'leaf-green', 'warm-amber'],
  accentFamilies: ['citrus', 'tomato-coral'],
  statusFamilies: ['warning-amber', 'danger-coral'],
  avoidFamilies: ['generic cool-blue', 'medical blue', 'gray-only utility', 'purple gradient', 'rustic brown-only', 'grocery-cart green overload'],
}

export function auditPantryPulsePaletteTokens(tokenText: string): PantryPulsePaletteAudit {
  const roles = parsePaletteTokenRoles(tokenText)
  const findings: string[] = []
  const primaryRole = selectPrimaryPaletteRole(roles)

  if (!primaryRole) {
    findings.push('Missing inspectable primary/accent palette token for Pantry Pulse design proof.')
  } else if (primaryRole.family === 'cool-blue') {
    findings.push(`Token ${primaryRole.name}=${primaryRole.value} reads as generic cool-blue, which conflicts with Pantry Pulse's warm domestic food mood.`)
  } else if (!['sage', 'leaf-green', 'warm-amber', 'citrus', 'tomato-coral'].includes(primaryRole.family)) {
    findings.push(`Token ${primaryRole.name}=${primaryRole.value} is ${primaryRole.family}, not one of Pantry Pulse's expected sage, leaf-green, warm-amber, citrus, or tomato-coral families.`)
  }

  const surfaceRole = roles.find(role => /surface|background|bg/i.test(role.name))
  if (surfaceRole && surfaceRole.family === 'cool-blue' && surfaceRole.saturation >= 8) {
    findings.push(`Surface token ${surfaceRole.name}=${surfaceRole.value} leans cool-blue instead of warm off-white or soft neutral.`)
  }

  const warningRole = roles.find(role => /warn|warning|soon|expiry|expir/i.test(role.name))
  if (warningRole && !['warm-amber', 'tomato-coral'].includes(warningRole.family)) {
    findings.push(`Warning token ${warningRole.name}=${warningRole.value} should stay in amber/coral status territory for expiring pantry items.`)
  }

  return { ok: findings.length === 0, roles, ...(primaryRole ? { primaryRole } : {}), findings }
}

function parsePaletteTokenRoles(tokenText: string): PantryPulsePaletteRole[] {
  const roles: PantryPulsePaletteRole[] = []
  const seen = new Set<string>()
  const tokenPatterns = [
    /(--[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
    /(\$[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
    /(@[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
    /['"]?([a-z0-9_-]*(?:surface|background|bg|primary|brand|accent|cta|action|warn|warning|soon|expiry|danger)[a-z0-9_-]*)['"]?\s*:\s*['"](#[0-9a-f]{3,8})['"]/gi,
    /([a-z0-9_-]*(?:surface|background|bg|primary|brand|accent|cta|action|warn|warning|soon|expiry|danger)[a-z0-9_-]*)\s*=\s*['"](#[0-9a-f]{3,8})['"]/gi,
  ]
  for (const pattern of tokenPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(tokenText)) !== null) {
      const name = match[1]
      const value = match[2]
      if (!name || !value) continue
      const key = `${name}:${value}`.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const rgb = parseHexColor(value)
      if (!rgb) continue
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
      roles.push({
        name,
        value,
        hue: Math.round(hsl.h),
        saturation: Math.round(hsl.s),
        lightness: Math.round(hsl.l),
        family: classifyPantryPulseHue(hsl.h, hsl.s, hsl.l),
      })
    }
  }
  return roles
}

function selectPrimaryPaletteRole(roles: PantryPulsePaletteRole[]): PantryPulsePaletteRole | undefined {
  const preferred = [
    /(?:^|[-_@$.])(primary|brand|accent|cta|action)$/i,
    /(?:^|[-_@$.])(primary|brand|accent|cta|action)(?:[-_]|$)/i,
  ]
  for (const pattern of preferred) {
    const found = roles.find(role => pattern.test(role.name) && role.saturation >= 10)
    if (found) return found
  }
  return roles.find(role => role.saturation >= 18 && role.lightness >= 20 && role.lightness <= 80)
}

function parseHexColor(value: string): { r: number; g: number; b: number } | undefined {
  const hex = value.replace('#', '')
  if (hex.length === 3) {
    const [r, g, b] = hex.split('')
    if (!r || !g || !b) return undefined
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    }
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    }
  }
  return undefined
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l: l * 100 }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) {
    h = 60 * (((gn - bn) / delta) % 6)
  } else if (max === gn) {
    h = 60 * ((bn - rn) / delta + 2)
  } else {
    h = 60 * ((rn - gn) / delta + 4)
  }
  return { h: h < 0 ? h + 360 : h, s: s * 100, l: l * 100 }
}

function classifyPantryPulseHue(hue: number, saturation: number, lightness: number): string {
  if (saturation < 8 && lightness > 88) return 'warm-off-white'
  if (saturation < 12) return 'neutral'
  if (hue >= 190 && hue <= 255) return 'cool-blue'
  if (hue >= 80 && hue <= 145) return hue <= 105 ? 'sage' : 'leaf-green'
  if (hue >= 36 && hue < 80) return hue >= 50 ? 'citrus' : 'warm-amber'
  if (hue >= 8 && hue < 36) return 'warm-amber'
  if (hue < 8 || hue >= 345) return 'tomato-coral'
  if (hue >= 255 && hue <= 310) return 'purple'
  return 'off-target'
}

function work(
  id: string,
  title: string,
  kind: PantryPulseWorkKind,
  parentId: string | undefined,
  status: PantryPulseWorkItem['status'],
  completionBoundary?: string,
): PantryPulseWorkItem {
  return { id, title, kind, ...(parentId ? { parentId } : {}), status, ...(completionBoundary ? { completionBoundary } : {}) }
}

function evidence(id: string, kind: PantryPulseEvidence['kind'], summary: string, ref: string): PantryPulseEvidence {
  return { id, kind, summary, ref }
}

function proof(id: string, assertion: string, evidenceRef: string): PantryPulseBrowserProof {
  return { id, assertion, evidenceRef }
}

function mcp(question: string, resource: string): PantryPulseMcpAuditAnswer {
  return { question, answerableWithoutShell: true, resource }
}
