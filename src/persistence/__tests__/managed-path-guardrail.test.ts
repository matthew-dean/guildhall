import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')

const approvedWriteModules = new Set([
  'src/persistence/file-backed.ts',
  'src/persistence/json-files.ts',
  'src/sessions/atomic.ts',
  'src/sessions/storage.ts',
  'src/sessions/task-state-store.ts',
  'src/sessions/local-history.ts',
  'src/memory-core/storage.ts',
  'src/runtime/project-runtime-command.ts',
])

const approvedMigratingModules = new Set([
  'src/corpus-map/storage.ts',
  'src/levers/storage.ts',
  'src/runtime/artifact-store.ts',
  'src/runtime/attention.ts',
  'src/runtime/bootstrap-runner.ts',
  'src/runtime/capability-requests.ts',
  'src/runtime/context-observability.ts',
  'src/runtime/design-system-store.ts',
  'src/runtime/dev-server-manager.ts',
  'src/runtime/git-driver.ts',
  'src/runtime/inbox.ts',
  'src/runtime/improvement-review.ts',
  'src/runtime/intake.ts',
  'src/runtime/language-map.ts',
  'src/runtime/learning.ts',
  'src/runtime/local-only-mode.ts',
  'src/runtime/memory-migration.ts',
  'src/runtime/meta-intake.ts',
  'src/runtime/migrations.ts',
  'src/runtime/orchestrator.ts',
  'src/runtime/owner-input-state-repair.ts',
  'src/runtime/owner-input-store.ts',
  'src/runtime/pressure-test-intake.ts',
  'src/runtime/project-availability.ts',
  'src/runtime/project-runtime-migration.ts',
  'src/runtime/project-runtime-store.ts',
  'src/runtime/project-state-compaction.ts',
  'src/runtime/request-intake.ts',
  'src/runtime/runtime-health.ts',
  'src/runtime/serve-supervisor.ts',
  'src/runtime/serve.ts',
  'src/runtime/stale-blocker-repair.ts',
  'src/runtime/stop-requested.ts',
  'src/runtime/task-hierarchy-migration.ts',
  'src/runtime/task-question-migration.ts',
  'src/runtime/task-state-migration.ts',
  'src/runtime/workspace-importer.ts',
  'src/runtime/worktree-manager.ts',
  'src/runtime/wizards.ts',
  'src/memory-core/prototype-runner.ts',
  'src/tools/agent-settings.ts',
  'src/tools/agent-settings-tool.ts',
  'src/tools/checkpoint.ts',
  'src/tools/design-system.ts',
  'src/tools/escalation.ts',
  'src/tools/files.ts',
  'src/tools/gate-runner.ts',
  'src/tools/mcp-auth.ts',
  'src/tools/memory.ts',
  'src/tools/report-issue.ts',
  'src/tools/run-gates-tool.ts',
  'src/tools/task-queue.ts',
  // Benchmark fixture materialization seeds disposable projects before running
  // Guildhall against them; these writes are not production project mutation paths.
  'src/benchmarks/runner.ts',
])

const writePattern = /\b(?:fs\.)?(?:writeFile|appendFile)\b|atomicWriteText\(|createWriteStream\(/g
const managedPathPattern = /getProjectStateDir|getProjectLocalHistoryDir|getProjectTaskLocalHistoryDir|getProjectRuntime|getDataDir|\.guildhall|guildhall-persistence|persistence/

describe('managed Guildhall path write guardrail', () => {
  it('blocks new direct managed-path writes outside persistence modules and documented migration exceptions', async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles(path.join(repoRoot, 'src'))) {
      const relative = path.relative(repoRoot, file)
      if (!relative.endsWith('.ts')) continue
      if (relative.includes('/__tests__/')) continue
      if (approvedWriteModules.has(relative) || approvedMigratingModules.has(relative)) continue
      const text = await fs.readFile(file, 'utf8')
      if (!writePattern.test(text)) {
        writePattern.lastIndex = 0
        continue
      }
      writePattern.lastIndex = 0
      if (managedPathPattern.test(text)) offenders.push(relative)
    }

    expect(offenders).toEqual([])
  })
})

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}
