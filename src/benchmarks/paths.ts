import path from 'node:path'
import { resolveBenchmarkFixtureRoot } from './fixtures.js'

export function assertSafePersistentBenchmarkOutputDir(
  outputDir: string,
  label = 'benchmark output',
): string {
  const resolved = path.resolve(outputDir)
  const fixtureRoot = resolveBenchmarkFixtureRoot()
  const repoRoot = path.resolve(fixtureRoot, '..', '..', '..')
  const blockedRoots = [
    path.join(repoRoot, 'internal', 'benchmarks', 'fixtures'),
    path.join(repoRoot, '.guildhall'),
    path.join(repoRoot, '.playwright-fixtures'),
  ]

  for (const blockedRoot of blockedRoots) {
    if (isWithin(resolved, blockedRoot)) {
      throw new Error(
        `${label} must not be written inside tracked fixture or Guildhall state directories: ${resolved}`,
      )
    }
  }

  return resolved
}

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
