#!/usr/bin/env node
// Verifies the public evidence that makes a release understandable and inspectable.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const version = args.find((arg) => !arg.startsWith('--'))
const rootFlag = args.indexOf('--root')
const root = rootFlag === -1
  ? resolve(__dirname, '..')
  : resolve(args[rootFlag + 1] ?? '')

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  fail('Usage: node scripts/check-release-documentation.mjs <version> [--root <path>]')
}
if (rootFlag !== -1 && (!args[rootFlag + 1] || args[rootFlag + 1].startsWith('--'))) {
  fail('--root requires a path.')
}

const screenshotVersion = version.replaceAll('.', '-')
const releaseNote = `docs/releases/${version}.md`
const screenshotDirectory = `docs/assets/ui-audit/${screenshotVersion}`
const snapshotReleaseNote = `docs/versions/${version}/releases/${version}.md`
const snapshotScreenshots = `docs/versions/${version}/assets/ui-audit/${screenshotVersion}`

assertFile(releaseNote)
const releaseNoteText = read(releaseNote)
assertContains(releaseNoteText, `# Guildhall ${version}`, releaseNote)
assertContains(releaseNoteText, `assets/ui-audit/${screenshotVersion}/`, releaseNote)

assertFile(`${screenshotDirectory}/README.md`)
const screenshotReadme = read(`${screenshotDirectory}/README.md`)
assertContains(screenshotReadme, `Guildhall ${version}`, `${screenshotDirectory}/README.md`)
assertContains(screenshotReadme, 'Route:', `${screenshotDirectory}/README.md`)
assertContains(screenshotReadme, 'Viewport:', `${screenshotDirectory}/README.md`)
assertScreenshotSet(screenshotDirectory)

assertFile(snapshotReleaseNote)
assertScreenshotSet(snapshotScreenshots)

console.log(`[release-docs] Release documentation is complete for ${version}.`)

function pathFromRoot(relativePath) {
  return resolve(root, relativePath)
}

function assertFile(relativePath) {
  if (!existsSync(pathFromRoot(relativePath))) {
    fail(`Missing required release documentation: ${relativePath}`)
  }
}

function assertScreenshotSet(relativePath) {
  const absolutePath = pathFromRoot(relativePath)
  if (!existsSync(absolutePath)) {
    fail(`Missing required screenshot directory: ${relativePath}`)
  }
  const images = readdirSync(absolutePath).filter((entry) => /\.(avif|jpe?g|png|webp)$/i.test(entry))
  if (images.length < 2) {
    fail(`Expected at least two release screenshots in ${relativePath}; found ${images.length}.`)
  }
}

function assertContains(text, expected, relativePath) {
  if (!text.includes(expected)) {
    fail(`Expected ${relativePath} to include ${JSON.stringify(expected)}.`)
  }
}

function read(relativePath) {
  return readFileSync(pathFromRoot(relativePath), 'utf8')
}

function fail(message) {
  console.error(`[release-docs] ${message}`)
  process.exit(1)
}
