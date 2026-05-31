#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.playwright-fixtures')
const home = join(root, 'home')
const guildhallHome = join(home, '.guildhall')
const projectsRoot = join(root, 'projects')

const now = '2026-05-18T00:00:00.000Z'

async function writeProject({
  id,
  name,
  statuses,
  withQuestion = false,
}) {
  const projectPath = join(projectsRoot, id)
  const memoryDir = join(projectPath, 'memory')
  const projectStateDir = join(projectPath, '.guildhall')
  await mkdir(memoryDir, { recursive: true })
  await mkdir(projectStateDir, { recursive: true })
  await mkdir(join(memoryDir, 'exploring'), { recursive: true })
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
  if (id === 'looma-knit') {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({ dependencies: { svelte: '^5.0.0' } }, null, 2),
      'utf8',
    )
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
  const tasks = statuses.map((status, index) => ({
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
  await writeFile(join(memoryDir, 'TASKS.json'), JSON.stringify(tasks, null, 2), 'utf8')
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
  return projectPath
}

await rm(root, { recursive: true, force: true })
await mkdir(guildhallHome, { recursive: true })

const projects = [
  {
    id: 'looma-knit',
    name: 'Looma + Knit',
    statuses: ['spec_review', 'exploring', 'in_progress', 'review', 'gate_check', 'done', 'done', 'shelved'],
    withQuestion: true,
  },
  {
    id: 'font-something',
    name: 'Font something',
    statuses: ['import_draft', 'import_draft', 'import_draft', 'done', 'shelved'],
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
    statuses: ['exploring', 'spec_review', 'review', 'done', 'shelved'],
  },
  {
    id: 'linecraft',
    name: 'Linecraft',
    statuses: ['in_progress', 'review', 'done', 'done'],
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
