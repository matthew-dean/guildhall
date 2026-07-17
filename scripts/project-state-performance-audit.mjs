#!/usr/bin/env node

import process from 'node:process'
import { performance } from 'node:perf_hooks'

const baseUrl = (process.env.GUILDHALL_URL ?? 'http://localhost:7777').replace(/\/$/, '')
const fleetBudgetMs = Number(process.env.GUILDHALL_FLEET_BUDGET_MS ?? 250)
const projectBudgetMs = Number(process.env.GUILDHALL_PROJECT_BUDGET_MS ?? 500)
const richTaskBudgetMs = Number(process.env.GUILDHALL_RICH_TASK_BUDGET_MS ?? 750)
const threadBudgetMs = Number(process.env.GUILDHALL_THREAD_BUDGET_MS ?? 1000)
const fleetMaxBytes = Number(process.env.GUILDHALL_FLEET_MAX_BYTES ?? 128 * 1024)
const projectMaxBytes = Number(process.env.GUILDHALL_PROJECT_MAX_BYTES ?? 256 * 1024)
const richTaskMaxBytes = Number(process.env.GUILDHALL_RICH_TASK_MAX_BYTES ?? 512 * 1024)
const threadMaxBytes = Number(process.env.GUILDHALL_THREAD_MAX_BYTES ?? 512 * 1024)
const timeoutMs = Number(process.env.GUILDHALL_READ_TIMEOUT_MS ?? 5000)

async function readJson(path) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  })
  const body = await response.text()
  const durationMs = Math.round((performance.now() - started) * 100) / 100
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${body.slice(0, 200)}`)
  return {
    value: JSON.parse(body),
    bytes: Buffer.byteLength(body),
    durationMs,
  }
}

function projectReadPath(id) {
  return `/api/project?projectId=${encodeURIComponent(id)}&compact=true&surface=overview`
}

function projectResult(id, read) {
  const value = read.value ?? {}
  const summary = value.summary ?? value
  const loading = value.projectStatusLoading === true || summary.projectStatusLoading === true
  const error = typeof value.projectStatusError === 'string' || typeof summary.projectStatusError === 'string'
  return {
    id,
    durationMs: read.durationMs,
    bytes: read.bytes,
    freshness: value.summaryFreshness ?? summary.summaryFreshness ?? null,
    loading,
    error,
    taskId: Array.isArray(value.tasks) && typeof value.tasks[0]?.id === 'string' ? value.tasks[0].id : null,
    pass: read.durationMs <= projectBudgetMs && read.bytes <= projectMaxBytes && !loading && !error,
  }
}

function checkFleet(read) {
  const projects = Array.isArray(read.value?.projects) ? read.value.projects : []
  const loading = projects.filter(project => project.projectStatusLoading === true)
  const errors = projects.filter(project => typeof project.projectStatusError === 'string')
  return {
    durationMs: read.durationMs,
    bytes: read.bytes,
    projectCount: projects.length,
    loading: loading.map(project => project.id),
    errors: errors.map(project => ({ id: project.id, error: project.projectStatusError })),
    pass: read.durationMs <= fleetBudgetMs && read.bytes <= fleetMaxBytes && loading.length === 0 && errors.length === 0,
    projects,
  }
}

async function auditPass(projects) {
  const reads = await Promise.all(projects.map(async project => {
    try {
      return projectResult(project.id, await readJson(projectReadPath(project.id)))
    } catch (error) {
      return { id: project.id, pass: false, error: error instanceof Error ? error.message : String(error) }
    }
  }))
  return {
    projects: reads,
    pass: reads.length > 0 && reads.every(read => read.pass),
  }
}

async function auditRichReads(projects, projectShells) {
  const richTasks = await Promise.all(projectShells.flatMap(shell => {
    if (!shell.taskId) return []
    const path = `/api/project/task/${encodeURIComponent(shell.taskId)}?projectId=${encodeURIComponent(shell.id)}`
    return [readJson(path)
      .then(read => ({
        id: shell.id,
        taskId: shell.taskId,
        durationMs: read.durationMs,
        bytes: read.bytes,
        pass: read.durationMs <= richTaskBudgetMs && read.bytes <= richTaskMaxBytes,
      }))
      .catch(error => ({ id: shell.id, taskId: shell.taskId, pass: false, error: error instanceof Error ? error.message : String(error) }))]
  }))
  const threads = await Promise.all(projects.map(project => readJson(`/api/project/thread?projectId=${encodeURIComponent(project.id)}`)
    .then(read => ({
      id: project.id,
      durationMs: read.durationMs,
      bytes: read.bytes,
      pass: read.durationMs <= threadBudgetMs && read.bytes <= threadMaxBytes,
    }))
    .catch(error => ({ id: project.id, pass: false, error: error instanceof Error ? error.message : String(error) }))))
  return {
    richTasks,
    threads,
    pass: richTasks.every(read => read.pass) && threads.every(read => read.pass),
  }
}

try {
  const fleet = checkFleet(await readJson('/api/service/projects'))
  const projects = fleet.projects
  const cold = await auditPass(projects)
  const warm = await auditPass(projects)
  const rich = await auditRichReads(projects, cold.projects)
  const result = {
    baseUrl,
    budgets: { fleetBudgetMs, projectBudgetMs, richTaskBudgetMs, threadBudgetMs, fleetMaxBytes, projectMaxBytes, richTaskMaxBytes, threadMaxBytes },
    fleet: {
      durationMs: fleet.durationMs,
      bytes: fleet.bytes,
      projectCount: fleet.projectCount,
      loading: fleet.loading,
      errors: fleet.errors,
      pass: fleet.pass,
    },
    cold,
    warm,
    rich,
    pass: fleet.pass && cold.pass && warm.pass && rich.pass,
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.pass) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
