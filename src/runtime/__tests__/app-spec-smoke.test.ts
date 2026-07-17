import http from 'node:http'
import { readFile, rm, mkdtemp, mkdir, writeFile, readdir, stat } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { chromium, expect as pwExpect } from '@playwright/test'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapWorkspace, resolveConfig, updateProjectConfig } from '@guildhall/config'
import { TaskQueue, type Task, type TaskStatus } from '@guildhall/core'

import {
  auditPantryPulsePaletteTokens,
  buildZeroInfoSpecIntakeRun,
  buildPantryPulseSmokeRun,
  validateZeroInfoSpecIntakeRun,
  validatePantryPulseSmokeRun,
} from '../../../internal/fixtures/app-spec-smoke/runtime.js'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
} from '../intake.js'
import {
  Orchestrator,
  runOrchestrator,
  type OrchestratorAgentSet,
} from '../orchestrator.js'
import { InMemoryGitDriver } from '../git-driver.js'
import {
  getProjectStateDir,
  projectStatePathFromMemoryDir,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'
import { PermissionMode } from '@guildhall/engine'
import { buildEffectiveTask } from '../effective-task.js'
import { applyProjectMigrations } from '../migrations.js'
import {
  readProjectTaskQueueForMutationSync,
  readProjectTaskQueueSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
  writeProjectTaskQueueWithSummary,
} from '../project-state-boundary.js'

const fixtureDir = path.resolve('internal/fixtures/app-spec-smoke')
const zeroInfoFixtureDir = path.resolve('internal/fixtures/zero-info-spec-intake')
let cleanupDirs: string[] = []
const liveIt = process.env.GUILDHALL_LIVE_PANTRY_PROOF === '1' ? it : it.skip

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtureDir, name), 'utf-8')
}

async function zeroInfoFixture(name: string): Promise<string> {
  return readFile(path.join(zeroInfoFixtureDir, name), 'utf-8')
}

afterEach(async () => {
  if (process.env.GUILDHALL_PRESERVE_LIVE_PROOF === '1') return
  await Promise.all(cleanupDirs.map(dir => rm(dir, { recursive: true, force: true })))
  cleanupDirs = []
})

describe('Pantry Pulse app-spec smoke fixture', () => {
  it('defines the fixed product spec, completion boundary, hierarchy, proof checklist, and report template', async () => {
    const [spec, boundary, hierarchy, proof, reportTemplate, recordedRun] = await Promise.all([
      fixture('spec.md'),
      fixture('completion-boundary.md'),
      fixture('expected-hierarchy.md'),
      fixture('proof-checklist.md'),
      fixture('run-report-template.md'),
      fixture('recorded-run.md'),
    ])

    expect(spec).toContain('# Pantry Pulse App Spec')
    expect(spec).toContain('A page titled `Pantry Pulse`')
    expect(spec).toContain('at least five pantry items')
    expect(spec).toContain('`Mark used`')

    expect(boundary).toContain('all required child work is done or explicitly deferred with rationale')
    expect(boundary).toContain('runtime command evidence')
    expect(boundary).toContain('browser proof')
    expect(boundary).toContain('design foundation')
    expect(boundary).toContain('palette rationale')
    expect(boundary.toLowerCase()).toContain('generic cool-blue')
    expect(boundary).toContain('token audit')
    expect(boundary).toContain('reusable-vs-local design finding classification')
    expect(boundary).toContain('MCP/context audit')

    expect(hierarchy).toContain('Pantry Pulse app spec')
    expect(hierarchy).toContain('Pantry item list feature')
    expect(hierarchy).toContain('Build Mark used interaction and count update')
    expect(hierarchy).toContain('Record design proof and decision packet')
    expect(hierarchy).not.toMatch(/parent task/i)

    expect(proof).toContain('Start runtime dev server')
    expect(proof).toContain('Capture desktop and mobile screenshots')
    expect(proof).toContain('Record palette rationale')
    expect(proof).toContain('Audit actual palette tokens')
    expect(proof).toContain('Browser-proof expiring-soon filter')
    expect(proof).toContain('Produce completion handoff')

    expect(reportTemplate).toContain('Owner Interventions')
    expect(reportTemplate).toContain('Necessary')
    expect(reportTemplate).toContain('Avoidable')
    expect(reportTemplate).toContain('Non-delegable')

    expect(recordedRun).toContain('# Pantry Pulse Recorded Smoke Run')
    expect(recordedRun).toContain('Result: completion-boundary-satisfying recorded run')
    expect(recordedRun).toContain('runtime-dev-server://pantry-pulse/5173')
    expect(recordedRun).toContain('design-foundation://pantry-pulse/looma-portable')
    expect(recordedRun).toContain('design-decision-packet://pantry-pulse/final')
    expect(recordedRun).toContain('browser-proof://pantry-pulse/mark-used')
    expect(recordedRun).toContain('guildhall://project/feedback')
    expect(recordedRun).toContain('guildhall://project/memory')
  })

  it('records a completion-boundary-satisfying smoke run that future lifecycle automation can reproduce', () => {
    const run = buildPantryPulseSmokeRun()
    const result = validatePantryPulseSmokeRun(run)

    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(run.appName).toBe('Pantry Pulse')
    expect(run.hierarchy.map(item => item.title)).toEqual([
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
    ])
    expect(run.ownerInterventions.every(intervention => intervention.classification !== 'avoidable')).toBe(true)
    expect(run.runtimeEvidence.some(evidence => evidence.kind === 'dev-server')).toBe(true)
    expect(run.browserProof.map(proof => proof.assertion)).toEqual(
      expect.arrayContaining([
        'The Pantry Pulse page opens.',
        'The expiring-soon filter hides later items.',
        'Mark used updates the visible count.',
      ]),
    )
    expect(run.designProof.map(evidence => evidence.ref)).toEqual(expect.arrayContaining([
      'design-foundation://pantry-pulse/looma-portable',
      'screenshot://pantry-pulse/desktop',
      'screenshot://pantry-pulse/mobile',
      'design-decision-packet://pantry-pulse/final',
    ]))
    expect(run.designQualityAssessment.screenshotRefs).toEqual(expect.arrayContaining([
      'screenshot://pantry-pulse/desktop',
      'screenshot://pantry-pulse/mobile',
    ]))
    expect(run.designQualityAssessment.domEvidence).toEqual(expect.arrayContaining([
      'The All / Expiring soon filter exposes a persistent selected mode.',
      'Mark used removes an item and updates the visible count.',
    ]))
    expect(run.designQualityAssessment.critiqueSummary).toContain('finished tiny utility')
    expect(run.designQualityAssessment.appStoreCaliberGaps.join('\n')).toContain('unclear selected filter state')
    expect(run.designQualityAssessment.appStoreCaliberGaps.join('\n')).toContain('generic cool-blue')
    expect(run.designQualityAssessment.paletteTarget.primaryFamilies).toEqual(expect.arrayContaining(['sage', 'leaf-green', 'warm-amber']))
    expect(run.designQualityAssessment.paletteTokenAudit.ok).toBe(true)
    expect(run.designQualityAssessment.specBoundaryRecovery).toContain('completion boundary')
    expect(run.designQualityAssessment.designTasteInfluence).toContain('design foundation')
    expect(run.mcpAudit.answers.every(answer => answer.answerableWithoutShell)).toBe(true)
  })

  it('rejects generic blue primary/accent tokens for Pantry Pulse even when a palette rationale exists', () => {
    const audit = auditPantryPulsePaletteTokens([
      ':root {',
      '  --surface: #f5f5fa;',
      '  --accent: #4f6ef7;',
      '  --warn: #d69e2e;',
      '}',
    ].join('\n'))

    expect(audit.ok).toBe(false)
    expect(audit.primaryRole?.name).toBe('--accent')
    expect(audit.findings.join('\n')).toContain('generic cool-blue')
    expect(audit.findings.join('\n')).toContain('warm domestic')
  })

  it('audits Pantry Pulse palette tokens without depending on CSS custom properties', () => {
    const audit = auditPantryPulsePaletteTokens([
      'export const tokens = {',
      '  color: {',
      "    surface: '#fbf7ee',",
      "    primary: '#78955a',",
      "    warning: '#c9792b',",
      '  },',
      '}',
      '$brand-primary: #78955a;',
      '@accent: #c9792b;',
      '"danger": "#b84a3a"',
    ].join('\n'))

    expect(audit.ok).toBe(true)
    expect(audit.roles.map(role => role.name)).toEqual(expect.arrayContaining([
      'primary',
      '$brand-primary',
      '@accent',
      'danger',
    ]))
  })

  it('accepts a Pantry Pulse palette with warm surfaces, sage primary, and status-safe amber', () => {
    const audit = auditPantryPulsePaletteTokens([
      ':root {',
      '  --surface: #fbf7ee;',
      '  --accent: #6f8f4e;',
      '  --warn: #c9792b;',
      '  --danger: #b84a3a;',
      '}',
    ].join('\n'))

    expect(audit.ok).toBe(true)
    expect(audit.primaryRole?.family).toBe('sage')
    expect(audit.findings).toEqual([])
  })

  it('reports boundary misses instead of allowing false success', () => {
    const run = buildPantryPulseSmokeRun()
    run.browserProof = run.browserProof.filter(proof => !proof.assertion.includes('Mark used'))
    run.designProof = run.designProof.filter(evidence => evidence.ref !== 'screenshot://pantry-pulse/mobile')
    run.designQualityAssessment.appStoreCaliberGaps = []
    run.designQualityAssessment.paletteTokenAudit = auditPantryPulsePaletteTokens(':root { --accent: #4f6ef7; }')

    const result = validatePantryPulseSmokeRun(run)

    expect(result.ok).toBe(false)
    expect(result.missing).toContain('Browser proof is missing the Mark used count-update flow.')
    expect(result.missing).toContain('Design proof is missing desktop and mobile screenshots.')
    expect(result.missing).toContain('Design assessment is missing app-store-caliber gaps.')
    expect(result.missing.join('\n')).toContain('generic cool-blue')
  })

  it('drives Guildhall through an end-to-end Pantry Pulse app creation proof', async () => {
    const projectPath = await tempDir('guildhall-pantry-pulse-')
    bootstrapWorkspace(projectPath, { name: 'Pantry Pulse Smoke' })
    updateProjectConfig(projectPath, { workerLaneConcurrency: 1 })
    const memoryDir = getProjectStateDir(projectPath)
    const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
    await mkdir(path.dirname(tasksPath), { recursive: true })
    writeProjectTaskQueueWithSummary(tasksPath, {
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
    }, { projectRoot: projectPath })
    await applyCanonicalProjectMigrations(projectPath)

    const intake = await createExploringTask({
      memoryDir,
      ask: await fixture('spec.md'),
      domain: 'product',
      projectPath,
      taskId: 'task-pantry-pulse',
      title: 'Pantry Pulse app spec',
    })
    await setTaskForSpecReview(memoryDir, intake.taskId, pantryPulseApprovedSpec())

    const approved = await approveSpec({ memoryDir, taskId: intake.taskId })
    expect(approved.success).toBe(true)
    await mutateTask(memoryDir, intake.taskId, { status: 'in_progress' })
    await upsertTaskRuntimeState(projectPath, intake.taskId, {
      assignedTo: 'worker-agent',
      updatedAt: new Date().toISOString(),
    })

    const observedStatuses: TaskStatus[] = []
    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await writePantryPulseApp(projectPath)
        await mutateTask(memoryDir, intake.taskId, {
          status: 'review',
          proofPaths: [{
            id: 'pantry-pulse-browser-proof',
            verificationRecords: [{
              evidenceId: 'pantry-pulse-browser-proof',
              status: 'passed',
            }],
          }],
          notes: [
            ...(await taskById(memoryDir, intake.taskId)).notes,
            {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: 'Built Pantry Pulse app files and prepared browser proof for filter and Mark used behavior.',
              timestamp: '2026-05-28T16:00:00.000Z',
            },
          ],
        })
      }),
      reviewer: stubAgent('reviewer-agent', async () => {
        await mutateTask(memoryDir, intake.taskId, {
          status: 'gate_check',
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'deterministic',
            reason: 'Pantry Pulse behavior, scope, and proof path are ready for gate.',
            reasoning: 'The generated app includes seeded items, expiring-soon styling, filter behavior, Mark used behavior, and browser-verifiable DOM labels.',
            failingSignals: [],
            recordedAt: '2026-05-28T16:05:00.000Z',
          }],
        })
      }),
      gateChecker: stubAgent('gate-checker-agent', async () => {
        const current = await taskById(memoryDir, intake.taskId)
        await mutateTask(memoryDir, intake.taskId, {
          status: 'done',
          acceptanceCriteria: current.acceptanceCriteria.map(criterion => ({
            ...criterion,
            met: true,
          })),
          completedAt: '2026-05-28T16:10:00.000Z',
          gateResults: [{
            gateId: 'pantry-pulse-smoke',
            type: 'hard',
            passed: true,
            output: 'Static app files exist and browser proof passed.',
            checkedAt: '2026-05-28T16:10:00.000Z',
          }],
          completionHandoff: {
            id: 'pantry-pulse-completion-handoff',
            taskId: intake.taskId,
            completedAt: '2026-05-28T16:10:00.000Z',
            completedBy: 'gate-checker-agent',
            summary: 'Pantry Pulse was created and verified through the browser flow.',
            proofPathIds: ['pantry-pulse-browser-proof'],
            verificationSummary: 'Browser proof covered app open, seeded items, expiring-soon filter, and Mark used count update.',
            automatedProof: [],
            manualProof: [],
            providerProof: [],
            residualRisk: 'Fixture uses local seeded data only.',
          },
        })
      }),
      coordinators: { product: stubAgent('product-coordinator') },
    }
    const orchestrator = new Orchestrator({
      config: resolveConfig({ workspacePath: projectPath }),
      agents,
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
      idleShutdownAfterTicks: 2,
    })

    for (let i = 0; i < 12; i++) {
      const outcome = await orchestrator.tick()
      if (outcome.kind === 'processed') {
        observedStatuses.push(outcome.afterStatus)
        if (outcome.afterStatus === 'done') break
      }
    }

    expect(observedStatuses).toEqual(['in_progress', 'review', 'gate_check', 'done'])
    await expect(readFile(path.join(projectPath, 'index.html'), 'utf-8')).resolves.toContain('Pantry Pulse')
    await expect(readFile(path.join(projectPath, 'src/main.js'), 'utf-8')).resolves.toContain('Mark used')

    const server = await serveStatic(projectPath)
    try {
      const browser = await chromium.launch()
      const page = await browser.newPage()
      await page.goto(server.url)
      await pwExpect(page.getByRole('heading', { name: 'Pantry Pulse' })).toBeVisible()
      await pwExpect(page.getByTestId('pantry-item')).toHaveCount(5)
      await page.getByRole('button', { name: 'Expiring soon' }).click()
      await pwExpect(page.getByTestId('pantry-item')).toHaveCount(3)
      await pwExpect(page.getByTestId('active-count')).toHaveText('3 active items')
      await page.getByRole('button', { name: 'Mark used: Lemons' }).click()
      await pwExpect(page.getByTestId('active-count')).toHaveText('2 active items')
      await browser.close()
    } finally {
      await server.close()
    }

    const finalTask = await taskById(memoryDir, intake.taskId)
    expect(finalTask.status).toBe('done')
    expect(finalTask.doneSummaryBundle).toMatchObject({
      status: 'done',
      summary: {
        decision: expect.stringContaining('Task finished as done'),
      },
    })
  }, 20_000)

  liveIt('uses live Guildhall agents in fully automated mode to complete the fixed Pantry Pulse app spec', async () => {
    const resumeProjectPath = process.env.GUILDHALL_LIVE_PANTRY_PROJECT_PATH?.trim()
    const projectPath = resumeProjectPath || await tempDir('guildhall-live-pantry-pulse-')
    const memoryDir = getProjectStateDir(projectPath)
    let taskId = process.env.GUILDHALL_LIVE_PANTRY_TASK_ID?.trim() || 'task-pantry-pulse-live'

    if (!resumeProjectPath) {
      const workspaceName = `Pantry Pulse Live Proof ${path.basename(projectPath)}`
      bootstrapWorkspace(projectPath, {
        name: workspaceName,
        coordinators: [{
          id: 'product',
          domain: 'product',
          name: 'Product',
          mandate: 'Own the Pantry Pulse fixed-spec proof from spec refinement through implementation, review, gate checks, browser proof, and completion handoff without asking the owner to choose process.',
          concerns: [
            {
              id: 'completion-boundary',
              description: 'The work is only done when the runnable app exists and browser-visible behavior matches the fixed spec.',
              reviewQuestions: [
                'Does the completed work create a runnable local Pantry Pulse app?',
                'Does the proof path verify filter, count, and Mark used behavior in a browser?',
                'Does the proof path include design foundation, screenshots, control semantics, palette rationale, design review, and reusable-vs-local design finding classification?',
              ],
            },
          ],
          autonomousDecisions: [
            'Choose the smallest local web stack compatible with the runtime.',
            'Approve the fixed Pantry Pulse spec once the completion boundary is concrete.',
            'Split work only when the system decides it improves finishability.',
            'Proceed through review, gate checks, proof, and handoff without human confirmation.',
          ],
          escalationTriggers: [
            'External credentials or paid third-party services are required.',
            'The fixed Pantry Pulse product behavior cannot be implemented locally.',
          ],
        }],
      })
      updateProjectConfig(projectPath, {
        preferredProvider: 'openai-api',
        allowPaidProviderFallback: true,
      })
      initGitRepo(projectPath)

      const intake = await createExploringTask({
        memoryDir,
        ask: [
          await fixture('spec.md'),
          '',
          'Fully automated proof policy:',
          '- Guildhall should refine this fixed spec without asking the owner to choose process.',
          '- Use reasonable local-web defaults.',
          '- Split work only when the system decides it improves finishability.',
          '- Continue through implementation, review, gate, and proof without waiting for human approval.',
        ].join('\n'),
        domain: 'product',
        projectPath,
        taskId,
        title: 'Pantry Pulse app spec',
      })
      taskId = intake.taskId
    }

    const result = await runFullyAutomatedPantryPulse({
      memoryDir,
      projectPath,
      taskId,
      maxCycles: 18,
    })

    expect(result.finalStatus).toBe('done')
    expect(result.autoResolutions.length).toBeGreaterThan(0)
    expect(result.autoResolutions.every(item => item.policy === 'fully-automated')).toBe(true)
    if (resumeProjectPath) {
      expect(result.statuses).toContain('done')
    } else {
      expect(result.statuses).toEqual(expect.arrayContaining(['spec_review', 'ready', 'in_progress', 'review', 'gate_check', 'done']))
    }

    await expect(readFile(path.join(projectPath, 'index.html'), 'utf-8')).resolves.toContain('Pantry Pulse')
    const server = await serveViteDevServer(projectPath)
    try {
      const browser = await chromium.launch()
      const page = await browser.newPage()
      await page.goto(server.url)
      await pwExpect(page.getByRole('heading', { name: 'Pantry Pulse' })).toBeVisible()
      const pantryItems = page.locator('.pantry-item')
      expect(await pantryItems.count()).toBeGreaterThanOrEqual(5)
      await pwExpect(page.getByText(/7 items remaining|7 items in pantry/i)).toBeVisible()
      await page.getByRole('radio', { name: /expiring soon/i }).click()
      const filteredCount = await pantryItems.count()
      expect(filteredCount).toBeGreaterThan(0)
      expect(filteredCount).toBeLessThan(7)
      await page.getByRole('button', { name: /mark used/i }).first().click()
      await pwExpect(page.getByText(/6 items remaining|6 items in pantry/i)).toBeVisible()
      await browser.close()
    } finally {
      await server.close()
    }
    const paletteAudit = await auditProjectPaletteTokens(projectPath)
    expect(paletteAudit.ok, paletteAudit.findings.join('\n')).toBe(true)
  }, 900_000)
})

describe('zero-information spec intake fixture', () => {
  it('defines the empty-folder spec-from-scratch scenario separately from Pantry Pulse completion', async () => {
    const scenario = await zeroInfoFixture('scenario.md')

    expect(scenario).toContain('# Zero-Information Spec Intake Scenario')
    expect(scenario).toContain('intentionally separate from Pantry Pulse')
    expect(scenario).toContain('empty directory')
    expect(scenario).toContain('reasonable defaults')
    expect(scenario).toContain('No question asks the user to choose a Guildhall process path')
  })

  it('records a spec-from-scratch completion point without claiming app implementation', () => {
    const run = buildZeroInfoSpecIntakeRun()
    const result = validateZeroInfoSpecIntakeRun(run)

    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(run.completionPoint).toContain('reviewed initial app spec')
    expect(run.appGoal).toContain('pantry tracker')
    expect(run.firstFeature).toContain('Pantry item list')
    expect(run.firstRunnableWorkItem).toContain('Scaffold')
  })
})

interface StubAgent {
  readonly name: string
  setPermissionMode(mode: PermissionMode): PermissionMode
  generate(prompt: string): Promise<{ text: string }>
}

function stubAgent(name: string, sideEffect?: (prompt: string) => Promise<void> | void): StubAgent {
  let mode = PermissionMode.FULL_AUTO
  return {
    name,
    setPermissionMode(next) {
      mode = next
      return mode
    },
    async generate(prompt) {
      await sideEffect?.(prompt)
      return { text: 'ok' }
    },
  }
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

function initGitRepo(projectPath: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Guildhall Smoke'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['commit', '--no-verify', '-m', 'init'], { cwd: projectPath, stdio: 'ignore' })
}

async function runFullyAutomatedPantryPulse(input: {
  memoryDir: string
  projectPath: string
  taskId: string
  maxCycles: number
}): Promise<{
  finalStatus: TaskStatus
  statuses: TaskStatus[]
  autoResolutions: Array<{ policy: 'fully-automated'; kind: string; detail: string }>
}> {
  const statuses: TaskStatus[] = []
  const autoResolutions: Array<{ policy: 'fully-automated'; kind: string; detail: string }> = []

  for (let cycle = 0; cycle < input.maxCycles; cycle++) {
    const before = await readQueue(input.memoryDir)
    for (const task of before.tasks) {
      statuses.push(task.status)
    }
    await applyFullyAutomatedResolutions(input.memoryDir, input.projectPath, autoResolutions)

    const run = await runOrchestrator(resolveConfig({ workspacePath: input.projectPath }), {
      maxTicks: 6,
      tickDelayMs: 0,
      domainFilter: 'product',
      providerOverride: 'openai-api',
      agentGenerateWallClockTimeoutMs: {
        spec: 300_000,
        coordinator: 180_000,
        worker: 240_000,
        reviewer: 120_000,
        gateChecker: 120_000,
      },
      modelAssignmentOverride: {
        spec: 'deepseek-ai/DeepSeek-V4-Flash',
        coordinator: 'deepseek-ai/DeepSeek-V4-Flash',
        worker: 'deepseek-ai/DeepSeek-V4-Flash',
        reviewer: 'deepseek-ai/DeepSeek-V4-Flash',
        gateChecker: 'deepseek-ai/DeepSeek-V4-Flash',
        contextIndexer: 'deepseek-ai/DeepSeek-V4-Flash',
      },
    })
    const after = await readQueue(input.memoryDir)
    for (const task of after.tasks) statuses.push(task.status)
    if (after.tasks.some(task => task.status === 'done')) {
      await recordFullyAutomatedResolution(input.memoryDir, input.taskId, autoResolutions, 'completion', `Run stopped with ${run.stopReason}.`)
      return {
        finalStatus: 'done',
        statuses: [...new Set(statuses)],
        autoResolutions,
      }
    }
    await resolveAutomationBlockers(input.memoryDir, autoResolutions)
  }

  const task = await taskById(input.memoryDir, input.taskId)
  return {
    finalStatus: task.status,
    statuses: [...new Set(statuses)],
    autoResolutions,
  }
}

async function applyFullyAutomatedResolutions(
  memoryDir: string,
  projectPath: string,
  autoResolutions: Array<{ policy: 'fully-automated'; kind: string; detail: string }>,
): Promise<void> {
  await rejectStalePantryPulseFalseCompletion(memoryDir, projectPath, autoResolutions)

  const questionQueue = await readQueue(memoryDir)
  const questionResumes: Array<{ taskId: string; message: string }> = []
  let answeredQuestions = false
  for (const task of questionQueue.tasks) {
    const openQuestions = (task.openQuestions ?? []).filter(question => !question.answeredAt)
    if (openQuestions.length > 0) {
      const answer = 'Use the fixed Pantry Pulse spec, local-only seeded data, no accounts, no remote persistence, and the smallest runtime-compatible local web app stack.'
      const now = new Date().toISOString()
      task.openQuestions = (task.openQuestions ?? []).map(question => question.answeredAt ? question : {
        ...question,
        answeredAt: now,
        answer,
      })
      answeredQuestions = true
      autoResolutions.push({ policy: 'fully-automated', kind: 'answer_questions', detail: `${task.id}: answered ${openQuestions.length} question(s).` })
      questionResumes.push({
        taskId: task.id,
        message: openQuestions.map(question => `Answer to "${question.id}": ${answer}`).join('\n'),
      })
    }
  }
  if (answeredQuestions) {
    questionQueue.lastUpdated = new Date().toISOString()
    await writeQueue(memoryDir, questionQueue)
  }
  for (const resume of questionResumes) {
    await resumeExploring({
      memoryDir,
      taskId: resume.taskId,
      message: resume.message,
    })
  }

  const approvalQueue = await readQueue(memoryDir)
  for (const task of approvalQueue.tasks) {
    if (task.status === 'spec_review' && task.spec?.trim()) {
      const approved = await approveSpec({
        memoryDir,
        taskId: task.id,
        approvalNote: 'Fully automated Pantry Pulse proof approved this fixed-spec draft.',
      })
      if (approved.success) {
        autoResolutions.push({ policy: 'fully-automated', kind: 'approve_spec', detail: `${task.id}: approved spec_review.` })
      } else {
        await resumeExploring({
          memoryDir,
          taskId: task.id,
          message: `Fully automated review could not approve this spec yet: ${approved.error}. Revise the fixed Pantry Pulse spec into Guildhall's required Completion Boundary shape and keep the product behavior unchanged.`,
        })
        autoResolutions.push({ policy: 'fully-automated', kind: 'request_spec_revision', detail: `${task.id}: ${approved.error ?? 'approval failed'}` })
      }
    }
  }
}

async function rejectStalePantryPulseFalseCompletion(
  memoryDir: string,
  projectPath: string,
  autoResolutions: Array<{ policy: 'fully-automated'; kind: string; detail: string }>,
): Promise<void> {
  const queue = await readQueue(memoryDir)
  let changed = false
  for (const task of queue.tasks) {
    if (task.status !== 'in_progress') continue
    const latestSelfCritiqueIndex = latestNoteIndex(task, note =>
      /self-critique/i.test(note.content) &&
      (note.agentId === 'worker-agent' || note.role === 'self-critique' || note.role.endsWith('-engineer')),
    )
    if (latestSelfCritiqueIndex < 0) continue
    const latestRejectionIndex = latestNoteIndex(task, note =>
      note.agentId === 'benchmark-automation' &&
      note.role === 'automation' &&
      /rejected stale worker self-critique/i.test(note.content),
    )
    if (latestRejectionIndex > latestSelfCritiqueIndex) continue
    const hasStarterFiles = await fileExists(path.join(projectPath, 'index.html')) ||
      await fileExists(path.join(projectPath, 'package.json'))
    if (hasStarterFiles) continue
    const now = new Date().toISOString()
    task.notes.push({
      agentId: 'benchmark-automation',
      role: 'automation',
      content:
        'Fully automated Pantry Pulse proof rejected stale worker self-critique without project-file changes. Create package.json, index.html, src/main.js, and src/styles.css before writing another self-critique.',
      timestamp: now,
    })
    task.updatedAt = now
    changed = true
    autoResolutions.push({
      policy: 'fully-automated',
      kind: 'reject_false_completion',
      detail: `${task.id}: rejected stale self-critique without app files.`,
    })
  }
  if (changed) {
    queue.lastUpdated = new Date().toISOString()
    await writeQueue(memoryDir, queue)
    await writeFile(
      path.join(memoryDir, '.session-epoch'),
      `pantry-retry-${Date.now().toString(36)}\n`,
      'utf-8',
    )
  }
}

function latestNoteIndex(task: Task, predicate: (note: Task['notes'][number]) => boolean): number {
  for (let index = task.notes.length - 1; index >= 0; index -= 1) {
    const note = task.notes[index]
    if (note && predicate(note)) return index
  }
  return -1
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function auditProjectPaletteTokens(projectPath: string): Promise<ReturnType<typeof auditPantryPulsePaletteTokens>> {
  const tokenFiles = await findPaletteTokenFiles(projectPath)
  const contents = await Promise.all(tokenFiles.map(async file => {
    return [
      `/* ${path.relative(projectPath, file)} */`,
      await readFile(file, 'utf-8'),
    ].join('\n')
  }))
  return auditPantryPulsePaletteTokens(contents.join('\n\n'))
}

async function findPaletteTokenFiles(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.guildhall' || entry.name === 'dist') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (!isPaletteTokenCandidate(entry.name)) continue
      const info = await stat(fullPath)
      if (info.size > 512_000) continue
      found.push(fullPath)
    }
  }
  await visit(root)
  return found
}

function isPaletteTokenCandidate(fileName: string): boolean {
  if (!/\.(css|scss|sass|less|js|mjs|cjs|ts|json|yaml|yml)$/i.test(fileName)) return false
  return /token|theme|style|design|palette|color|variables|components/i.test(fileName)
}

async function resolveAutomationBlockers(
  memoryDir: string,
  autoResolutions: Array<{ policy: 'fully-automated'; kind: string; detail: string }>,
): Promise<void> {
  const queue = await readQueue(memoryDir)
  let changed = false
  for (const task of queue.tasks) {
    const blockerText = [
      task.blockReason,
      ...task.escalations.filter(escalation => !escalation.resolvedAt).map(escalation => `${escalation.summary} ${escalation.details ?? ''}`),
    ].filter(Boolean).join('\n')
    if (
      task.status === 'blocked' &&
      !/worktree|bootstrap|already exists|fatal:/i.test(blockerText) &&
      /human|approval|question|judgment|ambiguous|turn limit|turn budget/i.test(blockerText)
    ) {
      const now = new Date().toISOString()
      task.status = 'exploring'
      task.updatedAt = now
      task.blockReason = undefined
      task.escalations = task.escalations.map(escalation => escalation.resolvedAt ? escalation : {
        ...escalation,
        resolvedAt: now,
        resolvedBy: 'benchmark-automation',
        resolution: 'Fully automated proof resolved this as retryable: continue with the fixed Pantry Pulse app spec, use the smallest local-web implementation, and do not wait for human input.',
      })
      task.notes = [
        ...task.notes,
        {
          agentId: 'benchmark-automation',
          role: 'automation',
          content: 'Resolved retryable blocker under fully automated Pantry Pulse proof policy. Continue from the fixed app spec and produce the concrete completion-boundary draft.',
          timestamp: now,
        },
      ]
      changed = true
      autoResolutions.push({ policy: 'fully-automated', kind: 'resolve_blocker', detail: `${task.id}: resumed from automation-compatible blocker.` })
    }
  }
  if (changed) {
    queue.lastUpdated = new Date().toISOString()
    await writeQueue(memoryDir, queue)
  }
}

async function recordFullyAutomatedResolution(
  memoryDir: string,
  taskId: string,
  autoResolutions: Array<{ policy: 'fully-automated'; kind: string; detail: string }>,
  kind: string,
  detail: string,
): Promise<void> {
  autoResolutions.push({ policy: 'fully-automated', kind, detail })
  const task = await taskById(memoryDir, taskId)
  await mutateTask(memoryDir, taskId, {
    notes: [
      ...task.notes,
      {
        agentId: 'benchmark-automation',
        role: 'automation',
        content: `Fully automated Pantry Pulse proof resolutions:\n${autoResolutions.map(item => `- ${item.kind}: ${item.detail}`).join('\n')}`,
        timestamp: new Date().toISOString(),
      },
    ],
  })
}

async function applyCanonicalProjectMigrations(projectRoot: string): Promise<void> {
  const prerequisites = await applyProjectMigrations({ projectRoot, includePrompt: true })
  expect(prerequisites.failed).toEqual([])
  const finalize = await applyProjectMigrations({
    projectRoot,
    only: ['0.13.0/project-state-finalize'],
  })
  expect(finalize.failed).toEqual([])
  const cleanup = await applyProjectMigrations({
    projectRoot,
    only: ['0.13.0/project-state-legacy-live-file-cleanup'],
  })
  expect(cleanup.failed).toEqual([])
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  await mkdir(path.dirname(tasksPath), { recursive: true })
  const current = readProjectTaskQueueForMutationSync(tasksPath)
  writeProjectTaskQueue(tasksPath, queue, {
    projectRoot: path.dirname(memoryDir),
    expectedQueueRevision: current.expectedQueueRevision,
  })
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  const queue = TaskQueue.parse(readProjectTaskQueueSync(tasksPath))
  return {
    ...queue,
    tasks: await Promise.all(queue.tasks.map(async task => buildEffectiveTask(task.projectPath, task))) as unknown as Task[],
  }
}

async function taskById(memoryDir: string, taskId: string): Promise<Task> {
  const queue = await readQueue(memoryDir)
  const task = queue.tasks.find(candidate => candidate.id === taskId)
  if (!task) throw new Error(`Missing task ${taskId}`)
  return task
}

async function mutateTask(memoryDir: string, taskId: string, patch: Partial<Task>): Promise<void> {
  const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  const projectRoot = path.dirname(memoryDir)
  const promoted = writePromotedTaskDetailMutation(tasksPath, taskId, {
    projectId: path.basename(projectRoot),
    projectRoot,
    mutate: (task) => ({ ...task, ...patch }),
  })
  if (promoted) return

  const current = readProjectTaskQueueForMutationSync(tasksPath)
  const queue = TaskQueue.parse(current.queue)
  const task = queue.tasks.find(candidate => candidate.id === taskId)
  if (!task) throw new Error(`Missing task ${taskId}`)
  writeProjectTaskQueue(tasksPath, {
    ...queue,
    lastUpdated: new Date().toISOString(),
    tasks: queue.tasks.map(candidate => candidate.id === taskId ? { ...candidate, ...patch } : candidate),
  }, {
    projectRoot,
    expectedQueueRevision: current.expectedQueueRevision,
  })
}

async function setTaskForSpecReview(memoryDir: string, taskId: string, spec: string): Promise<void> {
  await mutateTask(memoryDir, taskId, {
    spec,
    status: 'spec_review',
    productBrief: {
      userJob: 'Track pantry items and use expiring food first.',
      successMetric: 'A browser proof shows seeded items, filtering, and Mark used behavior.',
      antiPatterns: ['Remote persistence', 'Accounts', 'Barcode scanning'],
      approvedAt: '2026-05-28T15:55:00.000Z',
    },
    acceptanceCriteria: [
      { id: 'AC-1', description: 'A page titled Pantry Pulse is visible.', verifiedBy: 'review', met: false },
      { id: 'AC-2', description: 'At least five pantry items are visible.', verifiedBy: 'review', met: false },
      { id: 'AC-3', description: 'The expiring-soon filter changes the visible list.', verifiedBy: 'review', met: false },
      { id: 'AC-4', description: 'Mark used updates the visible count.', verifiedBy: 'review', met: false },
    ],
  })
}

function pantryPulseApprovedSpec(): string {
  return [
    '## Summary',
    '',
    'Build Pantry Pulse, a small local web app that tracks pantry items, highlights what expires soon, filters expiring items, and lets the user mark an item as used.',
    '',
    '## Completion Boundary',
    '- Product outcome: The user can open Pantry Pulse, see five seeded pantry items, filter to expiring-soon items, mark one item used, and see the active count update.',
    '- What Guildhall can complete in code: Create the local static web app files, seeded data, filter behavior, Mark used interaction, styles, and browser-proofable UI.',
    '- External dependencies: None.',
    '- Owner-only setup: None.',
    '- Verification environment: Local runtime/browser proof.',
    '- What counts as done: Design foundation, desktop/mobile screenshots, control semantics, palette rationale, design reviewer approval, reusable-vs-local finding classification, and browser proof for app open, seeded items, expiring-soon filter, Mark used, and count update all exist.',
    '- What must be split or blocked: Nothing for this fixture.',
    '',
    '## Acceptance Criteria',
    '1. A page titled Pantry Pulse is visible.',
    '2. At least five pantry items are visible.',
    '3. The expiring-soon filter changes the visible list.',
    '4. Mark used updates the visible count.',
  ].join('\n')
}

async function writePantryPulseApp(projectPath: string): Promise<void> {
  await mkdir(path.join(projectPath, 'src'), { recursive: true })
  await writeFile(path.join(projectPath, 'package.json'), JSON.stringify({
    name: 'pantry-pulse-smoke',
    private: true,
    type: 'module',
    scripts: { dev: 'node server.mjs' },
  }, null, 2), 'utf-8')
  await writeFile(path.join(projectPath, 'index.html'), [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>Pantry Pulse</title>',
    '  <link rel="stylesheet" href="/src/styles.css">',
    '</head>',
    '<body>',
    '  <main class="shell">',
    '    <header>',
    '      <h1>Pantry Pulse</h1>',
    '      <p data-testid="active-count"></p>',
    '    </header>',
    '    <nav aria-label="Pantry filters">',
    '      <button type="button" data-filter="all">All items</button>',
    '      <button type="button" data-filter="soon">Expiring soon</button>',
    '    </nav>',
    '    <section id="items" aria-label="Pantry items"></section>',
    '  </main>',
    '  <script type="module" src="/src/main.js"></script>',
    '</body>',
    '</html>',
  ].join('\n'), 'utf-8')
  await writeFile(path.join(projectPath, 'src/main.js'), [
    'const items = [',
    "  { name: 'Lemons', category: 'Produce', quantity: '4', expiresInDays: 2 },",
    "  { name: 'Yogurt', category: 'Dairy', quantity: '2 cups', expiresInDays: 4 },",
    "  { name: 'Spinach', category: 'Produce', quantity: '1 bag', expiresInDays: 6 },",
    "  { name: 'Pasta', category: 'Dry goods', quantity: '1 box', expiresInDays: 90 },",
    "  { name: 'Black beans', category: 'Canned', quantity: '3 cans', expiresInDays: 180 },",
    '].map((item, index) => ({ ...item, id: String(index), used: false }))',
    '',
    "let filter = 'all'",
    "const list = document.querySelector('#items')",
    "const activeCount = document.querySelector('[data-testid=\"active-count\"]')",
    '',
    'function visibleItems() {',
    '  return items.filter(item => !item.used && (filter === "all" || item.expiresInDays <= 7))',
    '}',
    '',
    'function render() {',
    '  const visible = visibleItems()',
    '  activeCount.textContent = `${visible.length} active ${visible.length === 1 ? "item" : "items"}`',
    '  list.innerHTML = ""',
    '  for (const item of visible) {',
    '    const card = document.createElement("article")',
    '    card.dataset.testid = "pantry-item"',
    '    card.className = item.expiresInDays <= 7 ? "item item-soon" : "item"',
    '    card.innerHTML = `<h2>${item.name}</h2><p>${item.category} · ${item.quantity}</p><p>Expires in ${item.expiresInDays} days</p>`',
    '    const button = document.createElement("button")',
    '    button.type = "button"',
    '    button.textContent = "Mark used"',
    '    button.setAttribute("aria-label", `Mark used: ${item.name}`)',
    '    button.addEventListener("click", () => { item.used = true; render() })',
    '    card.append(button)',
    '    list.append(card)',
    '  }',
    '}',
    '',
    'document.querySelectorAll("[data-filter]").forEach(button => {',
    '  button.addEventListener("click", () => { filter = button.dataset.filter; render() })',
    '})',
    '',
    'render()',
  ].join('\n'), 'utf-8')
  await writeFile(path.join(projectPath, 'src/styles.css'), [
    ':root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }',
    'body { margin: 0; background: #f6f5ef; color: #16211b; }',
    '.shell { max-width: 860px; margin: 0 auto; padding: 40px 20px; }',
    'header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }',
    'h1 { margin: 0; font-size: 42px; }',
    'nav { display: flex; gap: 8px; margin: 24px 0; }',
    'button { border: 1px solid #9aa392; background: #fff; color: #16211b; border-radius: 6px; padding: 8px 12px; font: inherit; cursor: pointer; }',
    '#items { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }',
    '.item { border: 1px solid #d7d4c7; border-radius: 8px; background: #fff; padding: 16px; }',
    '.item-soon { border-color: #bc5f32; box-shadow: inset 4px 0 0 #bc5f32; }',
    '.item h2 { margin: 0 0 8px; font-size: 20px; }',
  ].join('\n'), 'utf-8')
}

async function serveStatic(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const requestPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html'
    const filePath = path.join(root, decodeURIComponent(requestPath))
    try {
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': contentType(filePath) })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

async function serveViteDevServer(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const port = await freePort()
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' },
  })
  let output = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { output += chunk })
  child.stderr?.on('data', (chunk: string) => { output += chunk })
  const url = `http://127.0.0.1:${port}/`
  await waitForHttp(url, () => output)
  return {
    url,
    close: () => new Promise(resolve => {
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
        resolve()
      }, 1000).unref()
    }),
  }
}

async function freePort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  const port = address.port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function waitForHttp(url: string, output: () => string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    if (await canFetch(url)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Vite dev server did not become ready at ${url}\n${output()}`)
}

async function canFetch(url: string): Promise<boolean> {
  return await new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume()
      resolve((res.statusCode ?? 500) < 500)
    })
    req.once('error', () => resolve(false))
    req.setTimeout(500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.js')) return 'text/javascript'
  if (filePath.endsWith('.css')) return 'text/css'
  if (filePath.endsWith('.html')) return 'text/html'
  return 'text/plain'
}
