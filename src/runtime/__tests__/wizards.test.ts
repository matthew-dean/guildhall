/**
 * Wizards: status derivation is pure over a ProjectSnapshot, so we exercise
 * it with inline fixtures rather than touching disk. One "end to end"
 * `buildSnapshot` test writes real files to tmp to make sure the filesystem
 * seam works.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  onboardWizard,
  progressFor,
  buildSnapshot,
  emptyWizardsState,
  type ProjectSnapshot,
} from '../wizards.js'

function baseSnap(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    projectPath: '/tmp/example',
    hasProvider: false,
    hasDirection: false,
    workspaceImportReviewed: false,
    taskCount: 0,
    wizardState: emptyWizardsState(),
    ...overrides,
  }
}

describe('onboardWizard.progress', () => {
  it('reports all steps pending for a fresh project', () => {
    const p = progressFor(onboardWizard, baseSnap())
    expect(p.doneCount).toBe(0)
    expect(p.skippedCount).toBe(0)
    expect(p.pendingCount).toBe(onboardWizard.steps.length)
    expect(p.activeStepId).toBe('identity')
    expect(p.complete).toBe(false)
  })

  it('advances as facts flip to done', () => {
    const snap = baseSnap({
      config: { id: 'my-project', name: 'My Project' },
      hasProvider: true,
    })
    const p = progressFor(onboardWizard, snap)
    expect(p.doneCount).toBe(2)
    expect(p.activeStepId).toBe('bootstrap')
    expect(p.steps[0]!.status).toBe('done')
    expect(p.steps[1]!.status).toBe('done')
    expect(p.steps[2]!.status).toBe('pending')
  })

  it('treats bootstrap as done only when verifiedAt is a non-empty string', () => {
    const noVerified = progressFor(
      onboardWizard,
      baseSnap({ config: { id: 'x', bootstrap: {} } }),
    )
    expect(noVerified.steps.find(s => s.id === 'bootstrap')!.status).toBe('pending')

    const verified = progressFor(
      onboardWizard,
      baseSnap({
        config: { id: 'x', bootstrap: { verifiedAt: '2026-04-24T00:00:00Z' } },
      }),
    )
    expect(verified.steps.find(s => s.id === 'bootstrap')!.status).toBe('done')

    const emptyVerified = progressFor(
      onboardWizard,
      baseSnap({ config: { id: 'x', bootstrap: { verifiedAt: '' } } }),
    )
    expect(emptyVerified.steps.find(s => s.id === 'bootstrap')!.status).toBe('pending')
  })

  it('coordinator step is done once at least one coordinator exists', () => {
    const p = progressFor(
      onboardWizard,
      baseSnap({ config: { id: 'x', coordinators: [{ id: 'a', name: 'A' }] } }),
    )
    expect(p.steps.find(s => s.id === 'coordinator')!.status).toBe('done')
  })

  it('skipped markers render as skipped for skippable steps', () => {
    const snap = baseSnap({
      wizardState: {
        version: 1,
        skipped: { onboard: ['direction'] },
        completedAt: {},
      },
    })
    const p = progressFor(onboardWizard, snap)
    const step = p.steps.find(s => s.id === 'direction')!
    expect(step.status).toBe('skipped')
    // Skipped steps don't count as pending, so activeStepId advances past them.
    expect(p.activeStepId).not.toBe('direction')
  })

  it('skipped → done when the underlying fact flips', () => {
    const snap = baseSnap({
      hasDirection: true,
      wizardState: {
        version: 1,
        skipped: { onboard: ['direction'] },
        completedAt: {},
      },
    })
    const p = progressFor(onboardWizard, snap)
    // Underlying fact beats the skip marker: the user filled it in anyway.
    expect(p.steps.find(s => s.id === 'direction')!.status).toBe('done')
  })

  it('complete=true only when all 7 steps are done (not skipped)', () => {
    const allDone = progressFor(
      onboardWizard,
      baseSnap({
        config: {
          id: 'x',
          coordinators: [{ id: 'a' }],
          bootstrap: { verifiedAt: '2026-04-24T00:00:00Z' },
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
      }),
    )
    expect(allDone.complete).toBe(true)

    // Same but direction is skipped rather than done → not complete.
    const withSkip = progressFor(
      onboardWizard,
      baseSnap({
        config: {
          id: 'x',
          coordinators: [{ id: 'a' }],
          bootstrap: { verifiedAt: '2026-04-24T00:00:00Z' },
        },
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: {
          version: 1,
          skipped: { onboard: ['direction'] },
          completedAt: {},
        },
      }),
    )
    expect(withSkip.complete).toBe(false)
  })

  it('steps declare which are skippable vs hard prerequisites', () => {
    const byId = new Map(onboardWizard.steps.map(s => [s.id, s]))
    // Hard prerequisites: identity, provider, bootstrap, coordinator, firstTask.
    expect(byId.get('identity')!.skippable).toBe(false)
    expect(byId.get('provider')!.skippable).toBe(false)
    expect(byId.get('bootstrap')!.skippable).toBe(false)
    expect(byId.get('coordinator')!.skippable).toBe(false)
    expect(byId.get('firstTask')!.skippable).toBe(false)
    // Soft — the harness works without them, but quality suffers.
    expect(byId.get('direction')!.skippable).toBe(true)
    expect(byId.get('workspaceImport')!.skippable).toBe(true)
  })
})

describe('buildSnapshot', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wizards-test-'))
    mkdirSync(join(tmp, 'memory'), { recursive: true })
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reads guildhall.yaml identity + bootstrap', () => {
    writeFileSync(
      join(tmp, 'guildhall.yaml'),
      'id: demo\nname: Demo\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  install: pnpm install\n  gates:\n    build: pnpm build\n',
    )
    const snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.config?.id).toBe('demo')
    expect(snap.config?.bootstrap?.verifiedAt).toBe('2026-04-24T00:00:00Z')
  })

  it('hasProvider=true when any non-empty provider entry is present', () => {
    const snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({
        providers: { 'anthropic-api': { apiKey: 'sk-ant-test' } },
      }),
    })
    expect(snap.hasProvider).toBe(true)
  })

  it('hasProvider=false on empty providers file', () => {
    const snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.hasProvider).toBe(false)
  })

  it('hasProvider=true when Codex OAuth credentials are detected on disk (no stored creds needed)', () => {
    const snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: true }),
    })
    expect(snap.hasProvider).toBe(true)
  })

  it('hasProvider=true when Claude Code OAuth credentials are detected on disk (no stored creds needed)', () => {
    const snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: true, codex: false }),
    })
    expect(snap.hasProvider).toBe(true)
  })

  it('hasDirection=true only when brief has substance (>40 chars)', () => {
    writeFileSync(join(tmp, 'memory', 'project-brief.md'), 'short')
    let snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.hasDirection).toBe(false)

    writeFileSync(
      join(tmp, 'memory', 'project-brief.md'),
      'We are building X so that users can do Y. Done looks like Z.',
    )
    snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.hasDirection).toBe(true)
  })

  it('workspaceImportReviewed=true via goals.json OR dismiss marker OR no anchors', () => {
    // No anchors at all → automatically reviewed.
    let snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.workspaceImportReviewed).toBe(true)

    // Now add a README anchor — reviewed flips to false until action is taken.
    writeFileSync(join(tmp, 'README.md'), '# demo')
    snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.workspaceImportReviewed).toBe(false)

    // Dismiss marker → reviewed true.
    writeFileSync(join(tmp, 'memory', 'workspace-import-dismissed'), '')
    snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.workspaceImportReviewed).toBe(true)
  })

  it('taskCount handles both array and {tasks:[]} shapes', () => {
    writeFileSync(join(tmp, 'memory', 'TASKS.json'), JSON.stringify([{ id: 'a' }, { id: 'b' }]))
    let snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.taskCount).toBe(2)

    writeFileSync(
      join(tmp, 'memory', 'TASKS.json'),
      JSON.stringify({ tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    )
    snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.taskCount).toBe(3)
  })

  it('reads wizards.yaml into snapshot.wizardState', () => {
    writeFileSync(
      join(tmp, 'memory', 'wizards.yaml'),
      'version: 1\nskipped:\n  onboard:\n    - direction\ncompletedAt: {}\n',
    )
    const snap = buildSnapshot({
      projectPath: tmp,
      readProviders: () => ({ providers: {} }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    })
    expect(snap.wizardState.skipped['onboard']).toEqual(['direction'])
  })
})
