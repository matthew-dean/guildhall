#!/usr/bin/env node
// Bundle @guildhall/runtime's CLI into a single ESM file at dist/cli.js.
// Workspace deps are inlined; runtime deps declared in package.json stay external.

import { build, context } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT_DIR = resolve(__dirname, 'dist')
const ENTRY = resolve(ROOT, 'packages/runtime/src/cli.ts')

const EXTERNALS = Object.keys(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).dependencies ?? {})

/**
 * After the bundle is emitted, copy any static assets that bundled.ts (and
 * future similar helpers) resolve relative to `import.meta.url`. Since the
 * output is a single ESM file at dist/cli.js, these assets need to sit at
 * paths relative to dist/.
 */
const copyAssetsPlugin = {
  name: 'copy-assets',
  setup(pluginBuild) {
    pluginBuild.onEnd(() => {
      const src = resolve(ROOT, 'packages/skills/src/bundled/content')
      const dst = join(OUT_DIR, 'bundled', 'content')
      if (existsSync(src)) {
        cpSync(src, dst, { recursive: true })
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

const watch = process.argv.includes('--watch')

cleanDist()

if (watch) {
  const ctx = await context(buildOptions)
  await ctx.watch()
  console.log('[guildhall build] Watching for changes…')
} else {
  await build(buildOptions)
  chmodSync(join(OUT_DIR, 'cli.js'), 0o755)
  console.log(`[guildhall build] ✓ dist/cli.js`)
}
