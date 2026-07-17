import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  appendTaskEvidence,
  readTaskEvidence,
  readTaskEvidencePage,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
  runtimeStatePath,
  taskEvidencePath,
  compressedTaskEvidencePath,
  taskWorkspaceStatePath,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
} from '../task-state-store.js'
import {
  getProjectLocalHistoryDir,
  getProjectTaskLocalHistoryDir,
  promoteProjectStateDatabaseAuthority,
  projectStateDatabasePath,
  readProjectStateDatabaseTaskEvidenceHistory,
  readProjectStateDatabaseTaskOverlay,
  setProjectStateDatabaseTaskEvidenceAuthority,
} from '@guildhall/sessions'

describe('task state store', () => {
  it('stores runtime state in system-local project history', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-state-'))

    await upsertTaskRuntimeState(projectRoot, 'task-1', {
      assignedTo: 'worker-agent',
      revisionCount: 2,
      updatedAt: '2026-05-24T20:00:00.000Z',
    })

    expect(runtimeStatePath(projectRoot)).toBe(path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'tasks.json'))
    const store = await readTaskRuntimeStore(projectRoot)
    expect(store.tasks['task-1']).toMatchObject({
      taskId: 'task-1',
      assignedTo: 'worker-agent',
      revisionCount: 2,
    })
  })

  it('stores task workspaces separately from task definitions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-workspace-'))

    await upsertTaskWorkspaceState(projectRoot, 'task-1', {
      worktreePath: '~/.guildhall/worktrees/demo/task-1',
      branchName: 'guildhall/task-1',
      baseBranch: 'main',
      updatedAt: '2026-05-24T20:00:00.000Z',
    })
    expect(taskWorkspaceStatePath(projectRoot)).toBe(path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'task-workspaces.json'))
    const store = await readTaskWorkspaceStore(projectRoot)
    expect(store.workspaces['task-1']).toMatchObject({
      taskId: 'task-1',
      worktreePath: '~/.guildhall/worktrees/demo/task-1',
      branchName: 'guildhall/task-1',
      baseBranch: 'main',
    })
  })

  it('reads the database overlay instead of a stale compatibility JSON store', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-state-authority-'))

    await upsertTaskRuntimeState(projectRoot, 'task-1', {
      assignedTo: 'database-worker',
      updatedAt: '2026-05-24T20:00:00.000Z',
    })
    await upsertTaskWorkspaceState(projectRoot, 'task-1', {
      branchName: 'guildhall/database-task-1',
      updatedAt: '2026-05-24T20:00:00.000Z',
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    await fs.writeFile(runtimeStatePath(projectRoot), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-24T21:00:00.000Z',
      tasks: { 'task-1': { taskId: 'task-1', assignedTo: 'stale-file-worker' } },
    }))
    await fs.writeFile(taskWorkspaceStatePath(projectRoot), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-24T21:00:00.000Z',
      workspaces: { 'task-1': { taskId: 'task-1', branchName: 'stale-file-branch' } },
    }))

    await expect(readTaskRuntimeStore(projectRoot)).resolves.toMatchObject({
      tasks: { 'task-1': { assignedTo: 'database-worker' } },
    })
    await expect(readTaskWorkspaceStore(projectRoot)).resolves.toMatchObject({
      workspaces: { 'task-1': { branchName: 'guildhall/database-task-1' } },
    })

    await upsertTaskRuntimeState(projectRoot, 'task-1', {
      assignedTo: 'database-only-worker',
      updatedAt: '2026-05-24T22:00:00.000Z',
    })
    await upsertTaskWorkspaceState(projectRoot, 'task-1', {
      branchName: 'guildhall/database-only-task-1',
      updatedAt: '2026-05-24T22:00:00.000Z',
    })

    expect(JSON.parse(await fs.readFile(runtimeStatePath(projectRoot), 'utf8')).tasks['task-1']).toMatchObject({
      assignedTo: 'stale-file-worker',
    })
    expect(JSON.parse(await fs.readFile(taskWorkspaceStatePath(projectRoot), 'utf8')).workspaces['task-1']).toMatchObject({
      branchName: 'stale-file-branch',
    })
    await expect(readTaskRuntimeStore(projectRoot)).resolves.toMatchObject({
      tasks: { 'task-1': { assignedTo: 'database-only-worker' } },
    })
    await expect(readTaskWorkspaceStore(projectRoot)).resolves.toMatchObject({
      workspaces: { 'task-1': { branchName: 'guildhall/database-only-task-1' } },
    })
  })

  it('appends task evidence under the system-local task history directory', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-'))

    await appendTaskEvidence(projectRoot, 'task-1', {
      id: 'note-1',
      kind: 'note',
      recordedAt: '2026-05-24T20:00:00.000Z',
      payload: {
        agentId: 'worker-agent',
        role: 'worker',
        content: 'Implemented the thing.',
        timestamp: '2026-05-24T20:00:00.000Z',
      },
    })

    expect(taskEvidencePath(projectRoot, 'task-1', 'note')).toBe(path.join(getProjectTaskLocalHistoryDir(projectRoot, 'task-1'), 'notes.jsonl'))
    const events = await readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'note-1',
      taskId: 'task-1',
      kind: 'note',
      payload: {
        content: 'Implemented the thing.',
      },
    })
  })

  it('pages task history with an explicit byte ceiling', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-page-'))
    const file = taskEvidencePath(projectRoot, 'task-1', 'note')
    await fs.mkdir(path.dirname(file), { recursive: true })
    const records = Array.from({ length: 12 }, (_, index) => JSON.stringify({
      id: `note-${index}`,
      taskId: 'task-1',
      kind: 'note',
      recordedAt: `2026-05-24T20:${String(index).padStart(2, '0')}:00.000Z`,
      payload: { content: `Note ${index} ${'x'.repeat(80)}` },
    })).join('\n')
    await fs.writeFile(file, `${records}\n`, 'utf8')

    const page = await readTaskEvidencePage(projectRoot, 'task-1', {
      kind: 'note',
      order: 'oldest',
      limit: 10,
      maxBytes: 512,
    })

    expect(page.total).toBe(12)
    expect(page.events.length).toBeGreaterThan(0)
    expect(page.bytes).toBeLessThanOrEqual(512)
    expect(page.events[0]?.id).toBe('note-0')
    expect(page.hasMore).toBe(true)
  })

  it('keeps verbose gate output out of durable history and SQLite current state', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-boundary-'))
    const output = `${'failure detail '.repeat(20_000)}\nend of command output`

    await appendTaskEvidence(projectRoot, 'task-1', {
      id: 'gate-1',
      kind: 'gate_result',
      recordedAt: '2026-05-24T20:00:00.000Z',
      payload: {
        gateId: 'test',
        type: 'hard',
        passed: false,
        output,
        checkedAt: '2026-05-24T20:00:00.000Z',
      },
    })

    const stored = await readTaskEvidence(projectRoot, 'task-1', { kind: 'gate_result' })
    const storedOutput = stored[0]?.payload.output
    expect(typeof storedOutput).toBe('string')
    expect(String(storedOutput).length).toBeLessThan(2_500)
    expect(String(storedOutput)).toContain('durable evidence excerpt bounded')
    expect((await fs.stat(taskEvidencePath(projectRoot, 'task-1', 'gate_result'))).size).toBeLessThan(4_000)

    const overlay = readProjectStateDatabaseTaskOverlay(projectRoot, 'task-1')
    const proofPayload = overlay?.latestProof?.payload as Record<string, unknown> | undefined
    expect(String(proofPayload?.output)).toBe(String(storedOutput))
  })

  it('bounds note history at the write boundary while keeping current state available', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-retention-'))

    for (let index = 0; index < 100; index += 1) {
      await appendTaskEvidence(projectRoot, 'task-1', {
        id: `note-${index}`,
        kind: 'note',
        recordedAt: new Date(Date.parse('2026-05-24T20:00:00.000Z') + index * 1000).toISOString(),
        payload: {
          agentId: 'worker-agent',
          role: 'worker',
          content: `Essential note ${index} ${'x'.repeat(900)}`,
          timestamp: '2026-05-24T20:00:00.000Z',
        },
      })
    }

    const file = taskEvidencePath(projectRoot, 'task-1', 'note')
    const stored = await readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })
    expect(stored.length).toBeLessThanOrEqual(64)
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(64 * 1024)
    expect(stored.at(-1)?.id).toBe('note-99')
    expect(stored.filter(event => event.id === 'note-99')).toHaveLength(1)
  })

  it('stores new evidence in bounded SQLite history after the authority boundary', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-database-'))
    promoteProjectStateDatabaseAuthority(projectRoot)

    await appendTaskEvidence(projectRoot, 'task-1', {
      id: 'note-database-1',
      kind: 'note',
      recordedAt: '2026-05-24T20:00:00.000Z',
      payload: { content: 'Stored in the current-state database.' },
    })

    await expect(fs.stat(taskEvidencePath(projectRoot, 'task-1', 'note'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-1', 'note')).toMatchObject([{
      id: 'note-database-1',
      taskId: 'task-1',
      kind: 'note',
      payload: { content: 'Stored in the current-state database.' },
    }])
    await expect(readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })).resolves.toMatchObject([{
      id: 'note-database-1',
    }])
    await expect(readTaskEvidencePage(projectRoot, 'task-1', { kind: 'note' })).resolves.toMatchObject({
      total: 1,
      events: [{ id: 'note-database-1' }],
    })
  })

  it('requires an explicit migration read when promoted state still has legacy evidence files', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-migration-boundary-'))
    const file = taskEvidencePath(projectRoot, 'task-1', 'note')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify({
      id: 'legacy-note-1',
      taskId: 'task-1',
      kind: 'note',
      recordedAt: '2026-05-24T20:00:00.000Z',
      payload: { content: 'Legacy detail awaiting migration.' },
    })}\n`, 'utf8')
    promoteProjectStateDatabaseAuthority(projectRoot)

    await expect(readTaskEvidence(projectRoot, 'task-1', { kind: 'note' }))
      .rejects.toThrow(/migration required/i)
    await expect(readTaskEvidence(projectRoot, 'task-1', { kind: 'note', allowLegacy: true }))
      .resolves.toMatchObject([{ id: 'legacy-note-1' }])
  })

  it('keeps new evidence in the compressed ledger after the history migration', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-compressed-'))
    promoteProjectStateDatabaseAuthority(projectRoot)
    setProjectStateDatabaseTaskEvidenceAuthority(projectRoot, 'compressed')

    await appendTaskEvidence(projectRoot, 'task-1', {
      id: 'note-compressed-1',
      kind: 'note',
      recordedAt: '2026-05-24T20:00:00.000Z',
      payload: { content: 'Stored in the compact history ledger.' },
    })

    await expect(fs.stat(taskEvidencePath(projectRoot, 'task-1', 'note'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(compressedTaskEvidencePath(projectRoot, 'task-1', 'note'))).resolves.toBeDefined()
    await expect(readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })).resolves.toMatchObject([{ id: 'note-compressed-1' }])
    expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-1', 'note')).toEqual([])
  })

  it('fails closed when normalized evidence history is unavailable', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-missing-history-'))
    try {
      promoteProjectStateDatabaseAuthority(projectRoot)
      setProjectStateDatabaseTaskEvidenceAuthority(projectRoot, 'database')
      const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
      database.exec('DROP TABLE task_evidence_history')
      database.close()

      await expect(readTaskEvidence(projectRoot, 'task-1', { kind: 'note' }))
        .rejects.toThrow(/Normalized task evidence history is unavailable/)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('serializes concurrent compressed-history appends without dropping events', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-concurrent-'))
    promoteProjectStateDatabaseAuthority(projectRoot)
    setProjectStateDatabaseTaskEvidenceAuthority(projectRoot, 'compressed')

    await Promise.all(Array.from({ length: 24 }, (_, index) => appendTaskEvidence(projectRoot, 'task-1', {
      id: `note-concurrent-${index}`,
      kind: 'note',
      recordedAt: new Date(Date.parse('2026-05-24T20:00:00.000Z') + index * 1000).toISOString(),
      payload: { content: `Concurrent event ${index}` },
    })))

    const events = await readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })
    expect(events).toHaveLength(24)
    expect(new Set(events.map(event => event.id))).toEqual(new Set(
      Array.from({ length: 24 }, (_, index) => `note-concurrent-${index}`),
    ))
  })

  it('retains compressed history by event time rather than append order', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-order-'))
    promoteProjectStateDatabaseAuthority(projectRoot)
    setProjectStateDatabaseTaskEvidenceAuthority(projectRoot, 'compressed')

    await Promise.all(Array.from({ length: 70 }, (_, offset) => {
      const index = 69 - offset
      return appendTaskEvidence(projectRoot, 'task-1', {
        id: `note-order-${index}`,
        kind: 'note',
        recordedAt: new Date(Date.parse('2026-05-24T20:00:00.000Z') + index * 1000).toISOString(),
        payload: { content: `Out-of-order event ${index}` },
      })
    }))

    const events = await readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })
    expect(events).toHaveLength(64)
    expect(events[0]?.id).toBe('note-order-6')
    expect(events.at(-1)?.id).toBe('note-order-69')
  })
})
