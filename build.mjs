#!/usr/bin/env node
// Bundle the Guildhall CLI into a single ESM file at dist/cli.js.
// Internal modules (src/*) are inlined; runtime npm deps stay external.

import { build, context } from 'esbuild'
import esbuildSvelte from 'esbuild-svelte'
import { cpSync, existsSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const OUT_DIR = resolve(ROOT, 'dist')
const ENTRY = resolve(ROOT, 'src/runtime/cli.ts')
const WEB_ENTRY = resolve(ROOT, 'src/web/main.ts')
const WEB_OUT_DIR = join(OUT_DIR, 'web')

const EXTERNALS = Object.keys(
  JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).dependencies ?? {},
)

/**
 * After the bundle is emitted, copy static assets that are loaded at runtime
 * relative to `import.meta.url` (bundled skill markdown, for now). They need
 * to sit at paths relative to dist/ so the built cli.js can resolve them.
 */
const copyAssetsPlugin = {
  name: 'copy-assets',
  setup(pluginBuild) {
    pluginBuild.onEnd(() => {
      const skillsSrc = resolve(ROOT, 'src/skills/bundled/content')
      const skillsDst = join(OUT_DIR, 'bundled', 'content')
      if (existsSync(skillsSrc)) {
        cpSync(skillsSrc, skillsDst, { recursive: true })
      }
      const defaultsSrc = resolve(ROOT, 'src/engineering-defaults')
      const defaultsDst = join(OUT_DIR, 'engineering-defaults')
      if (existsSync(defaultsSrc)) {
        cpSync(defaultsSrc, defaultsDst, {
          recursive: true,
          filter: (path) => !path.endsWith('.ts'),
        })
      }
    })
  },
}

function cleanDist() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
}

const buildOptions = {
  entryPoints: [ENTRY],
  bundle: true,
  outfile: join(OUT_DIR, 'cli.js'),
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: EXTERNALS,
  // Honor tsconfig "paths" so @guildhall/<module> specifiers resolve to the
  // module's index.ts. Without this, esbuild would try to look them up in
  // node_modules and fail.
  tsconfig: resolve(ROOT, 'tsconfig.json'),
  banner: {
    // Esbuild preserves the shebang from the entry. We only need the
    // createRequire shim so bundled CJS deps (e.g. js-yaml) can call require().
    js: [
      "import { createRequire as __guildhallCreateRequire } from 'node:module'",
      'const require = __guildhallCreateRequire(import.meta.url)',
    ].join('\n'),
  },
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  plugins: [copyAssetsPlugin],
}

/**
 * Web bundle: Svelte 5 dashboard that mounts over the Hono-served HTML shell.
 * Compiled as a browser ESM bundle with Svelte's own CSS extracted to app.css.
 */
const webBuildOptions = {
  entryPoints: [WEB_ENTRY],
  bundle: true,
  outfile: join(WEB_OUT_DIR, 'app.js'),
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  conditions: ['svelte', 'browser', 'module', 'import', 'default'],
  mainFields: ['svelte', 'browser', 'module', 'main'],
  plugins: [
    esbuildSvelte({
      compilerOptions: { css: 'external' },
    }),
  ],
  loader: { '.css': 'css' },
  sourcemap: true,
  minify: false,
  logLevel: 'info',
}

const watch = process.argv.includes('--watch')

cleanDist()
mkdirSync(WEB_OUT_DIR, { recursive: true })

if (watch) {
  const ctx = await context(buildOptions)
  const webCtx = await context(webBuildOptions)
  await ctx.watch()
  await webCtx.watch()
  console.log('[guildhall build] Watching for changes…')
} else {
  await build(buildOptions)
  await build(webBuildOptions)
  chmodSync(join(OUT_DIR, 'cli.js'), 0o755)
  console.log(`[guildhall build] ✓ dist/cli.js`)
  console.log(`[guildhall build] ✓ dist/web/app.js + app.css`)
}
