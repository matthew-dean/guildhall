#!/usr/bin/env node
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const outPath = resolve(process.argv[2] ?? 'artifacts/model-bakeoff/model-bakeoff-report.json')
const mdPath = outPath.replace(/\.json$/i, '.md')
const runnerPath = resolve('artifacts/model-bakeoff/.model-bakeoff-runner.mjs')

await mkdir(dirname(runnerPath), { recursive: true })
await build({
  entryPoints: ['src/runtime/model-bakeoff.ts'],
  bundle: true,
  outfile: runnerPath,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
})

const {
  renderBakeoffMarkdown,
  runModelBakeoff,
} = await import(pathToFileURL(runnerPath).href)

const report = runModelBakeoff()

await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(mdPath, renderBakeoffMarkdown(report), 'utf8')

console.log(`model-bakeoff: wrote ${outPath}`)
console.log(`model-bakeoff: wrote ${mdPath}`)
console.log(report.recommendation)
