import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Single unified vitest config for the flat layout.
 *
 * Every `@guildhall/<module>` import in source + tests resolves to
 * `src/<module>/index.ts` via the aliases below (same mapping as
 * tsconfig.json "paths"). When we need scoped runs, use
 * `vitest run src/runtime` etc. — no projects indirection needed.
 */
export default defineConfig({
  resolve: {
    alias: [
      'agents',
      'backend-host',
      'compaction',
      'config',
      'core',
      'engine',
      'hooks',
      'levers',
      'mcp',
      'protocol',
      'providers',
      'runtime',
      'runtime-bundle',
      'sessions',
      'skills',
      'tools',
    ].map((name) => ({
      find: `@guildhall/${name}`,
      replacement: resolve(__dirname, `src/${name}/index.ts`),
    })),
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
})
