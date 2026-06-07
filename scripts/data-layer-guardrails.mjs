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
  'src/sessions/storage.ts',
  'src/sessions/task-state-store.ts',
])

const ioPattern = /\b(?:fs|fsp)?\.?(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream)\b|\b(?:atomicWriteText|readManagedTextFile|readManagedTextFileSync|writeManagedTextFile|writeManagedTextFileSync|appendManagedTextFile)\s*\(/g
const forbiddenManagedPathPattern = /getProjectStateDir|getProjectLocalHistoryDir|getProjectTaskLocalHistoryDir|getProjectRuntime|getDataDir|\.guildhall|guildhall-persistence|\bpath\.join\s*\(\s*(?:memoryDir|projectStateDir|localHistoryDir|stateDir)/
const allowedStorageBoundaryPattern = /getProjectSystemStatePath|getProjectSystemStatePathFromMemoryDir|getLegacyProjectStatePath|getProjectRuntimeDevServersPath|getProjectTaskReviewPacketPath|projectTasksPath|projectBriefPath|workspaceImportTasksPath|projectLearningPath|projectSkillProposalsPath/

export function analyzeDataLayerGuardrails(input = {}) {
  const root = input.repoRoot ? resolve(input.repoRoot) : repoRoot
  const scanRoots = input.roots?.length
    ? input.roots.map(scanRoot => resolve(root, scanRoot))
    : roots
  const offenders = []
  for (const file of scanRoots.flatMap(scanRoot => sourceFiles(scanRoot))) {
    const rel = relative(root, file)
    if (!/\.(?:ts|js|mjs)$/.test(rel)) continue
    if (rel.includes('/__tests__/')) continue
    if (dataLayerModules.has(rel)) continue
    const text = readFileSync(file, 'utf8')
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
