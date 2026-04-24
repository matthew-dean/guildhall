import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Each guild's `index.ts` lives at `src/guilds/<slug>/index.ts` in dev/test
 * (MODULE_DIR points there directly) and gets inlined into `dist/cli.js` at
 * build time (MODULE_DIR collapses to `dist/`, with the markdown copied to
 * `dist/guilds/<slug>/…` by the build plugin). This helper resolves an asset
 * the same way in both layouts and also honors a project override at
 * `<memoryDir>/guilds/<slug>/<relative>`.
 */
export function loadGuildAsset(opts: {
  importMetaUrl: string
  slug: string
  relative: string
  memoryDir?: string | undefined
}): string {
  const moduleDir = dirname(fileURLToPath(opts.importMetaUrl))

  // 1. Project override takes precedence so projects can shadow principles
  //    without editing TS.
  if (opts.memoryDir) {
    const override = join(opts.memoryDir, 'guilds', opts.slug, opts.relative)
    if (existsSync(override)) {
      try {
        return readFileSync(override, 'utf8').trim()
      } catch {
        // fall through to bundled
      }
    }
  }

  // 2. Bundled — try the module dir itself (dev/test), then the
  //    `guilds/<slug>/…` path used after the esbuild bundle flattens to
  //    `dist/`.
  const candidates = [
    join(moduleDir, opts.relative),
    join(moduleDir, 'guilds', opts.slug, opts.relative),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf8').trim()
      } catch {
        continue
      }
    }
  }
  return ''
}
