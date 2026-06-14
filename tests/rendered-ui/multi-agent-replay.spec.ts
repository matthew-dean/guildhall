import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  auditReplayTargets,
  classifyRouteProbe,
  routeApiChecks,
} from '../../scripts/browser-route-proof.mjs'

const replayProjectIds = ['jess', 'commerce-project', 'looma-knit', 'narrative-harness', 'font-something']
const fixtureRoot = join(process.cwd(), '.playwright-fixtures')
const fixtureProjectsRoot = join(fixtureRoot, 'projects')
const fixtureGuildhallHome = join(fixtureRoot, 'home', '.guildhall')
const originalTaskFiles = new Map<string, string | null>()
let originalRegistry: string | null = null

const replayTaskAdditions: Record<string, Array<{
  id: string
  title: string
  status?: string
  spec?: string
  openQuestions?: Array<{ id: string, kind: string, prompt: string, choices: string[] }>
}>> = {
  jess: [{
    id: 'bc-jess-structural_review-8c11fc652d-2026-06-04T00-44-08-860Z',
    title: 'Review the project map',
    status: 'spec_review',
    spec: 'Fixture structural-review task for Jess owner input replay.',
    openQuestions: [{
      id: 'jess-structural-review-map',
      kind: 'choice',
      prompt: 'Review the project map',
      choices: ['Keep the current map', 'Revise the project map'],
    }],
  }, {
    id: 'jess-workspace-import',
    title: 'Review existing project work',
    status: 'import_draft',
  }],
  'commerce-project': [{
    id: 'thread-shape-the-first-spec',
    title: 'Shape the first spec',
    status: 'spec_review',
    spec: 'Fixture setup-pending thread task for Commerce Project.',
    openQuestions: [{
      id: 'commerce-first-spec',
      kind: 'choice',
      prompt: 'Shape the first spec',
      choices: ['Start from checkout flow', 'Start from order admin'],
    }],
  }],
  'looma-knit': [{
    id: 'task-import-1l0mr2r',
    title: 'Context menu',
    status: 'spec_review',
    spec: 'Fixture import task spec for the Context menu drawer replay.',
  }],
  'narrative-harness': [{
    id: 'coherence-reviewer-mvp',
    title: 'Build first coherence reviewer MVP',
    status: 'spec_review',
    spec: 'Fixture coherence reviewer MVP spec.',
  }, {
    id: 'decision-trace-pipeline',
    title: 'Build the decision trace pipeline',
    status: 'spec_review',
    spec: 'Fixture decision trace pipeline spec.',
  }, {
    id: 'task-009',
    title: 'Run task 009 story replay',
    status: 'spec_review',
    spec: 'Fixture task 009 story replay spec.',
  }],
  'font-something': [{
    id: 'import-api-serving-mvp',
    title: 'Serve the import API MVP',
    status: 'spec_review',
    spec: 'Fixture import API serving MVP task spec.',
  }],
}

function projectSystemStateDir(projectPath: string) {
  const resolved = resolve(projectPath)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return join(fixtureGuildhallHome, 'data', 'projects', `${basename(resolved) || 'root'}-${digest}`, 'project-state')
}

function replayTask(projectPath: string, input: typeof replayTaskAdditions[string][number]) {
  return {
    id: input.id,
    title: input.title,
    description: 'Rendered UI replay fixture task.',
    domain: 'guildhall',
    projectPath,
    status: input.status ?? 'spec_review',
    priority: 'normal',
    spec: input.spec ?? `Fixture spec for ${input.title}.`,
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
    ...(input.openQuestions ? { openQuestions: input.openQuestions } : {}),
  }
}

async function ensureReplayProject(projectId: string) {
  const projectPath = join(fixtureProjectsRoot, projectId)
  const memoryDir = join(projectPath, 'memory')
  const tasksPath = join(memoryDir, 'TASKS.json')
  let tasksText: string | null = null
  try {
    tasksText = await readFile(tasksPath, 'utf8')
  } catch {
    tasksText = null
  }
  originalTaskFiles.set(projectId, tasksText)
  await mkdir(memoryDir, { recursive: true })
  await mkdir(join(projectPath, '.guildhall'), { recursive: true })
  if (tasksText === null) {
    const name = projectId === 'jess' ? 'Jess' : 'Commerce Project'
    await writeFile(join(projectPath, 'guildhall.yaml'), [
      `name: ${name}`,
      `id: ${projectId}`,
      'coordinators:',
      '  - id: guildhall',
      '    name: Guildhall',
      '    domain: guildhall',
      '    mandate: Owns the replay fixture project surface.',
      '',
    ].join('\n'), 'utf8')
    await writeFile(join(memoryDir, 'MEMORY.md'), `# ${name} Memory\n`, 'utf8')
    await writeFile(join(memoryDir, 'DECISIONS.md'), `# ${name} Decisions\n`, 'utf8')
    await writeFile(join(memoryDir, 'PROGRESS.md'), `# ${name} Progress\n`, 'utf8')
  }
  const tasks = tasksText ? JSON.parse(tasksText) : []
  const existingIds = new Set(tasks.map((task: { id?: string }) => task.id).filter(Boolean))
  for (const task of replayTaskAdditions[projectId] ?? []) {
    if (!existingIds.has(task.id)) tasks.push(replayTask(projectPath, task))
  }
  const nextTasksText = `${JSON.stringify(tasks, null, 2)}\n`
  await writeFile(tasksPath, nextTasksText, 'utf8')
  const systemStateDir = projectSystemStateDir(projectPath)
  await mkdir(systemStateDir, { recursive: true })
  await writeFile(join(systemStateDir, 'TASKS.json'), nextTasksText, 'utf8')
}

async function ensureReplayRegistry() {
  const registryPath = join(fixtureGuildhallHome, 'registry.yaml')
  originalRegistry = await readFile(registryPath, 'utf8')
  const missingEntries = []
  for (const [projectId, name] of [['jess', 'Jess'], ['commerce-project', 'Commerce Project']] as const) {
    if (originalRegistry.includes(`id: ${projectId}`)) continue
    const projectPath = join(fixtureProjectsRoot, projectId)
    missingEntries.push(
      `  - id: ${projectId}`,
      `    path: ${projectPath}`,
      `    name: ${name}`,
      '    tags: []',
      "    registeredAt: '2026-05-18T00:00:00.000Z'",
    )
  }
  if (missingEntries.length > 0) {
    await writeFile(registryPath, `${originalRegistry.trimEnd()}\n${missingEntries.join('\n')}\n`, 'utf8')
  }
}

test.beforeAll(async () => {
  await ensureReplayRegistry()
  for (const projectId of replayProjectIds) {
    await ensureReplayProject(projectId)
  }
})

test.afterAll(async () => {
  if (originalRegistry !== null) {
    await writeFile(join(fixtureGuildhallHome, 'registry.yaml'), originalRegistry, 'utf8')
  }
  for (const projectId of replayProjectIds) {
    const projectPath = join(fixtureProjectsRoot, projectId)
    await rm(projectSystemStateDir(projectPath), { recursive: true, force: true })
    const originalTasks = originalTaskFiles.get(projectId)
    if (originalTasks === null) {
      await rm(projectPath, { recursive: true, force: true })
    } else if (typeof originalTasks === 'string') {
      await writeFile(join(projectPath, 'memory', 'TASKS.json'), originalTasks, 'utf8')
    }
  }
})

async function apiResultsForTarget(request: any, target: typeof auditReplayTargets[number]) {
  const results = []
  for (const check of routeApiChecks(target)) {
    const response = await request.get(check.path)
    results.push({ label: check.label, path: check.path, ok: response.ok(), status: response.status() })
  }
  return results
}

async function applyRequiredMigrations(page: any) {
  for (let index = 0; index < 6; index += 1) {
    if (await page.getByText('Needs migration').count() === 0) return
    const visibleMigrateButton = page.locator('button').filter({ hasText: 'Migrate' }).first()
    const hasVisibleMigrate = await visibleMigrateButton.count() > 0
    const migrateButton = hasVisibleMigrate
      ? visibleMigrateButton
      : page.getByRole('button', { name: 'Migrate project' }).first()
    if (!hasVisibleMigrate && !(await migrateButton.isEnabled())) return
    await expect(migrateButton).toBeEnabled()
    await migrateButton.click()
    await expect(page.getByRole('dialog', { name: 'Migrate project' })).toBeVisible()
    await page.getByRole('button', { name: 'Apply required migration' }).click()
    await expect(page.getByText('Migration applied.')).toBeVisible()
    await page.getByRole('dialog', { name: 'Migrate project' }).getByRole('button', { name: 'Close' }).last().click()
  }
}

async function hasVisibleRouteProof(page: any, label: string) {
  const textMatch = page.getByText(label, { exact: false }).first()
  if (await textMatch.isVisible().catch(() => false)) return true
  const ariaMatch = page.locator(`[aria-label="${label.replaceAll('"', '\\"')}"]`).first()
  return ariaMatch.isVisible().catch(() => false)
}

for (const target of auditReplayTargets) {
  test(`${target.name} replay target stays browser-capable`, async ({ page, request, baseURL }) => {
    const url = new URL(target.path, baseURL).toString()
    await page.goto(target.path, { waitUntil: 'domcontentloaded' })
    await applyRequiredMigrations(page)
    const navigation = await page.goto(target.path, { waitUntil: 'domcontentloaded' })
      .then(() => ({ ok: true }))
      .catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    const directResponse = await request.get(target.path)
    const apiChecks = await apiResultsForTarget(request, target)

    let dom = { ok: true, url: page.url(), bodyText: '' }
    for (const assertion of target.assertions) {
      const visible = await hasVisibleRouteProof(page, assertion)
      if (!visible) {
        dom = {
          ok: false,
          url: page.url(),
          bodyText: (await page.locator('body').textContent().catch(() => '')) ?? '',
          error: `Missing visible route proof: ${assertion}`,
        }
        break
      }
    }

    const classification = classifyRouteProbe({
      navigation,
      directHttp: { ok: directResponse.ok(), status: directResponse.status() },
      apiChecks,
      dom,
    })

    expect({
      target: target.name,
      url,
      currentUrl: page.url(),
      directHttp: { ok: directResponse.ok(), status: directResponse.status() },
      apiChecks,
      dom,
      classification,
    }).toMatchObject({
      classification: {
        classification: 'route_healthy',
        productRouteHealthy: true,
      },
    })
  })
}
