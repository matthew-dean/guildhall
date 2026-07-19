import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { analyzeDataLayerGuardrails } from './data-layer-guardrails.mjs'

describe('data-layer guardrails', () => {
  it('flags feature code that reads Guildhall managed data paths directly', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-reader.ts'), [
        "import fs from 'node:fs/promises'",
        "import { getProjectStateDir } from '@guildhall/sessions'",
        '',
        'export async function readBad(projectRoot: string) {',
        "  return fs.readFile(`${getProjectStateDir(projectRoot)}/bad.json`, 'utf8')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-reader.ts:5',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flags feature code that writes Guildhall managed data paths directly', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-feature.ts'), [
        "import fs from 'node:fs/promises'",
        "import { getProjectStateDir } from '@guildhall/sessions'",
        '',
        'export async function writeBad(projectRoot: string) {',
        "  await fs.writeFile(`${getProjectStateDir(projectRoot)}/bad.json`, '{}')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-feature.ts:5',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flags managed-wrapper writes when feature code constructs the Guildhall data path', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-managed-wrapper.ts'), [
        "import path from 'node:path'",
        "import { writeManagedTextFile } from '@guildhall/persistence'",
        '',
        'export async function writeBad(memoryDir: string) {',
        "  await writeManagedTextFile(path.join(memoryDir, 'TASKS.json'), '{}')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-managed-wrapper.ts:5',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows writes owned by the data layer', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'persistence')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'file-backed.ts'), [
        "import fs from 'node:fs/promises'",
        "import { getProjectLocalHistoryDir } from '@guildhall/sessions'",
        '',
        'export async function writeOwned(projectRoot: string) {',
        "  await fs.writeFile(`${getProjectLocalHistoryDir(projectRoot)}/record.json`, '{}')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flags direct SQLite access in feature code', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-sqlite-reader.ts'), [
        "import { DatabaseSync } from 'node:sqlite'",
        '',
        'export function readBad() {',
        '  return new DatabaseSync("state.sqlite", { readOnly: true })',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-sqlite-reader.ts:direct-sqlite-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows SQLite access owned by the sessions boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'sessions')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'project-state-database.ts'), [
        "import { DatabaseSync } from 'node:sqlite'",
        '',
        'export function readOwned() {',
        '  return new DatabaseSync("state.sqlite", { readOnly: true })',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects aggregate project-state reads outside the shared state boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-aggregate-reader.ts'), [
        "import { readProjectStateDatabaseReadBundle } from '@guildhall/sessions'",
        '',
        'export function readBad(tasksPath: string) {',
        '  return readProjectStateDatabaseReadBundle(tasksPath, { includeProjection: true })',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-aggregate-reader.ts:aggregate-reader-outside-state-boundary',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects saved summary and Thread surface reads outside projection boundaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-aggregate-reader.ts'), [
        "import { readProjectStateDatabaseSummary, readProjectStateDatabaseThreadSurfaceState } from '@guildhall/sessions'",
        '',
        'export function readBad(tasksPath: string, projectRoot: string) {',
        '  return [readProjectStateDatabaseSummary(tasksPath), readProjectStateDatabaseThreadSurfaceState(projectRoot)]',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-aggregate-reader.ts:aggregate-reader-outside-state-boundary',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows the shared state boundary and projection writer to read the sessions bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      for (const [file, reader] of [
        ['project-state-boundary.ts', 'readProjectStateDatabaseReadBundle'],
        ['project-summary-projection.ts', 'readProjectStateDatabaseReadBundle'],
        ['current-thread-refresh.ts', 'readProjectStateDatabaseSummary'],
        ['thread-read-projection.ts', 'readProjectStateDatabaseThreadHistorySurfaceState'],
      ] as const) {
        writeFileSync(join(dir, file), [
          `import { ${reader} } from '@guildhall/sessions'`,
          '',
          'export function readOwned(tasksPath: string) {',
          `  return ${reader}(tasksPath, {})`,
          '}',
          '',
        ].join('\n'))
      }

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the delivery projection SQLite boundary out of runtime', () => {
    expect(analyzeDataLayerGuardrails({
      repoRoot: process.cwd(),
      roots: ['src/runtime/delivery-read-projection.ts'],
    })).toEqual([])
  })

  it('rejects aggregate task reads from the route module', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "import { readProjectStateDatabaseTasks } from '@guildhall/sessions'",
        '',
        'export function readRoute(tasksPath: string) {',
        '  return readProjectStateDatabaseTasks(tasksPath, [])',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:aggregate-task-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects direct project-state reads from the route module', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "import { readProjectStateDatabaseTaskPoint } from '@guildhall/sessions'",
        '',
        'export function readRoute(tasksPath: string) {',
        "  return readProjectStateDatabaseTaskPoint(tasksPath, 'task-1')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:direct-state-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a project-state database reader whose name is outside the legacy matcher', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-project-state-reader-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "app.get('/api/project/release-readiness', async c => {",
        '  const saved = await readProjectReleaseState(project.path)',
        '  const queue = readProjectStateDatabaseQueueDefinition(tasksPath)',
        '  return c.json({ saved, queue })',
        '})',
        '',
        'async function refreshProjectDiagnosticProjection(projectRoot: string) {}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:direct-state-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects legacy current-state readers from the ordinary Release builder', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-release-legacy-reader-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "app.get('/api/project/release-readiness', async c => {",
        '  return c.json(await readProjectReleaseState(project.path))',
        '})',
        '',
        'async function buildProjectReleaseReadinessPayload(input: unknown) {',
        '  const legacyQueue = await readTaskQueueFileNormalized(tasksPath)',
        '  return { input, legacyQueue }',
        '}',
        '',
        'async function refreshProjectDiagnosticProjection(projectRoot: string) {}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:release-builder-legacy-current-state-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects direct task-history reads from the route module', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "import { readTaskEvidencePage } from '@guildhall/sessions'",
        '',
        'export function readRoute(projectRoot: string) {',
        "  return readTaskEvidencePage(projectRoot, 'task-1')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:direct-history-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects raw attention reads from the route module', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "import { readAttentionRecords } from './attention.js'",
        '',
        'export function readRoute(projectRoot: string) {',
        '  return readAttentionRecords(projectRoot).filter(record => record.status === \'open\')',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:direct-attention-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects direct summary reads from the route module', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "import { readProjectSummaryShellProjection } from './project-summary-projection.js'",
        '',
        'export function readRoute(tasksPath: string) {',
        '  return readProjectSummaryShellProjection(tasksPath)',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:direct-summary-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires Release reads to use the current-state boundary and keeps intake out of the builder', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-release-boundary-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "app.get('/api/project/release-readiness', async c => {",
        "  return c.json(await readProjectReleaseState(project.path))",
        '})',
        '',
        'async function buildProjectReleaseReadinessPayload(input: unknown) {',
        '  return readWorkspaceGoalsState(project.path)',
        '}',
        '',
        'async function refreshProjectDiagnosticProjection(projectRoot: string) {}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:release-builder-intake-reader',
      ])

      writeFileSync(join(dir, 'serve.ts'), [
        "app.get('/api/project/release-readiness', async c => {",
        "  return c.json(await readWorkspaceGoalsState(project.path))",
        '})',
        '',
        'async function buildProjectReleaseReadinessPayload(input: unknown) {',
        '  return input',
        '}',
        '',
        'async function refreshProjectDiagnosticProjection(projectRoot: string) {}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:release-route-without-state-boundary',
        'src/runtime/serve.ts:ordinary-route-intake-task-record',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects intake-only task records from ordinary Release and task-detail routes', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-release-intake-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        "app.get('/api/project/release-readiness/summary', async c => {",
        '  const imported = await readWorkspaceImportSummary(project.path)',
        "  return c.json({ tasks: [{ id: WORKSPACE_IMPORT_TASK_ID, title: imported.tasks[0].title }] })",
        '})',
        '',
        "app.get('/api/project/release-readiness', async c => {",
        '  return c.json(await readProjectReleaseState(project.path))',
        '})',
        '',
        "app.get('/api/project/task/:id', async c => {",
        "  return c.json({ task: { id: 'task-meta-intake', domain: '_workspace_import' } })",
        '})',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:ordinary-route-intake-task-record',
        'src/runtime/serve.ts:ordinary-route-intake-task-record',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects task collections from the saved Release read model', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-saved-release-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'project-state-boundary.ts'), [
        'export interface ProjectSavedReleaseReadModel {',
        '  rawQueue: { releases: unknown[] }',
        '  tasks: unknown[]',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/project-state-boundary.ts:saved-release-task-collection',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects direct effective-task reconstruction from the compact surface builder', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-surface-boundary-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'serve.ts'), [
        'async function buildProjectionSurfaceDetail(input: unknown) {',
        '  return buildEffectiveTask(input.projectRoot, input.task)',
        '}',
        '',
        'async function unrelatedMutation(input: unknown) {',
        '  return buildEffectiveTask(input.projectRoot, input.task)',
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/serve.ts:projection-surface-direct-effective-task-reader',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
