import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  buildWorkerCorpusContext,
  codebaseMapHistoryPath,
  codebaseMapPath,
  findExistingAbstraction,
  loadCodebaseMap,
  refreshCodebaseMap,
} from '../index.js'

const execFileP = promisify(execFile)

describe('corpus map', () => {
  let projectRoot: string
  let memoryDir: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-corpus-map-'))
    memoryDir = path.join(projectRoot, 'memory')
    await writeFixtureProject(projectRoot)
  })

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  it('builds and persists a full map with areas, hashes, and UI abstractions', async () => {
    const result = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'manual',
      now: new Date('2026-05-21T12:00:00.000Z'),
    })

    expect(result.mode).toBe('full')
    expect(result.map.files['package.json']?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.map.files['src/web/lib/Button.svelte']?.symbols).toContain('Button')
    expect(result.map.areas.map((area) => area.id)).toContain('web-ui')
    expect(result.map.abstractions.map((abstraction) => abstraction.id)).toContain('button')
    expect(result.map.abstractions.map((abstraction) => abstraction.id)).toContain('design-system')
    expect(result.map.designSystem).toMatchObject({
      sourcePath: 'memory/design-system.yaml',
      approved: true,
      maturity: 'thin',
      tokenCounts: { color: 1, spacing: 1, typography: 0, radius: 0, shadow: 0 },
    })
    expect(result.map.designSystem?.recommendations.join('\n')).toContain('UI surface area is larger')

    const saved = await fs.readFile(codebaseMapPath(memoryDir), 'utf-8')
    const parsed = parseYaml(saved) as { project?: { primaryFrameworks?: string[] } }
    expect(parsed.project?.primaryFrameworks).toContain('svelte')

    const history = await fs.readFile(codebaseMapHistoryPath(memoryDir), 'utf-8')
    expect(history).toContain('"reason":"manual"')
    expect(history).toContain('"mode":"full"')
  })

  it('partially refreshes touched files and keeps unrelated entries stable', async () => {
    const initial = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'manual',
      now: new Date('2026-05-21T12:00:00.000Z'),
    })
    const originalServeHash = initial.map.files['src/runtime/serve.ts']?.sha256

    await fs.writeFile(
      path.join(projectRoot, 'src/web/lib/Button.svelte'),
      `<script lang="ts">\n  export let variant = 'primary'\n</script>\n<button class="button extra"><slot /></button>\n`,
      'utf-8',
    )

    const next = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'worker-completion',
      touchedFiles: ['src/web/lib/Button.svelte'],
      now: new Date('2026-05-21T12:01:00.000Z'),
    })

    expect(next.mode).toBe('partial')
    expect(next.changedFiles).toEqual(['src/web/lib/Button.svelte'])
    expect(next.map.files['src/runtime/serve.ts']?.sha256).toBe(originalServeHash)
    expect(next.map.abstractions.find((item) => item.id === 'button')?.canonicalPath).toBe('src/web/lib/Button.svelte')
  })

  it('forces a full refresh when project-shape files change', async () => {
    await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })
    await fs.writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'vitest', build: 'vite build' }, dependencies: { svelte: '5.0.0' } }, null, 2),
      'utf-8',
    )

    const next = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'worker-completion',
      touchedFiles: ['package.json'],
    })

    expect(next.mode).toBe('full')
    expect(Object.keys(next.map.files)).toContain('src/runtime/serve.ts')
  })

  it('forces a full refresh when the project design system changes', async () => {
    await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })
    await fs.writeFile(
      path.join(memoryDir, 'design-system.yaml'),
      [
        'revision: 2',
        'tokens:',
        '  color:',
        '    - name: accent',
        '      value: "#7c3aed"',
        '  spacing: []',
        '  typography: []',
        '  radius: []',
        '  shadow: []',
        'primitives:',
        '  - name: Button',
        '    usage: Shared command buttons.',
        'approvedAt: 2026-05-21T00:00:00.000Z',
      ].join('\n'),
      'utf-8',
    )

    const next = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'worker-completion',
      touchedFiles: ['memory/design-system.yaml'],
    })

    expect(next.mode).toBe('full')
    expect(next.map.designSystem?.revision).toBe(2)
    expect(next.map.designSystem?.primitives.map((primitive) => primitive.name)).toContain('Button')
  })

  it('finds existing abstractions before leaf files and renders bounded worker context', async () => {
    const { map } = await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })

    const matches = findExistingAbstraction(map, 'add a button in settings')
    expect(matches[0]?.abstraction.id).toBe('button')

    const context = buildWorkerCorpusContext(map, {
      id: 'task-1',
      title: 'Add settings action button',
      description: 'Use the existing button treatment in the Settings surface.',
      likelyFiles: ['src/web/surfaces/project/SettingsTab.svelte'],
    }, { maxChars: 1200, readNextLimit: 3 })

    expect(context.length).toBeLessThanOrEqual(1200)
    expect(context).toContain('## Corpus Map')
    expect(context).toContain('Design system:')
    expect(context).toContain('Maturity: thin, approved')
    expect(context).toContain('Reuse / Extend')
    expect(context).toContain('Corpus fit required')
  })
})

async function writeFixtureProject(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src/web/lib'), { recursive: true })
  await fs.mkdir(path.join(root, 'src/web/surfaces/project'), { recursive: true })
  await fs.mkdir(path.join(root, 'src/runtime'), { recursive: true })
  await fs.mkdir(path.join(root, 'docs'), { recursive: true })
  await fs.mkdir(path.join(root, 'memory'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' }, dependencies: { svelte: '5.0.0' } }, null, 2),
    'utf-8',
  )
  await fs.writeFile(path.join(root, 'README.md'), '# Fixture\n\nA small app.\n', 'utf-8')
  await fs.writeFile(path.join(root, 'docs/architecture.md'), '# Architecture\n\nUse shared UI primitives.\n', 'utf-8')
  await fs.writeFile(
    path.join(root, 'src/web/lib/Button.svelte'),
    `<script lang="ts">\n  export let variant = 'primary'\n</script>\n<button class="button"><slot /></button>\n`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'src/web/surfaces/project/SettingsTab.svelte'),
    `<script lang="ts">\n  import Button from '../../lib/Button.svelte'\n</script>\n<Button>Save</Button>\n`,
    'utf-8',
  )
  for (const name of ['Input', 'Select', 'Card', 'Notice', 'Toolbar', 'Badge', 'Tabs']) {
    await fs.writeFile(
      path.join(root, 'src/web/lib', `${name}.svelte`),
      `<div class="${name.toLowerCase()}"><slot /></div>\n`,
      'utf-8',
    )
  }
  await fs.writeFile(
    path.join(root, 'src/runtime/serve.ts'),
    `export function createServer() {\n  return { ok: true }\n}\n`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'memory/design-system.yaml'),
    [
      'revision: 1',
      'tokens:',
      '  color:',
      '    - name: accent',
      '      value: "#7c3aed"',
      '  spacing:',
      '    - name: sm',
      '      value: 8px',
      '  typography: []',
      '  radius: []',
      '  shadow: []',
      'primitives: []',
      'approvedAt: 2026-05-21T00:00:00.000Z',
    ].join('\n'),
    'utf-8',
  )
  await execFileP('git', ['init'], { cwd: root })
  await execFileP('git', ['add', '.'], { cwd: root })
}
