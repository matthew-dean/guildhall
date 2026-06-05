#!/usr/bin/env node
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = process.cwd()
const outdir = path.join(root, 'artifacts', 'memory-core-prototype')
const outfile = path.join(outdir, 'runner.mjs')

await build({
  entryPoints: [path.join(root, 'src', 'memory-core', 'prototype-runner.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
})

const runner = await import(pathToFileURL(outfile).href)
const report = await runner.runMemoryCorePrototype({ outputDir: outdir })

console.log(JSON.stringify({
  projects: report.projects.length,
  storageRoot: report.storageRoot,
  report: path.join(outdir, 'report.md'),
}, null, 2))
