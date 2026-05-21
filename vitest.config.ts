import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

/**
 * Single unified vitest config for the flat layout.
 *
 * Every `@guildhall/<module>` import in source + tests resolves to
 * `src/<module>/index.ts` via the aliases below (same mapping as
 * tsconfig.json "paths"). When we need scoped runs, use
 * `vitest run src/runtime` etc. — no projects indirection needed.
 */
export default defineConfig({
  plugins: [
    svelte(),
    svelteTesting(),
  ],
  resolve: {
    alias: [
      'agents',
      'backend-host',
      'compaction',
      'config',
      'corpus-map',
      'core',
      'engine',
      'engineering-defaults',
      'guilds',
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
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
      ],
      thresholds: { statements: 83, lines: 83, functions: 83, branches: 75 },
    },
  },
})
