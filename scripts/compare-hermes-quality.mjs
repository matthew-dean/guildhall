#!/usr/bin/env node
import { execFile as execFileCb } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_EXPECTED_FILE = 'quality_smoke.txt'
const DEFAULT_EXPECTED_CONTENT = 'QUALITY_SMOKE_OK'
const DEFAULT_PROMPT = [
  `Create a file named ${DEFAULT_EXPECTED_FILE} in the current project root containing exactly ${DEFAULT_EXPECTED_CONTENT}.`,
  'Do not create any other files.',
  'Then complete with truthful proof.',
].join(' ')
const DEFAULT_APP_PROMPT = [
  'Build a dependency-free single-page Pantry Pulse web app in this project root.',
  'Use plain HTML, CSS, and JavaScript only; do not require npm install or a dev server.',
  'The app must include a visible heading "Pantry Pulse", at least seven seeded pantry items with category, quantity, and expiration text, an All / Expiring soon mutually-exclusive filter, a Mark used action that removes one visible item or marks it used, and a visible remaining-item count that updates.',
  'The design should feel app-store-caliber for a small domestic food utility: warm off-white or soft neutral base, sage/leaf green or warm amber primary/accent, coral/tomato or amber urgency, clear hierarchy, polished spacing, responsive mobile layout, and no generic blue primary/accent.',
  'Use semantic HTML and accessible controls. Then complete with truthful proof.',
].join(' ')
const DEFAULT_APP_INFER_PROMPT = [
  'Build a tiny dependency-free single-page Pantry Pulse web app in this project root.',
  'It should help someone track pantry items, notice what expires soon, filter the list, mark items as used, and see the count update.',
  'Use plain HTML, CSS, and JavaScript only; do not require npm install or a dev server.',
  'Make reasonable product and design choices yourself. Then complete with truthful proof.',
].join(' ')

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv)
  const startedAt = new Date().toISOString()
  const reportRoot = resolvePersistentReportRoot(options.outputDir)
  const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-quality-artifacts-'))
  await fs.mkdir(reportRoot, { recursive: true })

  const task = {
    mode: options.mode,
    id: options.taskId ?? (options.mode === 'app-explicit' ? 'pantry-pulse-app-explicit-quality' : options.mode === 'app-infer' ? 'pantry-pulse-app-inference-quality' : 'quality-file-smoke'),
    prompt: options.prompt ?? defaultPromptForMode(options.mode),
    expectedFile: options.expectedFile ?? DEFAULT_EXPECTED_FILE,
    expectedContent: options.expectedContent ?? DEFAULT_EXPECTED_CONTENT,
  }

  const guildhallProject = path.join(artifactRoot, 'guildhall-work')
  const hermesProject = path.join(artifactRoot, 'hermes-work')
  await setupGuildhallProject(guildhallProject, guildhallProjectIdForOutputRoot(artifactRoot))
  await setupPlainProject(hermesProject)

  const guildhall = await runGuildhall({ artifactRoot, projectRoot: guildhallProject, task, options, env })
  const hermes = await runHermes({ artifactRoot, projectRoot: hermesProject, task, options, env })
  const completedAt = new Date().toISOString()
  const report = {
    id: `guildhall-hermes-quality-${path.basename(reportRoot)}`,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    task,
    reportRoot,
    artifactRoot,
    summary: {
      qualityFirst: true,
      guildhallScore: guildhall.qualityScore.total,
      hermesScore: hermes.qualityScore.total,
      winner: guildhall.qualityScore.total === hermes.qualityScore.total
        ? 'tie'
        : guildhall.qualityScore.total > hermes.qualityScore.total ? 'guildhall' : 'hermes',
      note: 'Quality score is primary. Token and cost telemetry are secondary and may be unavailable.',
    },
    results: { guildhall, hermes },
  }

  const jsonPath = path.join(reportRoot, 'quality-comparison-report.json')
  const markdownPath = path.join(reportRoot, 'quality-comparison-report.md')
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(markdownPath, renderMarkdown(report), 'utf8')
  console.log(`[guildhall] Quality comparison complete: ${report.summary.winner}`)
  console.log(`[guildhall] Guildhall quality score: ${guildhall.qualityScore.total}/100`)
  console.log(`[guildhall] Hermes quality score: ${hermes.qualityScore.total}/100`)
  console.log(`[guildhall] Report: ${markdownPath}`)
  return report
}

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      options.prompt = [arg, ...argv.slice(index + 1)].join(' ').trim()
      break
    }
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      options[key] = true
      continue
    }
    options[key] = value
    index += 1
  }
  return {
    mode: normalizeMode(stringOption(options.mode)),
    outputDir: stringOption(options['output-dir']),
    taskId: stringOption(options['task-id']),
    prompt: stringOption(options.prompt),
    expectedFile: stringOption(options['expected-file']),
    expectedContent: stringOption(options['expected-content']),
    guildhallCli: stringOption(options['guildhall-cli']) ?? path.resolve('dist/cli.js'),
    hermesBin: stringOption(options['hermes-bin']) ?? 'hermes',
    hermesHome: stringOption(options['hermes-home']) ?? process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes'),
    maxTicks: stringOption(options['max-ticks']) ?? '80',
    timeoutMs: Number(stringOption(options['timeout-ms']) ?? '900000'),
  }
}

function normalizeMode(value) {
  if (value === 'app' || value === 'app-explicit') return 'app-explicit'
  if (value === 'app-infer' || value === 'app-inference') return 'app-infer'
  return 'file'
}

function defaultPromptForMode(mode) {
  if (mode === 'app-explicit') return DEFAULT_APP_PROMPT
  if (mode === 'app-infer') return DEFAULT_APP_INFER_PROMPT
  return DEFAULT_PROMPT
}

async function runGuildhall(input) {
  const reportPath = path.join(input.artifactRoot, 'guildhall-run-once-report.json')
  const startedAt = Date.now()
  const command = [
    process.execPath,
    input.options.guildhallCli,
    'task',
    'run-once',
    input.task.prompt,
    '--project',
    input.projectRoot,
    '--automation',
    'fully-automated',
    '--proof',
    'commands',
    '--output',
    reportPath,
    '--max-ticks',
    input.options.maxTicks,
  ]
  const run = await runCommand(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: input.env,
    timeout: input.options.timeoutMs,
  })
  const artifactRoots = await discoverGuildhallArtifactRoots(input.projectRoot)
  const artifact = await gradeArtifact(input.projectRoot, input.task, path.join(input.artifactRoot, 'screenshots', 'guildhall'), artifactRoots)
  const report = await readJsonOptional(reportPath)
  return {
    harness: 'guildhall',
    projectRoot: input.projectRoot,
    command: command.map(shellWord).join(' '),
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    durationMs: Date.now() - startedAt,
    runReportPath: existsSync(reportPath) ? reportPath : null,
    stopReason: report?.stopReason ?? null,
    scopedStatusSummary: report?.scopedStatusSummary ?? null,
    telemetry: extractGuildhallTelemetry(report),
    artifact,
    qualityScore: scoreQuality({
      task: input.task,
      artifact,
      exitedCleanly: run.exitCode === 0,
      truthfulCompletion: run.exitCode === 0 && Boolean(report?.stopReason),
      proofPresent: Boolean(report?.scopedStatusSummary),
    }),
  }
}

async function runHermes(input) {
  const startedAt = Date.now()
  const command = [input.options.hermesBin, '-z', input.task.prompt]
  const run = await runCommand(command[0], command.slice(1), {
    cwd: input.projectRoot,
    env: { ...input.env, HERMES_HOME: input.options.hermesHome },
    timeout: input.options.timeoutMs,
  })
  const artifact = await gradeArtifact(input.projectRoot, input.task, path.join(input.artifactRoot, 'screenshots', 'hermes'))
  const telemetry = await readHermesTelemetry(input.options.hermesBin, input.options.hermesHome, input.artifactRoot, input.env)
  return {
    harness: 'hermes',
    projectRoot: input.projectRoot,
    command: command.map(shellWord).join(' '),
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    durationMs: Date.now() - startedAt,
    telemetry,
    artifact,
    qualityScore: scoreQuality({
      task: input.task,
      artifact,
      exitedCleanly: run.exitCode === 0,
      truthfulCompletion: run.exitCode === 0 && /\bDONE\b|done|complete/i.test(run.stdout + run.stderr),
      proofPresent: run.exitCode === 0,
    }),
  }
}

export function resolvePersistentReportRoot(outputDir) {
  const resolved = path.resolve(outputDir ?? path.join(os.tmpdir(), `guildhall-hermes-quality-${Date.now().toString(36)}`))
  const blockedRoots = [
    path.join(REPO_ROOT, 'internal', 'benchmarks', 'fixtures'),
    path.join(REPO_ROOT, '.guildhall'),
    path.join(REPO_ROOT, '.playwright-fixtures'),
  ]
  for (const blockedRoot of blockedRoots) {
    if (isWithin(resolved, blockedRoot)) {
      throw new Error(`Hermes quality reports must not be written inside tracked fixture or Guildhall state directories: ${resolved}`)
    }
  }
  return resolved
}

function isWithin(target, root) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function setupGuildhallProject(projectRoot, projectId) {
  await setupPlainProject(projectRoot)
  await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
    'name: Guildhall Hermes Quality Smoke',
    `id: ${projectId}`,
    'coordinators:',
    '  - id: general',
    '    domain: general',
    '    name: General',
    '    mandate: Solve the requested benchmark task end to end with truthful proof.',
    '',
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), '[]\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, '.guildhall', 'MEMORY.md'), '# Quality Smoke Memory\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, '.guildhall', 'DECISIONS.md'), '# Quality Smoke Decisions\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, '.guildhall', 'PROGRESS.md'), '# Quality Smoke Progress\n', 'utf8')
  await gitInit(projectRoot)
}

export function guildhallProjectIdForOutputRoot(outputRoot) {
  const slug = path.basename(outputRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = slug || createHash('sha256').update(outputRoot).digest('hex').slice(0, 10)
  return `guildhall-hermes-quality-${suffix}`.slice(0, 90)
}

async function setupPlainProject(projectRoot) {
  await fs.mkdir(projectRoot, { recursive: true })
}

async function gitInit(projectRoot) {
  await runCommand('git', ['init', '-b', 'main'], { cwd: projectRoot, timeout: 30_000 })
  await runCommand('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: projectRoot, timeout: 30_000 })
  await runCommand('git', ['config', 'user.name', 'Guildhall Benchmark'], { cwd: projectRoot, timeout: 30_000 })
  await runCommand('git', ['add', '.'], { cwd: projectRoot, timeout: 30_000 })
  await runCommand('git', ['commit', '--no-verify', '-m', 'init'], { cwd: projectRoot, timeout: 30_000 })
}

async function gradeProjectArtifact(projectRoot, task) {
  const expectedPath = path.join(projectRoot, task.expectedFile)
  const files = await listFiles(projectRoot)
  let content = null
  try {
    content = await fs.readFile(expectedPath, 'utf8')
  } catch {
    // missing file is scored below
  }
  const unexpectedFiles = files.filter(file => {
    if (file === task.expectedFile) return false
    if (file === 'guildhall.yaml' || file === '.gitignore') return false
    if (file.startsWith('.guildhall/')) return false
    return true
  })
  return {
    expectedPath,
    fileExists: content !== null,
    exactContent: content === task.expectedContent,
    actualContent: content,
    unexpectedFiles,
  }
}

export async function discoverGuildhallArtifactRoots(projectRoot) {
  const taskStore = await readJsonOptional(path.join(projectRoot, '.guildhall', 'TASKS.json'))
  const tasks = Array.isArray(taskStore) ? taskStore : Array.isArray(taskStore?.tasks) ? taskStore.tasks : []
  const roots = []
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue
    const worktreePath = typeof task.worktreePath === 'string' ? task.worktreePath : null
    if (!worktreePath || !existsSync(worktreePath)) continue
    roots.push(worktreePath)
  }
  return [...new Set(roots)]
}

export async function gradeArtifact(projectRoot, task, screenshotDir, fallbackRoots = []) {
  if (isAppMode(task.mode)) return gradeAppArtifact(projectRoot, screenshotDir, fallbackRoots)
  return gradeProjectArtifact(projectRoot, task)
}

async function gradeAppArtifact(projectRoot, screenshotDir, fallbackRoots = []) {
  const sourceRoot = selectAppArtifactRoot(projectRoot, fallbackRoots)
  const files = await listFiles(sourceRoot)
  const appFiles = files.filter(file => /\.(html|css|js|mjs|ts|json)$/i.test(file) && !file.startsWith('.guildhall/'))
  const indexPath = path.join(sourceRoot, 'index.html')
  const staticText = await readAppTextFiles(sourceRoot, appFiles)
  const palette = auditPantryPalette(staticText.join('\n\n'))
  const browserProof = await browserProofApp(sourceRoot, screenshotDir)
  return {
    expectedPath: indexPath,
    sourceRoot,
    landedInProjectRoot: sourceRoot === projectRoot,
    fileExists: existsSync(indexPath),
    exactContent: browserProof.loaded && browserProof.headingVisible,
    actualContent: existsSync(indexPath) ? await fs.readFile(indexPath, 'utf8') : null,
    unexpectedFiles: [],
    appFiles,
    palette,
    browserProof,
  }
}

function selectAppArtifactRoot(projectRoot, fallbackRoots) {
  if (existsSync(path.join(projectRoot, 'index.html'))) return projectRoot
  for (const root of fallbackRoots) {
    if (existsSync(path.join(root, 'index.html'))) return root
  }
  return projectRoot
}

export function scoreQuality(input) {
  if (isAppMode(input.task.mode)) return scoreAppQuality(input)
  const checks = [
    { id: 'expected_file_created', points: 30, passed: input.artifact.fileExists },
    { id: 'exact_content', points: 30, passed: input.artifact.exactContent },
    { id: 'no_unexpected_files', points: 15, passed: input.artifact.unexpectedFiles.length === 0 },
    { id: 'clean_exit', points: 10, passed: input.exitedCleanly },
    { id: 'truthful_completion_signal', points: 10, passed: input.truthfulCompletion },
    { id: 'proof_or_status_present', points: 5, passed: input.proofPresent },
  ]
  return {
    total: checks.reduce((sum, check) => sum + (check.passed ? check.points : 0), 0),
    checks,
  }
}

function scoreAppQuality(input) {
  const proof = input.artifact.browserProof
  const palette = input.artifact.palette
  const checks = [
    { id: 'app_entry_created', points: 10, passed: input.artifact.fileExists },
    { id: 'landed_in_project_root', points: 10, passed: input.artifact.landedInProjectRoot },
    { id: 'browser_loads', points: 10, passed: proof.loaded && proof.headingVisible },
    { id: 'seeded_items_visible', points: 15, passed: proof.seededItemCount >= 5 },
    { id: 'expiring_filter_works', points: 15, passed: proof.filterWorked },
    { id: 'mark_used_updates', points: 15, passed: proof.markUsedWorked },
    { id: 'desktop_mobile_screenshots', points: 10, passed: proof.screenshots.length >= 2 },
    { id: 'warm_domestic_palette', points: 8, passed: palette.warmDomestic },
    { id: 'no_generic_blue_primary', points: 4, passed: !palette.genericBluePrimary },
    { id: 'clean_exit', points: 3, passed: input.exitedCleanly },
  ]
  return {
    total: checks.reduce((sum, check) => sum + (check.passed ? check.points : 0), 0),
    checks,
  }
}

async function browserProofApp(projectRoot, screenshotDir) {
  const proof = {
    loaded: false,
    headingVisible: false,
    seededItemCount: 0,
    filterWorked: false,
    markUsedWorked: false,
    screenshots: [],
    errors: [],
  }
  if (!existsSync(path.join(projectRoot, 'index.html'))) {
    proof.errors.push('index.html missing')
    return proof
  }
  const server = await serveStatic(projectRoot)
  try {
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    await page.goto(server.url, { waitUntil: 'networkidle' })
    proof.loaded = true
    proof.headingVisible = await page.getByRole('heading', { name: /pantry pulse/i }).first().isVisible().catch(() => false)
    proof.seededItemCount = await countPantryItems(page)
    const beforeFilter = proof.seededItemCount
    await clickFirstVisible(page, [
      () => page.getByRole('radio', { name: /expiring soon/i }).first(),
      () => page.getByRole('button', { name: /expiring soon/i }).first(),
      () => page.getByText(/expiring soon/i).first(),
    ])
    const afterFilter = await countPantryItems(page)
    proof.filterWorked = afterFilter > 0 && beforeFilter > afterFilter
    const beforeMark = afterFilter || beforeFilter
    await clickFirstVisible(page, [
      () => page.getByRole('button', { name: /mark used/i }).first(),
      () => page.getByText(/mark used/i).first(),
    ])
    const afterMark = await countPantryItems(page)
    proof.markUsedWorked = afterMark < beforeMark || await page.locator('body').innerText().then(text => /\b(remaining|active|used|left)\b/i.test(text)).catch(() => false)
    await fs.mkdir(screenshotDir, { recursive: true })
    const desktop = path.join(screenshotDir, 'desktop.png')
    await page.screenshot({ path: desktop, fullPage: true })
    proof.screenshots.push(desktop)
    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = path.join(screenshotDir, 'mobile.png')
    await page.screenshot({ path: mobile, fullPage: true })
    proof.screenshots.push(mobile)
    await browser.close()
  } catch (err) {
    proof.errors.push(err instanceof Error ? err.message : String(err))
  } finally {
    await server.close()
  }
  return proof
}

async function countPantryItems(page) {
  const locators = [
    page.locator('[data-testid*="pantry"], [data-testid*="item"]'),
    page.locator('article'),
    page.locator('li'),
    page.locator('.item, .card, .pantry-item'),
  ]
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0)
    if (count >= 3) return count
  }
  return 0
}

async function clickFirstVisible(page, factories) {
  for (const factory of factories) {
    const locator = factory()
    if (await locator.isVisible().catch(() => false)) {
      await locator.click()
      await page.waitForTimeout(250)
      return true
    }
  }
  return false
}

async function serveStatic(root) {
  const server = http.createServer(async (req, res) => {
    const requestPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html'
    const filePath = path.join(root, decodeURIComponent(requestPath.split('?')[0] ?? '/index.html'))
    if (!filePath.startsWith(root)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    try {
      const body = await fs.readFile(filePath)
      res.writeHead(200, { 'content-type': contentType(filePath) })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Static server did not bind a port.')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (filePath.endsWith('.png')) return 'image/png'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

async function readAppTextFiles(projectRoot, files) {
  const texts = []
  for (const file of files) {
    const fullPath = path.join(projectRoot, file)
    try {
      const stat = await fs.stat(fullPath)
      if (stat.size > 512_000) continue
      texts.push(await fs.readFile(fullPath, 'utf8'))
    } catch {
      // best-effort app quality audit
    }
  }
  return texts
}

export function auditPantryPalette(text) {
  const roles = []
  const patterns = [
    /(--[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
    /(\$[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
    /(@[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
    /['"]?([a-z0-9_-]*(?:surface|background|bg|primary|brand|accent|cta|action|warn|warning|soon|expiry|danger)[a-z0-9_-]*)['"]?\s*:\s*['"](#[0-9a-f]{3,8})['"]/gi,
    /\b(background(?:-color)?|color|border-color)\s*:\s*(#[0-9a-f]{3,8})\b/gi,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1]
      const value = match[2]
      if (!name || !value) continue
      const rgb = parseHexColor(value)
      if (!rgb) continue
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
      roles.push({ name, value, ...hsl, family: classifyHue(hsl.h, hsl.s, hsl.l) })
    }
  }
  const primary = roles.find(role => /primary|brand|accent|cta|action/i.test(role.name) && role.s >= 10)
    ?? roles.find(role => role.s >= 18 && role.l >= 20 && role.l <= 80)
  const families = new Set(roles.map(role => role.family))
  return {
    roles,
    primary: primary ?? null,
    warmDomestic: families.has('sage') || families.has('leaf-green') || families.has('warm-amber') || families.has('citrus') || families.has('tomato-coral'),
    genericBluePrimary: primary?.family === 'cool-blue',
  }
}

function parseHexColor(value) {
  const hex = value.replace('#', '')
  if (hex.length === 3) {
    const [r, g, b] = hex.split('')
    if (!r || !g || !b) return null
    return { r: Number.parseInt(r + r, 16), g: Number.parseInt(g + g, 16), b: Number.parseInt(b + b, 16) }
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    }
  }
  return null
}

function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l: l * 100 }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = max === rn
    ? 60 * (((gn - bn) / delta) % 6)
    : max === gn
      ? 60 * ((bn - rn) / delta + 2)
      : 60 * ((rn - gn) / delta + 4)
  if (h < 0) h += 360
  return { h, s: s * 100, l: l * 100 }
}

function classifyHue(hue, saturation, lightness) {
  if (saturation < 8 && lightness > 88) return 'warm-off-white'
  if (saturation < 12) return 'neutral'
  if (hue >= 190 && hue <= 255) return 'cool-blue'
  if (hue >= 80 && hue <= 145) return hue <= 105 ? 'sage' : 'leaf-green'
  if (hue >= 36 && hue < 80) return hue >= 50 ? 'citrus' : 'warm-amber'
  if (hue >= 8 && hue < 36) return 'warm-amber'
  if (hue < 8 || hue >= 345) return 'tomato-coral'
  if (hue >= 255 && hue <= 310) return 'purple'
  return 'off-target'
}

async function readHermesTelemetry(hermesBin, hermesHome, outputRoot, env) {
  const exportPath = path.join(outputRoot, 'hermes-sessions.jsonl')
  const insightsPath = path.join(outputRoot, 'hermes-insights.txt')
  const telemetry = {
    tokens: 'unavailable',
    cost: 'unavailable',
    sessionExportPath: null,
    insightsPath: null,
    notes: [],
  }
  const sessionExport = await runCommand(hermesBin, ['sessions', 'export', exportPath], {
    env: { ...env, HERMES_HOME: hermesHome },
    timeout: 60_000,
  })
  if (sessionExport.exitCode === 0 && existsSync(exportPath)) {
    telemetry.sessionExportPath = exportPath
    telemetry.tokens = 'session-export'
  } else {
    telemetry.notes.push('Hermes session export was unavailable.')
  }
  const insights = await runCommand(hermesBin, ['insights', '--days', '1'], {
    env: { ...env, HERMES_HOME: hermesHome },
    timeout: 60_000,
  })
  if (insights.exitCode === 0) {
    await fs.writeFile(insightsPath, insights.stdout, 'utf8')
    telemetry.insightsPath = insightsPath
    telemetry.cost = 'insights'
  } else {
    telemetry.notes.push('Hermes insights were unavailable.')
  }
  return telemetry
}

function extractGuildhallTelemetry(report) {
  return {
    tokens: 'run-report',
    cost: 'run-report',
    stopReason: report?.stopReason ?? null,
    stopMessage: report?.stopMessage ?? null,
  }
}

async function runCommand(file, args, options = {}) {
  try {
    const result = await execFile(file, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (err) {
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err),
    }
  }
}

async function listFiles(root) {
  const files = []
  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      const relative = path.relative(root, fullPath)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (entry.isFile()) {
        files.push(relative)
      }
    }
  }
  await visit(root)
  return files.sort()
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

function renderMarkdown(report) {
  const appMode = isAppMode(report.task.mode)
  const rows = [report.results.guildhall, report.results.hermes].map(result => appMode
    ? [
        result.harness,
        `${result.qualityScore.total}/100`,
        result.exitCode,
        result.artifact.browserProof?.loaded ? 'yes' : 'no',
        result.artifact.browserProof?.seededItemCount ?? 0,
        result.artifact.browserProof?.screenshots?.length ?? 0,
        result.artifact.landedInProjectRoot ? 'project root' : 'task worktree',
        result.durationMs,
        `${result.telemetry.tokens ?? 'unavailable'} / ${result.telemetry.cost ?? 'unavailable'}`,
      ]
    : [
        result.harness,
        `${result.qualityScore.total}/100`,
        result.exitCode,
        result.artifact.fileExists ? 'yes' : 'no',
        result.artifact.exactContent ? 'yes' : 'no',
        result.artifact.unexpectedFiles.length,
        result.durationMs,
        `${result.telemetry.tokens ?? 'unavailable'} / ${result.telemetry.cost ?? 'unavailable'}`,
      ])
  const appScreenshotLines = appMode
    ? [
        '',
        '## Screenshots',
        '',
        ...[report.results.guildhall, report.results.hermes].flatMap(result => [
          `### ${result.harness}`,
          '',
          ...(result.artifact.browserProof?.screenshots ?? []).map(file => `![${result.harness} screenshot](${file})`),
          '',
        ]),
      ]
    : []
  return [
    appMode ? `# Guildhall vs Hermes ${report.task.mode === 'app-infer' ? 'App Inference' : 'Explicit App'} Quality Comparison` : '# Guildhall vs Hermes Quality Comparison',
    '',
    `Generated: ${report.generatedAt}`,
    `Task: ${report.task.id}`,
    '',
    'This is an internal quality-first comparison. It measures whether each harness solved the same task accurately and truthfully. Token and cost telemetry are useful secondary context, not the score driver.',
    '',
    '## Summary',
    '',
    `- Guildhall: ${report.summary.guildhallScore}/100`,
    `- Hermes: ${report.summary.hermesScore}/100`,
    `- Result: ${report.summary.winner}`,
    '',
    '## Quality Scorecard',
    '',
    appMode
      ? '| Harness | Quality | Exit | Browser Load | Visible Items | Screenshots | Artifact Source | Duration ms | Token/Cost Telemetry |'
      : '| Harness | Quality | Exit | File | Exact Content | Unexpected Files | Duration ms | Token/Cost Telemetry |',
    appMode
      ? '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
      : '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.map(cell => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`),
    '',
    '## Task',
    '',
    '```',
    report.task.prompt,
    '```',
    ...appScreenshotLines,
    '',
    '## Artifact Paths',
    '',
    `- Guildhall project: ${report.results.guildhall.projectRoot}`,
    ...(appMode && report.results.guildhall.artifact.sourceRoot !== report.results.guildhall.projectRoot ? [`- Guildhall app source: ${report.results.guildhall.artifact.sourceRoot}`] : []),
    `- Hermes project: ${report.results.hermes.projectRoot}`,
    '',
    '## Interpretation Guardrail',
    '',
    'Do not publish this as a broad benchmark claim. It is a smoke comparison of one task shape, useful for harness development and regression tracking.',
    '',
  ].join('\n')
}

function isAppMode(mode) {
  return mode === 'app-explicit' || mode === 'app-infer'
}

function stringOption(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function shellWord(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`[guildhall] ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    process.exit(1)
  })
}
