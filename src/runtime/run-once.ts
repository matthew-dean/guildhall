import { readManagedTextFile, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { ResolvedConfig } from '@guildhall/config'
import { AGENT_SETTINGS_FILENAME, loadLeverSettings, saveLeverSettings, validateLeverSettings } from '@guildhall/levers'
import { appendTaskEvidence, getProjectSystemStatePath, inferProjectRootFromMemoryDir } from '@guildhall/sessions'

import { createExploringTask } from './intake.js'
import { runOrchestrator, type OrchestratorRunOptions, type OrchestratorRunResult } from './orchestrator.js'
import { summarizeScopedRun } from './run-automation.js'
import { loadWorkspace } from './workspace-loader.js'

export type RunOnceAutomationPolicy = 'ask_more_often' | 'ask_when_necessary' | 'fully_automated'
export type RunOnceProofMode = 'auto' | 'browser' | 'commands' | 'none'

export interface RunOnceInput {
  projectRoot: string
  prompt?: string
  fromFile?: string
  title?: string
  outputPath?: string
  automationPolicy?: RunOnceAutomationPolicy
  proof?: RunOnceProofMode
  maxTicks?: number
  providerOverride?: string
  modelAssignmentOverride?: OrchestratorRunOptions['modelAssignmentOverride']
  now?: () => string
  runOrchestratorImpl?: (
    config: ResolvedConfig,
    options?: OrchestratorRunOptions,
  ) => Promise<OrchestratorRunResult>
}

export interface RunOnceReport {
  id: string
  createdAt: string
  projectRoot: string
  taskId: string
  title: string
  prompt: string
  automationPolicy: RunOnceAutomationPolicy
  proof: RunOnceProofMode
  outputPath?: string
  stopReason: OrchestratorRunResult['stopReason']
  stopMessage: string
  scopedStatusSummary: string
  orchestrator: OrchestratorRunResult
}

export async function runGuildhallTaskOnce(input: RunOnceInput): Promise<RunOnceReport> {
  const projectRoot = path.resolve(input.projectRoot)
  const workspace = loadWorkspace(projectRoot)
  const prompt = await resolvePrompt(input)
  const title = compactTitle(input.title ?? prompt)
  const automationPolicy = input.automationPolicy ?? 'ask_when_necessary'
  const proof = input.proof ?? 'auto'
  const createdAt = input.now?.() ?? new Date().toISOString()
  const domain = workspace.config.coordinators[0]?.domain ?? 'general'

  if (automationPolicy === 'fully_automated') {
    await enableFullyAutomatedRunLever({
      memoryDir: workspace.memoryDir,
      createdAt,
      reason: `Enabled by guildhall task run-once for request: ${title}`,
    })
  }

  const intake = await createExploringTask({
    memoryDir: workspace.memoryDir,
    projectPath: workspace.config.projectPath,
    workspacePath: workspace.root,
    domain,
    ask: prompt,
    title,
  })

  await appendRunOnceNote({
    memoryDir: workspace.memoryDir,
    taskId: intake.taskId,
    automationPolicy,
    proof,
    createdAt,
  })

  const orchestrator = await (input.runOrchestratorImpl ?? runOrchestrator)(workspace.config, {
    maxTicks: input.maxTicks ?? 80,
    preferredTaskId: intake.taskId,
    ...(input.providerOverride ? { providerOverride: input.providerOverride } : {}),
    ...(input.modelAssignmentOverride ? { modelAssignmentOverride: input.modelAssignmentOverride } : {}),
  })
  const scoped = await summarizeScopedRun({
    memoryDir: workspace.memoryDir,
    rootTaskId: intake.taskId,
  })
  const normalizedOrchestrator = scoped.allTerminal
    ? {
        ...orchestrator,
        stopReason: 'all_terminal' as const,
        stopMessage: `Run-once request ${intake.taskId} exhausted: ${scoped.statusSummary}.`,
      }
    : orchestrator

  const report: RunOnceReport = {
    id: `run-once-${createdAt.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}-${intake.taskId}`,
    createdAt,
    projectRoot,
    taskId: intake.taskId,
    title,
    prompt,
    automationPolicy,
    proof,
    ...(input.outputPath ? { outputPath: path.resolve(input.outputPath) } : {}),
    stopReason: normalizedOrchestrator.stopReason,
    stopMessage: normalizedOrchestrator.stopMessage,
    scopedStatusSummary: scoped.statusSummary,
    orchestrator: normalizedOrchestrator,
  }

  if (report.outputPath) {
    await fs.mkdir(path.dirname(report.outputPath), { recursive: true })
    await writeManagedTextFile(report.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}

async function resolvePrompt(input: RunOnceInput): Promise<string> {
  const prompt = input.prompt?.trim()
  const fromFile = input.fromFile?.trim()
  if (prompt && fromFile) {
    throw new Error('Pass either a prompt argument or --from-file, not both.')
  }
  if (prompt) return prompt
  if (fromFile) {
    const content = await readManagedTextFile(path.resolve(fromFile), 'utf8')
    const filePrompt = content.trim()
    if (filePrompt) return filePrompt
  }
  throw new Error('Run-once needs a prompt argument or --from-file <path>.')
}

async function enableFullyAutomatedRunLever(input: {
  memoryDir: string
  createdAt: string
  reason: string
}): Promise<void> {
  const settingsPath = runOnceStatePath(input.memoryDir, AGENT_SETTINGS_FILENAME)
  const settings = await loadLeverSettings({ path: settingsPath })
  settings.project.run_automation = {
    position: 'fully_automated',
    rationale: input.reason,
    setAt: input.createdAt,
    setBy: 'user-direct',
  }
  await saveLeverSettings({ path: settingsPath, settings: validateLeverSettings(settings) })
}

async function appendRunOnceNote(input: {
  memoryDir: string
  taskId: string
  automationPolicy: RunOnceAutomationPolicy
  proof: RunOnceProofMode
  createdAt: string
}): Promise<void> {
  const note = {
    agentId: 'run-once',
    role: 'automation',
    content: [
      `Run-once automation policy: ${input.automationPolicy}.`,
      `Requested proof mode: ${input.proof}.`,
      'This task was created through the scriptable run-once lane; normal Guildhall pressure-test, review, gate, and handoff rules still apply.',
    ].join('\n'),
    timestamp: input.createdAt,
  }
  await appendTaskEvidence(inferProjectRootFromMemoryDir(input.memoryDir), input.taskId, {
    id: `note-${input.taskId}-${input.createdAt.replace(/[^0-9A-Za-z]/g, '')}-run-once`,
    kind: 'note',
    recordedAt: input.createdAt,
    payload: note,
  })
}

function runOnceStatePath(memoryDir: string, filename: string): string {
  const base = path.basename(memoryDir)
  if (base === '.guildhall' || base === 'memory') {
    return getProjectSystemStatePath(inferProjectRootFromMemoryDir(memoryDir), filename)
  }
  return path.join(memoryDir, filename)
}

function compactTitle(value: string): string {
  const first = value.split(/\r?\n/).find(line => line.trim())?.trim() ?? 'Run once task'
  const single = first.replace(/\s+/g, ' ')
  return single || 'Run once task'
}
