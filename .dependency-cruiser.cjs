// Boundary enforcement for the flat src/<module>/ layout.
//
// Rule summary:
//   1. No circular dependencies anywhere.
//   2. Cross-module imports must go through the `@guildhall/<module>` alias,
//      which — via tsconfig paths — resolves to only that module's index.ts.
//      Relative imports that cross a module boundary are forbidden.
//   3. Test files are exempt from rule #2 so they can reach into internals
//      they're directly exercising.
//
// Run with `pnpm lint:deps`.

const fs = require('node:fs')

const MODULES = fs
  .readdirSync('src', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

const crossModuleRules = MODULES.map((mod) => ({
  name: `no-cross-module-relative-${mod}`,
  severity: 'error',
  comment:
    `src/${mod}/ must import other modules via @guildhall/<name>, ` +
    'not via a relative path that crosses the module boundary.',
  from: {
    path: `^src/${mod}/`,
    pathNot: '(/__tests__/|\\.test\\.ts$)',
  },
  to: {
    path: `^src/(?!${mod}(/|$))[^/]+/`,
    // Aliased imports (`@guildhall/<name>` → tsconfig paths) are fine;
    // this rule only fires on raw relative imports that reach across
    // a module boundary.
    dependencyTypesNot: ['aliased'],
  },
}))

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Runtime-value cycles must not exist. Type-only cycles (erased at ' +
        'compile time) are allowed since they do not execute.',
      from: {},
      to: {
        circular: true,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreferenced files are usually dead code.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|ts)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig.*\\.json$',
          '(^|/)vitest\\.config\\.ts$',
          '(^|/)src/index\\.ts$',
        ],
      },
      to: {},
    },
    ...crossModuleRules,
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    // Include type-only imports (`import type { Foo } from ...`) in the graph
    // so a type-only relative cross-module import still trips the boundary
    // rule. Without this, type imports are elided and slip past.
    tsPreCompilationDeps: true,
    doNotFollow: { path: '(node_modules|dist)' },
    includeOnly: '^src/',
    exclude: '(/__tests__/|\\.test\\.ts$)',
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
