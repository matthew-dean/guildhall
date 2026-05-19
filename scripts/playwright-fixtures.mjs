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
  taskCount,
  withQuestion = false,
}) {
  const projectPath = join(projectsRoot, id)
  const memoryDir = join(projectPath, 'memory')
  await mkdir(memoryDir, { recursive: true })
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
  await writeFile(join(memoryDir, 'MEMORY.md'), `# ${name} Memory\n`, 'utf8')
  await writeFile(join(memoryDir, 'DECISIONS.md'), `# ${name} Decisions\n`, 'utf8')
  await writeFile(join(memoryDir, 'PROGRESS.md'), `# ${name} Progress\n`, 'utf8')
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `${id}-task-${index + 1}`,
    title: index === 0 ? 'Block menu / block side menu' : `Fixture task ${index + 1}`,
    description: 'Rendered UI fixture task.',
    domain: 'guildhall',
    projectPath,
    status: index === 0 ? 'spec_review' : 'ready',
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
  return projectPath
}

await rm(root, { recursive: true, force: true })
await mkdir(guildhallHome, { recursive: true })

const projects = [
  { id: 'looma-knit', name: 'Looma + Knit', taskCount: 8, withQuestion: true },
  { id: 'font-something', name: 'Font something', taskCount: 7 },
  { id: 'fair-labor-license', name: 'Fair Labor License', taskCount: 7 },
  { id: 'tiny-demo', name: 'Tiny demo', taskCount: 6 },
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
