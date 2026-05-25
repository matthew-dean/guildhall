import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { createReviewAuditStore } from '../review-audit-store.js'

describe('review audit store', () => {
  let tmp: string
  let dataDir: string
  let priorDataDir: string | undefined
  const now = () => new Date('2026-05-25T12:34:00.000Z')

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-review-audit-'))
    dataDir = path.join(tmp, 'data')
    priorDataDir = process.env.GUILDHALL_DATA_DIR
    process.env.GUILDHALL_DATA_DIR = dataDir
  })

  afterEach(async () => {
    if (priorDataDir === undefined) {
      delete process.env.GUILDHALL_DATA_DIR
    } else {
      process.env.GUILDHALL_DATA_DIR = priorDataDir
    }
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('stores compact review plans in shared project state', async () => {
    const projectRoot = path.join(tmp, 'project')
    const store = createReviewAuditStore({
      projectRoot,
      persistence: new FileBackedGuildhallPersistence(),
      now,
    })

    const saved = await store.saveReviewPlan({
      taskId: 'task-1',
      effort: 'balanced',
      depth: 'targeted',
      selectedLanes: ['ux_comprehension', 'plan_completeness'],
      requiredRecipes: [{
        recipeId: 'ux-zero-context-comprehension',
        version: 'v1',
        lanes: ['ux_comprehension'],
        blocking: 'high',
        required: true,
      }],
      budget: { maxReviewerAgents: 3 },
      aggregation: { ux_comprehension: 'blocking_on_high' },
      reasons: ['User-facing flow changed.'],
      createdBy: 'coordinator:test',
    })

    expect(saved.ref.path).toContain(path.join(projectRoot, '.guildhall', 'persistence'))
    expect(saved.payload.createdAt).toBe('2026-05-25T12:34:00.000Z')
    expect(saved.payload.selectedLanes).toEqual(['ux_comprehension', 'plan_completeness'])
  })

  it('keeps raw reviewer runs in local history and reads a task audit bundle', async () => {
    const projectRoot = path.join(tmp, 'project')
    const store = createReviewAuditStore({
      projectRoot,
      persistence: new FileBackedGuildhallPersistence(),
      now,
    })

    await store.saveReviewPlan({
      taskId: 'task-1',
      effort: 'balanced',
      depth: 'targeted',
      selectedLanes: ['security'],
      createdBy: 'coordinator:test',
    })
    await store.appendReviewPlanEvent({
      taskId: 'task-1',
      kind: 'expanded_budget',
      summary: 'Added security review.',
      lanes: ['security'],
      recordedBy: 'coordinator:test',
    })
    await store.saveReviewerRun({
      taskId: 'task-1',
      recipeId: 'security-authz',
      recipeVersion: 'v1',
      lanes: ['security'],
      verdict: 'revise',
      findings: [{
        lane: 'security',
        severity: 'high',
        summary: 'Archive endpoint lacks authorization.',
      }],
      recordedBy: 'security-reviewer',
    })
    await store.linkEscapedMiss({
      taskId: 'task-1',
      missedLane: 'security',
      humanFinding: 'Authorization was missed in review.',
      nextCalibrationAction: 'create_case',
      recordedBy: 'human:test',
    })

    const audit = await store.readTaskReviewAudit('task-1')

    expect(audit.plan?.payload.selectedLanes).toEqual(['security'])
    expect(audit.events).toHaveLength(1)
    expect(audit.reviewerRuns).toHaveLength(1)
    expect(audit.reviewerRuns[0]!.ref.path).toContain(path.join(dataDir, 'projects'))
    expect(audit.escapedMisses[0]!.payload.humanFinding).toMatch(/Authorization/)
  })

  it('stores frontier runs in local history by default', async () => {
    const projectRoot = path.join(tmp, 'project')
    const store = createReviewAuditStore({
      projectRoot,
      persistence: new FileBackedGuildhallPersistence(),
      now,
    })

    const saved = await store.saveFrontierRun({
      runId: 'frontier-1',
      variantSet: 'review-effort-defaults',
      variants: ['lean', 'balanced', 'thorough'],
      metrics: { highSeverityRecall: 0.91 },
      recommendedDefault: 'balanced',
      summary: 'Balanced is the best default.',
      recordedBy: 'calibration-runner',
    })

    expect(saved.ref.path).toContain(path.join(dataDir, 'projects'))
    expect(saved.payload.recommendedDefault).toBe('balanced')
  })
})
