#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const root = resolve('.playwright-fixtures')
const home = join(root, 'home')
const guildhallHome = join(home, '.guildhall')
const projectsRoot = join(root, 'projects')
const projectGraphRoot = join(guildhallHome, 'project-graph')

const now = '2026-05-18T00:00:00.000Z'
const execFileAsync = promisify(execFile)

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fixture'
}

function projectLocalHistoryDir(projectPath) {
  const resolved = resolve(projectPath)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return join(guildhallHome, 'data', 'projects', `${basename(resolved) || 'root'}-${digest}`)
}

async function markFixtureProjectStateMigrated(localHistoryDir) {
  await mkdir(join(localHistoryDir, 'migrations'), { recursive: true })
  await writeFile(
    join(localHistoryDir, 'migrations', 'migrations.json'),
    JSON.stringify({
      version: 1,
      records: [{
        id: '0.10.0/project-state-storage-boundary',
        introducedIn: '0.10.0',
        scope: 'project',
        safety: 'prompt',
        status: 'applied',
        appliedAt: now,
        appliedByVersion: '0.10.0',
        summary: 'Fixture is already seeded in managed project state.',
        affectedPaths: ['memory/'],
      }],
    }, null, 2),
    'utf8',
  )
}

async function writeProject({
  id,
  name,
  statuses = [],
  withQuestion = false,
  files = [],
  initialized = true,
  tasks: explicitTasks,
  taskQueue,
  taskQueueMigrated = true,
  capabilityRequests = [],
  dirtyGuildhallFile = false,
}) {
  const projectPath = join(projectsRoot, id)
  const memoryDir = join(projectPath, 'memory')
  const projectStateDir = join(projectPath, '.guildhall')
  await mkdir(memoryDir, { recursive: true })
  await mkdir(projectStateDir, { recursive: true })
  await mkdir(join(memoryDir, 'exploring'), { recursive: true })
  if (initialized) {
    await writeFile(
      join(projectPath, 'guildhall.yaml'),
      [
        `name: ${name}`,
        `id: ${id}`,
        'coordinators:',
        '  - id: guildhall',
        '    name: Guildhall',
        '    domain: guildhall',
        '    mandate: Owns the fixture project surface.',
        '',
      ].join('\n'),
      'utf8',
    )
  } else {
    await writeFile(join(projectPath, 'README.md'), `# ${name}\n\nSetup is intentionally pending.\n`, 'utf8')
  }
  if (id === 'looma-knit') {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({ dependencies: { svelte: '^5.0.0' } }, null, 2),
      'utf8',
    )
  }
  for (const file of files) {
    await mkdir(join(projectPath, file.dir ?? ''), { recursive: true })
    await writeFile(join(projectPath, file.path), file.content, 'utf8')
  }
  await writeFile(join(memoryDir, 'MEMORY.md'), `# ${name} Memory\n`, 'utf8')
  await writeFile(join(memoryDir, 'DECISIONS.md'), `# ${name} Decisions\n`, 'utf8')
  await writeFile(join(memoryDir, 'PROGRESS.md'), `# ${name} Progress\n`, 'utf8')
  const statusTitle = {
    blocked: 'Resolve the release checklist blocker',
    done: 'Publish the project brief',
    exploring: 'Shape the next product slice',
    gate_check: 'Verify the UI regression suite',
    import_draft: 'Review imported workspace note',
    in_progress: 'Implement the editor outline flow',
    ready: 'Wire the next task lane',
    review: 'Review the workspace import polish',
    shelved: 'Archive duplicate planning note',
    spec_review: 'Block menu / block side menu',
  }
  const tasks = explicitTasks ?? statuses.map((status, index) => ({
    id: `${id}-task-${index + 1}`,
    title: index === 0 ? (statusTitle[status] ?? 'Fixture task') : `${statusTitle[status] ?? 'Fixture task'} ${index + 1}`,
    description: 'Rendered UI fixture task.',
    domain: 'guildhall',
    projectPath,
    status,
    priority: 'normal',
    spec: 'Fixture spec for rendered UI coverage.',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    ...(withQuestion && index === 0
      ? {
          openQuestions: [
            {
              id: `${id}-question-1`,
              kind: 'choice',
              prompt: 'Which controls belong in the link editor?',
              choices: [
                'URL input + Display text input',
                'URL input + Display text + Open in new tab',
                'URL input + Display text + Open in new tab + No follow',
                'URL input + Display text + Preview + Remove link',
                'URL input only (minimal)',
              ],
            },
          ],
        }
      : {}),
  }))
  const persistedTasks = taskQueue ?? tasks
  await writeFile(join(memoryDir, 'TASKS.json'), JSON.stringify(persistedTasks, null, 2), 'utf8')
  if (taskQueue && taskQueueMigrated) {
    const localHistoryDir = projectLocalHistoryDir(projectPath)
    const managedStateDir = join(localHistoryDir, 'project-state')
    await mkdir(managedStateDir, { recursive: true })
    await writeFile(join(managedStateDir, 'TASKS.json'), JSON.stringify(taskQueue, null, 2), 'utf8')
    await markFixtureProjectStateMigrated(localHistoryDir)
  }
  if (id === 'capability-boundary') {
    const localHistoryDir = projectLocalHistoryDir(projectPath)
    const managedStateDir = join(localHistoryDir, 'project-state')
    await mkdir(managedStateDir, { recursive: true })
    await writeFile(join(managedStateDir, 'TASKS.json'), JSON.stringify({ version: 1, lastUpdated: now, tasks }, null, 2), 'utf8')
    await writeFile(join(managedStateDir, 'project-brief.md'), `${name} fixture covers owner approval for runtime capability requests.\n`, 'utf8')
    await writeFile(join(managedStateDir, 'workspace-goals.json'), JSON.stringify({ goals: [] }, null, 2), 'utf8')
    await writeFile(
      join(managedStateDir, 'wizards.yaml'),
      [
        'version: 1',
        'skipped:',
        '  onboard:',
        '    - provider',
        '    - bootstrap',
        'completedAt: {}',
        '',
      ].join('\n'),
      'utf8',
    )
    await markFixtureProjectStateMigrated(localHistoryDir)
  }
  if (capabilityRequests.length > 0) {
    await mkdir(join(memoryDir, 'capability-requests'), { recursive: true })
    await mkdir(join(projectStateDir, 'capability-requests'), { recursive: true })
    if (id === 'capability-boundary') {
      await mkdir(join(projectLocalHistoryDir(projectPath), 'project-state', 'capability-requests'), { recursive: true })
    }
    for (const request of capabilityRequests) {
      await writeFile(join(memoryDir, 'capability-requests', `${request.id}.json`), JSON.stringify(request, null, 2), 'utf8')
      await writeFile(join(projectStateDir, 'capability-requests', `${request.id}.json`), JSON.stringify(request, null, 2), 'utf8')
      if (id === 'capability-boundary') {
        await writeFile(
          join(projectLocalHistoryDir(projectPath), 'project-state', 'capability-requests', `${request.id}.json`),
          JSON.stringify(request, null, 2),
          'utf8',
        )
      }
    }
  }
  if (id === 'looma-knit') {
    await writeFile(
      join(projectStateDir, 'design-taste.yaml'),
      [
        'version: 1',
        'opinions:',
        '  visualDirection:',
        '    default: warm-functional-polish',
        '  interactionSemantics:',
        '    mutuallyExclusiveModes: segmented-control-or-tabs',
        '  paletteStrategy:',
        '    defaultMode: semantic-oklch-roles',
        '    saturationBudget: controlled',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(projectStateDir, 'design-stories.yaml'),
      [
        'version: 1',
        'stories:',
        '  - id: pantry-filter.default',
        '    componentIntent: segmented-filter',
        '    title: Pantry filter / Default',
        '    states: [default, selected]',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(projectStateDir, 'design-system.yaml'),
      [
        'version: 1',
        'revision: 1',
        'tokens:',
        '  color: []',
        '  spacing: []',
        '  typography: []',
        '  radius: []',
        '  shadow: []',
        'primitives:',
        '  - name: Segmented filter',
        '    usage: Mutually exclusive mode choices.',
        'copyVoice:',
        '  tone: warm',
        'a11y:',
        '  minContrastRatio: 4.5',
        '  focusOutlineRequired: true',
        '  keyboardRules: []',
        '  reducedMotionRespected: true',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(projectStateDir, 'design-feedback.json'),
      JSON.stringify({
        version: 1,
        findings: [],
        decisions: [],
        candidates: [],
        loomaImprovements: [],
        ownerFeedback: [{
          id: 'owner-show-all',
          summary: 'Show all should read as a filter choice.',
          target: {
            componentName: 'PantryFilter',
            selector: '[data-testid="show-all"]',
            viewport: 'desktop-1280',
          },
          sentiment: 'revise',
          rationaleTags: ['better-controls'],
          status: 'accepted',
          createdAt: now,
          updatedAt: now,
        }],
        decisionPackets: [{
          id: 'design-decision-packet-fixture',
          feedbackIds: ['owner-show-all'],
          decisionIds: [],
          summary: 'Accepted owner design feedback ready for implementation/review.',
          constraints: ['Show all should read as a filter choice.'],
          reviewChecklist: ['Verify better control semantics.'],
          workerContext: 'Accepted design feedback: Show all should read as a filter choice.',
          createdAt: now,
          updatedAt: now,
        }],
      }, null, 2),
      'utf8',
    )
  }
  if (dirtyGuildhallFile) {
    await execFileAsync('git', ['init'], { cwd: projectPath })
    await execFileAsync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: projectPath })
    await execFileAsync('git', ['config', 'user.name', 'Guildhall Fixture'], { cwd: projectPath })
    await execFileAsync('git', ['add', '.'], { cwd: projectPath })
    await execFileAsync('git', ['commit', '-m', 'seed fixture project'], { cwd: projectPath })
    await writeFile(join(projectStateDir, 'release-note.md'), 'unlanded Guildhall-owned fixture note\n', 'utf8')
  }
  return projectPath
}

function fixtureTask(projectPath, input) {
  return {
    id: input.id,
    title: input.title,
    description: input.description ?? 'Rendered UI fixture task.',
    domain: input.domain ?? 'guildhall',
    projectPath,
    status: input.status,
    priority: input.priority ?? 'normal',
    spec: input.spec ?? 'Fixture spec for rendered UI coverage.',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: input.dependsOn ?? [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    ...(input.references ? { references: input.references } : {}),
    ...(input.releaseIds ? { releaseIds: input.releaseIds } : {}),
    ...(input.hierarchy ? { hierarchy: input.hierarchy } : {}),
  }
}

function narrativeHarnessReleaseQueue() {
  const projectPath = join(projectsRoot, 'narrative-harness')
  const releaseId = 'stage-1-fixture-and-evaluation-harness'
  const current = [
    ['task-import-9s8tkc', 'Define fixture, expected-record, prototype-run, and evaluation schemas.', 'spec_review'],
    ['task-import-dh34s5', 'Add the first tiny fiction fixture and human-authored expected records.', 'spec_review'],
    ['task-import-14yqvl7', 'Implement a no-UI runner that builds a packet from fixture records.', 'ready'],
    ['task-import-1isf6n0', 'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.', 'spec_review'],
    ['task-import-1nfemy6', 'Generate a developer-readable debug report for each run.', 'spec_review'],
    ['task-import-1v2ehs', 'Use the first run to narrow the MVP story-memory schema.', 'spec_review'],
  ].map(([id, title, status]) => fixtureTask(projectPath, {
    id,
    title,
    status,
    domain: 'harness',
    releaseIds: [releaseId],
    references: ['docs/harness/implementation-roadmap.md'],
  }))
  const laterTitles = [
    'manuscript import or simple editor shell',
    'project brief and author-provenance capture',
    'story-memory inspection views for traces, findings, and decisions',
    'askable retrieval interface for character, scene, reader-state, and world questions',
    'lightweight visualizations where they clarify the story state',
    'production data model and migrations',
    'sync/storage strategy',
    'subscription tier definitions',
    'provider usage accounting and quota controls',
    'audit logs for consent, AI context inclusion, and safety decisions',
    'export/import boundaries',
    'reliability and observability plan',
  ]
  const deferred = laterTitles.map((title, index) => fixtureTask(projectPath, {
    id: `task-import-later-${index + 1}`,
    title,
    status: 'shelved',
    domain: 'harness',
    spec: '',
    references: ['docs/harness/implementation-roadmap.md'],
  }))
  const child = fixtureTask(projectPath, {
    id: 'task-import-9s8tkc-split-shape-fixture-and-expected-record-ground-truth',
    title: 'Shape fixture and expected-record ground truth',
    status: 'exploring',
    domain: 'harness',
    spec: '',
    hierarchy: { parentId: 'task-import-9s8tkc', relation: 'child' },
  })

  return {
    version: 1,
    selectedReleaseId: releaseId,
    releases: [{
      id: releaseId,
      label: 'Stage 1: Fixture And Evaluation Harness',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: current.map(task => `work:${task.id}`),
      deferredNodeIds: deferred.map(task => `work:${task.id}`),
    }],
    tasks: [...current, ...deferred, child],
  }
}

function narrativeHarnessRoadmapDoc() {
  return [
    '# Implementation Roadmap',
    '',
    '## Stage 1: Fixture And Evaluation Harness',
    '',
    'Goal: build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
    '',
    'Deliverables:',
    '',
    '- fixture directory shape for at least one small story fixture',
    '- typed fixture and expected-record contracts',
    '- prototype run record contract',
    '',
    '## Current Next Milestone',
    '',
    'The next milestone is Stage 1: Fixture And Evaluation Harness.',
    '',
    'The first Guildhall starter tasks should be:',
    '',
    '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
    '2. Add the first tiny fiction fixture and human-authored expected records.',
    '3. Implement a no-UI runner that builds a packet from fixture records.',
    '4. Add deterministic evaluation output that reports missing, noisy, stale, and useful context.',
    '5. Generate a developer-readable debug report for each run.',
    '6. Use the first run to narrow the MVP story-memory schema.',
    '',
    'Stage 2 should wait until Stage 1 has enough fixture evidence to prove which records and packet fields are actually useful.',
  ].join('\n')
}

function narrativeHarnessInventoryDoc() {
  return [
    '# Remaining Spec Decomposition Inventory',
    '',
    '### 2.2 `dialogue-and-character-voice.md`',
    '',
    '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
    '- **Recommended domain:** coherence',
    '- **Stage alignment:** Stage 2 (Agent Coordination)',
    '',
    '### 2.7 `scene-and-chapter-intelligence.md`',
    '',
    '- **Recommended first task title:** Implement scene-and-chapter-intelligence reviewer lane',
    '- **Recommended domain:** coherence',
    '- **Stage alignment:** Stage 2 (Agent Coordination)',
  ].join('\n')
}

function loomaKnitReleaseQueue() {
  const projectPath = join(projectsRoot, 'looma-knit')
  const releaseId = 'stage-1-v1-release-hardening'
  const current = [
    ['task-knit-unit-tests', 'Unit tests: use-collections, use-presence, subdomain utils', 'spec_review'],
    ['task-knit-e2e-smoke', 'E2E tests: login -> create page -> edit -> search flow', 'spec_review'],
    ['task-knit-db-types', 'TypeScript: generate proper types from Supabase (pnpm db:types)', 'ready'],
    ['task-knit-mobile-sanity', 'Mobile: test on real device (Safari iOS, Chrome Android)', 'spec_review'],
    ['task-knit-invite-flow', 'Proper invite flow (Supabase Auth invite by email)', 'spec_review'],
  ].map(([id, title, status]) => fixtureTask(projectPath, {
    id,
    title,
    status,
    domain: 'knit',
    releaseIds: [releaseId],
    references: ['knit/docs/release-plan.md', 'knit/PROJECT_STATE.md'],
  }))
  const later = [
    ['task-knit-stage-2-looma-primitive-convergence', 'Looma Primitive Convergence', 'knit/docs/release-plan.md'],
    ['task-knit-stage-3-looma-editor-integration', 'Looma Editor Integration', 'knit/docs/release-plan.md'],
    ['task-knit-stage-4-launch-readiness', 'Launch Readiness And V2 Cut Line', 'knit/docs/release-plan.md'],
    ['task-looma-listbox', 'Listbox', 'looma/docs/component-roadmap.md'],
    ['task-looma-combobox', 'Combobox after select/listbox baseline is stable', 'looma/docs/component-roadmap.md'],
    ['task-looma-block-menu', 'EditorBlockMenu / block side menu', 'looma/docs/component-roadmap.md'],
    ['task-looma-floating-toolbar', 'EditorFloatingToolbar', 'looma/docs/component-roadmap.md'],
    ['task-looma-link-editor', 'EditorLinkEditor / link popover', 'looma/docs/component-roadmap.md'],
  ].map(([id, title, reference]) => fixtureTask(projectPath, {
    id,
    title,
    status: 'shelved',
    domain: id.startsWith('task-looma') ? 'looma' : 'knit',
    spec: '',
    references: [reference],
  }))

  return {
    version: 1,
    selectedReleaseId: releaseId,
    releases: [{
      id: releaseId,
      label: 'Stage 1: V1 Release Hardening',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: current.map(task => `work:${task.id}`),
      deferredNodeIds: later.map(task => `work:${task.id}`),
    }],
    tasks: [...current, ...later],
  }
}

function projectRef(id, label, projectPath) {
  return {
    id: `local-project:${id}`,
    type: 'local_guildhall_project',
    label,
    path: projectPath,
    pathFingerprint: resolve(projectPath).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase(),
    lastSeenAt: now,
  }
}

async function writeProjectGraphFixtures(entries) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const consumer = byId.get('consumer-app')
  const provider = byId.get('provider-library')
  if (!consumer || !provider) return

  await mkdir(join(projectGraphRoot, 'edges'), { recursive: true })
  await mkdir(join(projectGraphRoot, 'contract-surfaces'), { recursive: true })
  const edge = {
    id: 'edge-consumer-provider-launch-window',
    stateMachine: {
      id: 'project-dependency-edge',
      version: 1,
      state: 'submitted',
    },
    consumer: { id: consumer.id, label: consumer.name, path: consumer.path },
    provider: { id: provider.id, label: provider.name, path: provider.path },
    domain: { id: 'domain:launch-window', label: 'Launch window' },
    consumerNeed: 'Consumer App needs launch-window math from Provider Library.',
    rationale: 'The consumer product should not duplicate provider-owned launch-window rules.',
    expectedDelivery: {
      format: 'versioned package API',
      channel: 'local package',
      deliveryChannel: {
        kind: 'package_manager',
        label: 'Provider package',
        coordinates: '@fixture/provider-library#launch-window',
      },
      providerProofPlan: ['Provider unit coverage for window boundaries.'],
      consumerVerificationPlan: ['Consumer integration fixture imports the provider API.'],
    },
    deliveryReceipts: [],
    returnPackets: [],
    communicationRecords: [{
      id: 'comm-edge-consumer-provider-launch-window-1',
      kind: 'consumer_request',
      edgeId: 'edge-consumer-provider-launch-window',
      fromProject: { id: consumer.id, label: consumer.name, path: consumer.path },
      toProject: { id: provider.id, label: provider.name, path: provider.path },
      coordinatorContext: {
        projectId: consumer.id,
        coordinatorId: 'guildhall',
        summary: 'Consumer requested provider-owned launch-window behavior.',
        evidenceRefs: ['fixture:project-graph'],
      },
      payload: {},
      recordedBy: 'fixture',
      recordedAt: now,
    }],
    transitionReceipts: [{
      machineId: 'project-dependency-edge',
      machineVersion: 1,
      entityId: 'edge-consumer-provider-launch-window',
      from: 'draft',
      event: 'submit',
      to: 'submitted',
      actor: 'fixture',
      evidenceRefs: ['fixture:project-graph'],
      createdAt: now,
    }],
    evidenceRefs: [`project:${consumer.id}`, `project:${provider.id}`],
    createdAt: now,
    updatedAt: now,
  }
  const surface = {
    id: 'surface.launch-window-math-crate',
    label: 'Launch-window math crate API',
    kind: 'component_api',
    owningProject: { id: provider.id, label: provider.name, path: provider.path },
    domain: { id: 'domain:launch-window', label: 'Launch window' },
    authority: 'provider',
    scope: 'workspace',
    sourceRefs: [{
      kind: 'project_graph',
      path: 'fixtures/provider-library/src/launch-window.ts',
      summary: 'Provider-owned launch-window API fixture.',
    }],
    consumerRefs: [{ id: consumer.id, label: consumer.name, path: consumer.path }],
    invariants: [{
      id: 'invariant.launch-window-boundaries',
      label: 'Boundary math is provider-owned',
      rule: 'Consumers import the provider API instead of copying launch-window calculations.',
      proofObligations: ['Provider unit tests cover start/end boundaries.'],
    }],
    decisions: [],
    stateMachine: { id: 'contract-surface', version: 1, state: 'proposed' },
    transitionReceipts: [],
    createdAt: now,
    updatedAt: now,
  }
  const surfaceSummary = {
    id: surface.id,
    nodeId: `contract-surface:${surface.id}`,
    label: surface.label,
    kind: surface.kind,
    authority: surface.authority,
    scope: surface.scope,
    state: surface.stateMachine.state,
    owningProjectId: provider.id,
    owningProjectLabel: provider.name,
    domainId: surface.domain.id,
    domainLabel: surface.domain.label,
    consumerCount: surface.consumerRefs.length,
    invariantCount: surface.invariants.length,
    decisionCount: surface.decisions.length,
    updatedAt: surface.updatedAt,
  }
  await writeFile(join(projectGraphRoot, 'edges', `${edge.id}.json`), JSON.stringify(edge, null, 2), 'utf8')
  await writeFile(join(projectGraphRoot, 'contract-surfaces', `${slugify(surface.id)}.json`), JSON.stringify(surface, null, 2), 'utf8')
  await writeFile(
    join(projectGraphRoot, 'registry.json'),
    JSON.stringify({
      version: 1,
      updatedAt: now,
      projects: entries.map(entry => projectRef(entry.id, entry.name, entry.path)),
      domainAuthorities: [],
      domainResponsibilities: [],
      contractSurfaces: [surfaceSummary],
      edges: [{
        id: edge.id,
        type: 'requests_from',
        state: edge.stateMachine.state,
        consumerProjectId: consumer.id,
        providerProjectId: provider.id,
        updatedAt: now,
      }],
    }, null, 2),
    'utf8',
  )
}

await rm(root, { recursive: true, force: true })
await mkdir(guildhallHome, { recursive: true })

const projects = [
  {
    id: 'looma-knit',
    name: 'Looma + Knit',
    statuses: ['spec_review', 'exploring', 'in_progress', 'review', 'gate_check', 'done', 'done', 'shelved'],
    withQuestion: true,
    taskQueue: loomaKnitReleaseQueue(),
    taskQueueMigrated: false,
  },
  {
    id: 'font-something',
    name: 'Font something',
    statuses: ['import_draft', 'import_draft', 'import_draft', 'done', 'shelved'],
  },
  {
    id: 'jess',
    name: 'Jess',
    tasks: [
      {
        id: 'bc-jess-structural_review-8c11fc652d-2026-06-04T00-44-08-860Z',
        title: 'Review the project map',
        description: 'Rendered UI replay fixture task.',
        domain: 'guildhall',
        projectPath: join(projectsRoot, 'jess'),
        status: 'spec_review',
        priority: 'normal',
        spec: 'Fixture structural-review task for Jess owner input replay.',
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        revisionCount: 0,
        remediationAttempts: 0,
        escalations: [],
        agentIssues: [],
        origination: 'human',
        openQuestions: [{
          id: 'jess-structural-review-map',
          kind: 'choice',
          prompt: 'Review the project map',
          choices: ['Keep the current map', 'Revise the project map'],
        }],
      },
      {
        id: 'jess-workspace-import',
        title: 'Review existing project work',
        description: 'Rendered UI replay fixture task.',
        domain: 'guildhall',
        projectPath: join(projectsRoot, 'jess'),
        status: 'import_draft',
        priority: 'normal',
        spec: 'Fixture workspace import task for Jess replay.',
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        revisionCount: 0,
        remediationAttempts: 0,
        escalations: [],
        agentIssues: [],
        origination: 'human',
      },
    ],
  },
  {
    id: 'commerce-project',
    name: 'Commerce Project',
    tasks: [{
      id: 'thread-shape-the-first-spec',
      title: 'Shape the first spec',
      description: 'Rendered UI replay fixture task.',
      domain: 'guildhall',
      projectPath: join(projectsRoot, 'commerce-project'),
      status: 'spec_review',
      priority: 'normal',
      spec: 'Fixture setup-pending thread task for Commerce Project.',
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      revisionCount: 0,
      remediationAttempts: 0,
      escalations: [],
      agentIssues: [],
      origination: 'human',
      openQuestions: [{
        id: 'commerce-first-spec',
        kind: 'choice',
        prompt: 'Shape the first spec',
        choices: ['Start from checkout flow', 'Start from order admin'],
      }],
    }],
  },
  {
    id: 'fair-labor-license',
    name: 'Fair Labor License',
    statuses: ['done', 'done', 'done', 'done', 'shelved'],
  },
  {
    id: 'tiny-demo',
    name: 'Tiny demo',
    statuses: ['blocked', 'exploring', 'done'],
  },
  {
    id: 'narrative-harness',
    name: 'Narrative Harness',
    taskQueue: narrativeHarnessReleaseQueue(),
    files: [
      {
        dir: 'docs/harness',
        path: 'docs/harness/implementation-roadmap.md',
        content: narrativeHarnessRoadmapDoc(),
      },
      {
        dir: 'docs/harness',
        path: 'docs/harness/remaining-spec-decomposition-inventory.md',
        content: narrativeHarnessInventoryDoc(),
      },
    ],
  },
  {
    id: 'linecraft',
    name: 'Linecraft',
    statuses: ['in_progress', 'review', 'done', 'done'],
  },
  {
    id: 'docs-compass',
    name: 'Docs Compass',
    statuses: ['ready', 'done'],
    files: [
      {
        path: 'README.md',
        content: '# Docs Compass\n\nA docs-only project with no runtime package.\n',
      },
      {
        dir: 'docs',
        path: 'docs/navigation.md',
        content: '# Navigation\n\nInformation architecture notes.\n',
      },
    ],
  },
  {
    id: 'pipeline-ops',
    name: 'Pipeline Ops',
    statuses: ['blocked', 'review', 'done'],
    files: [
      {
        path: 'main.tf',
        content: 'resource "null_resource" "release_gate" {}\n',
      },
    ],
  },
  {
    id: 'mobile-kit',
    name: 'Mobile Kit',
    statuses: ['spec_review', 'review', 'done'],
    files: [
      {
        path: 'Package.swift',
        content: '// swift-tools-version: 5.10\nimport PackageDescription\n',
      },
    ],
  },
  {
    id: 'api-broker',
    name: 'API Broker',
    statuses: ['in_progress', 'blocked', 'done'],
    files: [
      {
        path: 'go.mod',
        content: 'module example.com/api-broker\n\ngo 1.22\n',
      },
    ],
  },
  {
    id: 'scratch-setup-pending',
    name: 'Scratch Setup Pending',
    initialized: false,
  },
  {
    id: 'dirty-service',
    name: 'Dirty Service',
    statuses: ['done'],
    dirtyGuildhallFile: true,
  },
  {
    id: 'consumer-app',
    name: 'Consumer App',
    statuses: ['in_progress', 'done'],
    files: [
      {
        dir: 'src',
        path: 'src/app.ts',
        content: 'export const consumer = true\n',
      },
    ],
  },
  {
    id: 'provider-library',
    name: 'Provider Library',
    statuses: ['ready', 'done'],
    files: [
      {
        dir: 'src',
        path: 'src/launch-window.ts',
        content: 'export function launchWindow() { return "provider-owned" }\n',
      },
    ],
  },
  {
    id: 'capability-boundary',
    name: 'Capability Boundary',
    tasks: [{
      id: 'capability-boundary-task-1',
      title: 'Inspect sibling packet fixture',
      description: 'Rendered UI fixture task with a capability boundary.',
      domain: 'guildhall',
      projectPath: join(projectsRoot, 'capability-boundary'),
      status: 'exploring',
      priority: 'normal',
      spec: 'Fixture spec for capability request coverage.',
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      revisionCount: 0,
      remediationAttempts: 0,
      escalations: [],
      agentIssues: [],
      origination: 'human',
      openQuestions: [{
        id: 'capability-boundary-question-1',
        kind: 'choice',
        prompt: 'Should Guildhall inspect the sibling fixture folder?',
        choices: ['Approve the folder', 'Use the committed snapshot'],
      }],
    }],
    capabilityRequests: [{
      id: 'cap-capability-boundary-task-1-fixture',
      taskId: 'capability-boundary-task-1',
      kind: 'mount_directory',
      requestedBy: 'runtime-command',
      reason: 'Capability Boundary needs read access to ../fixtures/packets.',
      duration: 'this task',
      fallback: 'Use the committed packet snapshot.',
      status: 'pending',
      requestedAt: now,
      mount: {
        hostPath: join(root, 'fixtures', 'packets'),
        containerPath: '/mnt/requested/packets',
        access: 'read-write',
      },
      transitionReceipts: [],
    }],
  },
]

const entries = []
for (const project of projects) {
  const projectPath = await writeProject(project)
  entries.push({
    id: project.id,
    path: projectPath,
    name: project.name,
    tags: [],
    registeredAt: now,
  })
}
await writeProjectGraphFixtures(entries)

await writeFile(
  join(guildhallHome, 'registry.yaml'),
  [
    'version: 1',
    'workspaces:',
    ...entries.flatMap((entry) => [
      `  - id: ${entry.id}`,
      `    path: ${entry.path}`,
      `    name: ${entry.name}`,
      '    tags: []',
      `    registeredAt: '${entry.registeredAt}'`,
    ]),
    '',
  ].join('\n'),
  'utf8',
)
