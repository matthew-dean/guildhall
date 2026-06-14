#!/usr/bin/env node
// Bundle the Guildhall CLI into a single ESM file at dist/cli.js.
// Internal modules (src/*) are inlined; runtime npm deps stay external.

import { build, context } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildReleaseManifest } from './scripts/release-manifest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const OUT_DIR = resolve(ROOT, 'dist')
const ENTRY = resolve(ROOT, 'src/runtime/cli.ts')
const WEB_OUT_DIR = join(OUT_DIR, 'web')
const ICONS_SRC = resolve(ROOT, 'icons')
const WEB_ICONS_OUT_DIR = join(WEB_OUT_DIR, 'icons')

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const EXTERNALS = Object.keys(manifest.dependencies ?? {})

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
      const guildsSrc = resolve(ROOT, 'src/guilds')
      const guildsDst = join(OUT_DIR, 'guilds')
      if (existsSync(guildsSrc)) {
        cpSync(guildsSrc, guildsDst, {
          recursive: true,
          filter: (path) => !path.endsWith('.ts') && !path.includes('__tests__'),
        })
      }
    })
  },
}

function cleanDist() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
}

function copyWebIcons() {
  if (!existsSync(ICONS_SRC)) return
  cpSync(ICONS_SRC, WEB_ICONS_OUT_DIR, { recursive: true })
}

function gitOutput(args, fallback = 'unknown') {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return fallback
  const value = result.stdout.trim()
  return value.length > 0 ? value : fallback
}

function writeBuildInfo() {
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all'], '')
  const commit = gitOutput(['rev-parse', 'HEAD'])
  const shortCommit = commit === 'unknown'
    ? 'unknown'
    : gitOutput(['rev-parse', '--short=12', 'HEAD'], commit.slice(0, 12))
  const branch = gitOutput(['branch', '--show-current'])
  const payload = {
    version: manifest.version ?? 'unknown',
    builtAt: new Date().toISOString(),
    git: {
      commit,
      shortCommit,
      branch,
      dirty: status.length > 0,
    },
    source: 'build',
  }
  writeFileSync(join(OUT_DIR, 'build-info.json'), `${JSON.stringify(payload, null, 2)}\n`)
}

function writeReleaseManifest() {
  const payload = buildReleaseManifest({
    guildhallVersion: manifest.version ?? 'unknown',
  })
  writeFileSync(join(OUT_DIR, 'release-manifest.json'), `${JSON.stringify(payload, null, 2)}\n`)
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

const watch = process.argv.includes('--watch')

// Extract help-topic metadata from docs/ into src/web/generated/ before the
// svelte bundle reads it. Fails the build on malformed frontmatter.
function extractHelpTopics() {
  const prepare = spawnSync('node', ['scripts/prepare-versioned-docs.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (prepare.status !== 0) {
    throw new Error('[guildhall build] docs version preparation failed')
  }
  const result = spawnSync('node', ['scripts/extract-help-topics.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error('[guildhall build] help-topic extraction failed')
  }
}

function buildWebApp() {
  const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error('[guildhall build] SvelteKit/Vite web build failed')
  }
}

cleanDist()
mkdirSync(WEB_OUT_DIR, { recursive: true })
copyWebIcons()
extractHelpTopics()
writeBuildInfo()
writeReleaseManifest()

if (watch) {
  const ctx = await context(buildOptions)
  await ctx.watch()
  buildWebApp()
  console.log('[guildhall build] Watching CLI changes. Re-run pnpm build after web changes.')
} else {
  await build(buildOptions)
  buildWebApp()
  copyWebIcons()
  chmodSync(join(OUT_DIR, 'cli.js'), 0o755)
  console.log(`[guildhall build] ✓ dist/cli.js`)
  console.log(`[guildhall build] ✓ dist/web/ SvelteKit app`)
  console.log(`[guildhall build] ✓ dist/release-manifest.json`)
}
