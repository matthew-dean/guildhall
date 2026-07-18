#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const roots = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map(root => resolve(repoRoot, root))
  : [join(repoRoot, 'src')]

const dataLayerModules = new Set([
  'src/config/global-config.ts',
  'src/config/global-providers.ts',
  'src/config/project-config.ts',
  'src/config/registry.ts',
  'src/config/workspace-config.ts',
  'src/memory-core/audit.ts',
  'src/memory-core/data-access.ts',
  'src/persistence/file-backed.ts',
  'src/persistence/json-files.ts',
  'src/persistence/managed-files.ts',
  'src/runtime/migrations.ts',
  'src/runtime/project-state-compaction.ts',
  'src/runtime/thin-project-state-manifest.ts',
  'src/sessions/atomic.ts',
  'src/sessions/local-history.ts',
  'src/sessions/project-state-database.ts',
  'src/sessions/delivery-read-projection.ts',
  'src/sessions/fleet-state-database.ts',
  'src/sessions/project-state-store.ts',
  'src/sessions/storage.ts',
  'src/sessions/task-state-store.ts',
])

const ioPattern = /\b(?:fs|fsp)?\.?(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream)\b|\b(?:atomicWriteText|readManagedTextFile|readManagedTextFileSync|writeManagedTextFile|writeManagedTextFileSync|appendManagedTextFile)\s*\(/g
const forbiddenManagedPathPattern = /getProjectStateDir|getProjectLocalHistoryDir|getProjectTaskLocalHistoryDir|getProjectRuntime|getDataDir|\.guildhall|guildhall-persistence|\bpath\.join\s*\(\s*(?:memoryDir|projectStateDir|localHistoryDir|stateDir)/
const allowedStorageBoundaryPattern = /getProjectSystemStatePath|getProjectSystemStatePathFromMemoryDir|getLegacyProjectStatePath|getProjectRuntimeDevServersPath|getProjectTaskReviewPacketPath|projectTasksPath|projectBriefPath|workspaceImportTasksPath|projectLearningPath|projectSkillProposalsPath/
const historicalAuthorityPattern = /\breadProjectStateDatabaseAuthority(?:FromTasksPath)?\s*\(/g
const historicalAuthorityAllowedModules = new Set([
  'src/runtime/migrations.ts',
  'src/runtime/project-summary-projection.ts',
  'src/sessions/project-state-database.ts',
])
const directSqlitePattern = /(?:from\s+['"]node:sqlite['"]|require\s*\(\s*['"]node:sqlite['"]\s*\)|\bDatabaseSync\b)/
const directSqliteAllowedModules = new Set([
  'src/runtime/migrations.ts',
  'src/sessions/project-state-database.ts',
  'src/sessions/fleet-state-database.ts',
])
const projectStateDatabaseReaderPattern = /\breadProjectStateDatabase[A-Za-z0-9_]*\s*\(/g
const aggregateDataReaderPattern = /\breadProjectStateDatabase(?:Summary|ReadBundle|CurrentState|ProjectionState|SurfaceState|ShellState|TaskDetailState|Thread(?:History)?SurfaceState|CurrentTasksWithRevision|TaskPointsWithRevision)\s*\(/g
const aggregateDataReaderAllowedModules = new Set([
  // The runtime boundary is the only adapter that turns a sessions snapshot
  // into route-facing project state.
  'src/runtime/project-state-boundary.ts',
  // The summary projector is a writer-side projection worker, not a route.
  'src/runtime/project-summary-projection.ts',
  // Thread projection writers/read adapters own their bounded sessions reads.
  'src/runtime/current-thread-refresh.ts',
  'src/runtime/thread-read-projection.ts',
])
const promotedStateReaderAllowedModules = new Set([
  ...dataLayerModules,
  // Import/bootstrap readers are explicit source conversion lanes.
  'src/runtime/intake.ts',
  'src/runtime/meta-intake.ts',
  'src/runtime/workspace-importer.ts',
  'src/runtime/project-state-boundary.ts',
  // Projection writers and bounded read adapters own their source reads.
  'src/runtime/attention-projection.ts',
  'src/runtime/attention.ts',
  'src/runtime/current-thread-refresh.ts',
  'src/runtime/effective-task.ts',
  'src/runtime/project-availability.ts',
  'src/runtime/project-runtime-command.ts',
  'src/runtime/project-summary-projection.ts',
  'src/runtime/run-automation.ts',
  'src/runtime/runtime-compatibility.ts',
  'src/runtime/stale-blocker-repair.ts',
  'src/runtime/owner-input-state-repair.ts',
  'src/runtime/orchestrator.ts',
  'src/runtime/thread-read-projection.ts',
  // Restoration is an explicit migration/repair operation, not a route read.
  'src/runtime/evacuated-task-state-restore.ts',
])
const routeAggregateTaskReaderPattern = /\breadProjectStateDatabaseTasks\s*\(/g
const routeDirectStateReaderPattern = /\breadProjectStateDatabase(?:Queue|QueueRevision|QueueWithRevision|Inventory|CurrentThread|TaskPoint|TaskRelationships|TaskEvidenceCurrentMany|Repository|Metadata|CurrentAuthority)\s*\(/g
const legacyCurrentStateReaderPattern = /\b(?:readTaskQueueFileNormalized|readTasksFileNormalized)\s*\(/g
const routeDirectHistoryReaderPattern = /\breadTaskEvidence(?:Page)?\s*\(/g
const routeDirectAttentionReaderPattern = /\breadAttentionRecords\s*\(/g
const routeDirectSummaryReaderPattern = /\breadProjectSummary(?:Projection|ShellProjection|AtBoundary)\s*\(/g
const releaseRoutePattern = /app\.get\(['"]\/api\/project\/release-readiness['"]/g
const releaseReadBoundaryPattern = /\breadProjectReleaseState\s*\(/g
const releaseBuilderStartPattern = /async function buildProjectReleaseReadinessPayload\s*\(/g
const releaseBuilderEndPattern = /\n\s*async function refreshProjectDiagnosticProjection\s*\(/g
const projectionSurfaceBuilderPattern = /async function buildProjectionSurfaceDetail\s*\(/g
const directEffectiveTaskPattern = /\bbuildEffectiveTask\s*\(/g
const ordinaryReleaseRoutePattern = /app\.get\(['"]\/api\/project\/(?:release-readiness(?:\/summary)?|task\/:id)['"]/g
const projectRoutePattern = /app\.get\(\s*(['"])(\/api\/project[^'"]*)\1/g
const intakeOnlyTaskRecordPattern = /\b(?:WORKSPACE_IMPORT_TASK_ID|META_INTAKE_TASK_ID|workspaceImportTasksPath|createWorkspaceImportTask|materialize(?:Parsed)?WorkspaceImport(?:Draft)?|read(?:WorkspaceGoalsState|WorkspaceImportSummary)|savedWorkspaceImport(?:Draft|TaskStatus)|listPressureTestIntakes|loadPressureTestIntake|normalizeImportedDraftTask)\b|(?:domain\s*:\s*['"]_workspace_import['"]|status\s*:\s*['"]import_draft['"]|source\s*:\s*['"]workspace-import['"]|id\s*:\s*['"](?:task-meta-intake|task-workspace-import)['"])/
const taskCollectionPattern = /(?:\b(?:tasks|taskRecords|taskCollection)\s*(?:[?:,}]|$)|\.\s*(?:tasks|taskRecords|taskCollection)\b)/

export function analyzeDataLayerGuardrails(input = {}) {
  const root = input.repoRoot ? resolve(input.repoRoot) : repoRoot
  const scanRoots = input.roots?.length
    ? input.roots.map(scanRoot => resolve(root, scanRoot))
    : roots
  const offenders = []
  for (const file of scanRoots.flatMap(scanRoot => sourceFiles(scanRoot))) {
    const rel = relative(root, file)
    if (!/\.(?:ts|js|mjs)$/.test(rel)) continue
    if (rel.includes('/__tests__/') || /\.test\.(?:ts|js|mjs)$/.test(rel)) continue
    if (dataLayerModules.has(rel)) continue
    const text = readFileSync(file, 'utf8')
    if (!directSqliteAllowedModules.has(rel) && directSqlitePattern.test(text)) {
      offenders.push(`${rel}:direct-sqlite-reader`)
    }
    if (rel.startsWith('src/runtime/') && rel !== 'src/runtime/serve.ts' && !promotedStateReaderAllowedModules.has(rel)) {
      projectStateDatabaseReaderPattern.lastIndex = 0
      if (projectStateDatabaseReaderPattern.test(text)) {
        aggregateDataReaderPattern.lastIndex = 0
        offenders.push(`${rel}:${aggregateDataReaderPattern.test(text)
          ? 'aggregate-reader-outside-state-boundary'
          : 'project-state-reader-outside-data-layer'}`)
      }
    } else if (!aggregateDataReaderAllowedModules.has(rel)) {
      aggregateDataReaderPattern.lastIndex = 0
      if (aggregateDataReaderPattern.test(text)) {
        offenders.push(`${rel}:aggregate-reader-outside-state-boundary`)
      }
    }
      if (rel === 'src/runtime/serve.ts') {
      routeAggregateTaskReaderPattern.lastIndex = 0
      if (routeAggregateTaskReaderPattern.test(text)) {
        offenders.push(`${rel}:aggregate-task-reader`)
      }
      routeDirectStateReaderPattern.lastIndex = 0
      if (routeDirectStateReaderPattern.test(text)) {
        offenders.push(`${rel}:direct-state-reader`)
      }
      routeDirectHistoryReaderPattern.lastIndex = 0
      if (routeDirectHistoryReaderPattern.test(text)) {
        offenders.push(`${rel}:direct-history-reader`)
      }
      routeDirectAttentionReaderPattern.lastIndex = 0
      if (routeDirectAttentionReaderPattern.test(text)) {
        offenders.push(`${rel}:direct-attention-reader`)
      }
      routeDirectSummaryReaderPattern.lastIndex = 0
      if (routeDirectSummaryReaderPattern.test(text)) {
        offenders.push(`${rel}:direct-summary-reader`)
      }

      // The generic database-reader rule intentionally skips serve.ts so that
      // explicit import, migration, and diagnostic handlers can keep their
      // own bounded source reads. Promoted current-state GETs are the narrow
      // exception: every one must consume the runtime boundary.
      projectRoutePattern.lastIndex = 0
      let projectRouteMatch
      while ((projectRouteMatch = projectRoutePattern.exec(text)) !== null) {
        const routePath = projectRouteMatch[2]
        if (!isPromotedCurrentStateRoute(routePath)) continue
        const route = blockBodyAt(text, projectRouteMatch.index)
        if (!containsPattern(projectStateDatabaseReaderPattern, route)) continue
        if (containsPattern(routeAggregateTaskReaderPattern, route) || containsPattern(routeDirectStateReaderPattern, route)) continue
        offenders.push(`${rel}:direct-state-reader`)
      }

      // Release/readiness is a current-state surface. Its route and builder
      // must be coupled to the named project-state boundary, never to the
      // workspace-import/provenance reader. Intake routes elsewhere in this
      // module are allowed to read that provenance explicitly.
      releaseRoutePattern.lastIndex = 0
      const releaseRouteStart = releaseRoutePattern.exec(text)?.index ?? -1
      if (releaseRouteStart >= 0) {
        const releaseRoute = blockBodyAt(text, releaseRouteStart)
        releaseReadBoundaryPattern.lastIndex = 0
        if (!releaseReadBoundaryPattern.test(releaseRoute)) {
          offenders.push(`${rel}:release-route-without-state-boundary`)
        }
      }
      releaseBuilderStartPattern.lastIndex = 0
      const releaseBuilderStart = releaseBuilderStartPattern.exec(text)?.index ?? -1
      releaseBuilderEndPattern.lastIndex = 0
      const releaseBuilderEnd = releaseBuilderEndPattern.exec(text)?.index ?? -1
      if (releaseBuilderStart >= 0) {
        const releaseBuilder = text.slice(releaseBuilderStart, releaseBuilderEnd > releaseBuilderStart ? releaseBuilderEnd : undefined)
        const ordinaryBuilderEnd = releaseBuilder.indexOf('if (input.liveDiagnostics !== true)')
        const ordinaryBuilder = ordinaryBuilderEnd >= 0 ? releaseBuilder.slice(0, ordinaryBuilderEnd) : releaseBuilder
        if (containsPattern(projectStateDatabaseReaderPattern, ordinaryBuilder)) {
          offenders.push(`${rel}:release-builder-direct-state-reader`)
        }
        if (containsPattern(legacyCurrentStateReaderPattern, ordinaryBuilder)) {
          offenders.push(`${rel}:release-builder-legacy-current-state-reader`)
        }
        if (intakeOnlyTaskRecordPattern.test(ordinaryBuilder)) {
          offenders.push(`${rel}:release-builder-intake-reader`)
        }
      }

      projectionSurfaceBuilderPattern.lastIndex = 0
      const projectionSurfaceStart = projectionSurfaceBuilderPattern.exec(text)?.index ?? -1
      if (projectionSurfaceStart >= 0) {
        const projectionSurface = blockBodyAt(text, projectionSurfaceStart)
        directEffectiveTaskPattern.lastIndex = 0
        if (directEffectiveTaskPattern.test(projectionSurface)) {
          offenders.push(`${rel}:projection-surface-direct-effective-task-reader`)
        }
        if (containsPattern(projectStateDatabaseReaderPattern, projectionSurface)) {
          offenders.push(`${rel}:projection-surface-direct-state-reader`)
        }
        if (containsPattern(legacyCurrentStateReaderPattern, projectionSurface)) {
          offenders.push(`${rel}:projection-surface-legacy-current-state-reader`)
        }
      }

      ordinaryReleaseRoutePattern.lastIndex = 0
      let routeMatch
      while ((routeMatch = ordinaryReleaseRoutePattern.exec(text)) !== null) {
        const route = blockBodyAt(text, routeMatch.index)
        if (intakeOnlyTaskRecordPattern.test(route)) {
          offenders.push(`${rel}:ordinary-route-intake-task-record`)
        }
      }
    }
    if (rel === 'src/runtime/project-state-boundary.ts') {
      const savedReleaseModel = namedBlockBody(text, /\b(?:interface|type)\s+ProjectSavedReleaseReadModel\b/)
      const savedReleaseReader = namedBlockBody(text, /\b(?:async\s+)?function\s+readProjectSavedReleaseState\s*\(/)
      if ((savedReleaseModel && taskCollectionPattern.test(savedReleaseModel)) ||
        (savedReleaseReader && taskCollectionPattern.test(savedReleaseReader))) {
        offenders.push(`${rel}:saved-release-task-collection`)
      }
    }
    if (!historicalAuthorityAllowedModules.has(rel)) {
      historicalAuthorityPattern.lastIndex = 0
      if (historicalAuthorityPattern.test(text)) {
        offenders.push(`${rel}:historical-authority-reader`)
      }
    }
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (/^\s*import\b/.test(line)) continue
      ioPattern.lastIndex = 0
      if (!ioPattern.test(line)) continue
      const window = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join('\n')
      if (forbiddenManagedPathPattern.test(window) && !allowedStorageBoundaryPattern.test(window)) {
        offenders.push(`${rel}:${index + 1}`)
      }
    }
  }
  return offenders
}

function namedBlockBody(text, declarationPattern) {
  const start = text.search(declarationPattern)
  if (start < 0) return null
  return blockBodyAt(text, start)
}

function containsPattern(pattern, text) {
  pattern.lastIndex = 0
  return pattern.test(text)
}

function isPromotedCurrentStateRoute(path) {
  return path === '/api/project' || path === '/api/service' || path === '/api/service/projects' || path === '/api/fleet/attention' || /^\/api\/project\/(?:spine|project-graph|progress|delivery-spine(?:\/queue)?|release-readiness(?:\/summary)?|task\/:id|activity|inbox|thread|git-story)$/.test(path)
}

function blockBodyAt(text, start) {
  const open = text.indexOf('{', start)
  if (open < 0) return text.slice(start)
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] !== '}') continue
    depth -= 1
    if (depth === 0) return text.slice(open + 1, index)
  }
  return text.slice(open + 1)
}

function sourceFiles(dir) {
  if (!existsSync(dir)) return []
  const stat = statSync(dir)
  if (stat.isFile()) return [dir]
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const offenders = analyzeDataLayerGuardrails()
  if (offenders.length > 0) {
    console.error([
      'Guildhall data-layer guardrail failed.',
      'Feature code must not read or write Guildhall-managed data paths directly.',
      'Route reads/writes through @guildhall/persistence or a storage module owned by the data layer.',
      '',
      ...offenders.map(file => `- ${file}`),
    ].join('\n'))
    process.exit(1)
  }
}
