import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getProjectStateDir } from '@guildhall/sessions'
import { parse as parseYaml } from 'yaml'
import {
  buildWorkerCorpusContext,
  codebaseMapHistoryPath,
  codebaseMapPath,
  enrichCodebaseMapSemantics,
  parseSemanticJsonObject,
  findExistingAbstraction,
  loadCodebaseMap,
  refreshCodebaseMap,
  shouldIndexPath,
} from '../index.js'

const execFileP = promisify(execFile)

describe('corpus map', () => {
  let projectRoot: string
  let memoryDir: string

  it('ignores command-shaped path segments instead of turning shell snippets into files', () => {
    expect(shouldIndexPath('pnpm --filter @knit-app test -- tests/unit/junk.test.ts')).toBe(false)
    expect(shouldIndexPath('src/web/lib/Button.svelte')).toBe(true)
  })

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-corpus-map-'))
    memoryDir = getProjectStateDir(projectRoot)
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
      sourcePath: 'state/design-system.yaml',
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
      touchedFiles: ['.guildhall/design-system.yaml'],
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

  it('adds model-assisted semantic orientation without replacing deterministic indexing', async () => {
    const result = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'manual',
      now: new Date('2026-05-21T12:00:00.000Z'),
      semanticIndexer: {
        modelId: 'semantic-test-model',
        async completeJson({ prompt }) {
          expect(prompt).toContain('src/web/lib/Button.svelte')
          expect(prompt).toContain('Return ONLY valid JSON')
          return JSON.stringify({
            corpusKind: 'code',
            confidence: 0.92,
            projectPurpose: 'Fixture app for testing shared UI primitives.',
            currentTruth: ['Button.svelte is the canonical command button.'],
            architectureAreas: [
              {
                name: 'Web UI',
                purpose: 'Shared Svelte controls and project surfaces.',
                canonicalFiles: ['src/web/lib/Button.svelte', 'src/web/surfaces/project/SettingsTab.svelte'],
              },
            ],
            canonicalAbstractions: [
              {
                name: 'Command Button',
                purpose: 'Shared action control.',
                canonicalFiles: ['src/web/lib/Button.svelte'],
                reuseRule: 'Reuse before adding local button styles.',
              },
            ],
            gapsOrRisks: ['The deterministic map is thin for UI semantics.'],
            readNext: [
              { path: 'src/web/lib/Button.svelte', reason: 'Canonical action primitive.' },
            ],
            workerGuidance: ['Name the primitive before editing.', 'Read sibling controls when the map is thin.'],
            needsBroaderRead: true,
          })
        },
      },
    })

    expect(result.map.semantic).toMatchObject({
      modelId: 'semantic-test-model',
      corpusKind: 'code',
      confidence: 0.92,
      projectPurpose: 'Fixture app for testing shared UI primitives.',
      needsBroaderRead: true,
    })
    expect(result.map.files['src/web/lib/Button.svelte']).toBeDefined()

    const saved = await loadCodebaseMap(memoryDir)
    expect(saved?.semantic?.canonicalAbstractions[0]).toMatchObject({
      name: 'Command Button',
      canonicalFiles: ['src/web/lib/Button.svelte'],
    })

    const context = buildWorkerCorpusContext(result.map, {
      id: 'task-semantic',
      title: 'Add a settings button',
      description: 'Use the existing button treatment.',
    }, { maxChars: 2000 })
    expect(context).toContain('Semantic orientation:')
    expect(context).toContain('Fixture app for testing shared UI primitives.')
    expect(context).toContain('Read sibling controls when the map is thin.')
  })

  it('can enrich an already-built map with a model-assisted semantic pass', async () => {
    const { map } = await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })
    const enriched = await enrichCodebaseMapSemantics(map, {
      modelId: 'semantic-test-model',
      async completeJson() {
        return JSON.stringify({
          corpusKind: 'mixed',
          confidence: 0.7,
          projectPurpose: 'Updated purpose.',
          currentTruth: [],
          architectureAreas: [],
          canonicalAbstractions: [],
          gapsOrRisks: [],
          readNext: [{ path: 'docs/architecture.md', reason: 'Project orientation.' }],
          workerGuidance: ['Read the Corpus Map before editing.'],
          needsBroaderRead: false,
        })
      },
    })

    expect(enriched.semantic).toMatchObject({
      corpusKind: 'mixed',
      projectPurpose: 'Updated purpose.',
      modelId: 'semantic-test-model',
    })
    expect(enriched.files).toBe(map.files)
  })

  it('uses the semantic repair model when JSON is valid but too thin to guide workers', async () => {
    const { map } = await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })
    const calls: string[] = []
    const enriched = await enrichCodebaseMapSemantics(map, {
      modelId: 'semantic-test-model',
      async completeJson() {
        calls.push('main')
        return JSON.stringify({
          corpusKind: 'documentation',
          confidence: 0.95,
          projectPurpose: 'Fixture documentation project.',
          currentTruth: ['The fixture has docs but no useful guidance'],
          architectureAreas: [],
          canonicalAbstractions: [],
          gapsOrRisks: [],
          readNext: [],
          workerGuidance: [],
          needsBroaderRead: false,
        })
      },
      async repairJson({ error, schemaHint }) {
        calls.push('repair')
        expect(error).toContain('readNext')
        expect(schemaHint).toContain('workerGuidance')
        return JSON.stringify({
          corpusKind: 'documentation',
          confidence: 0.91,
          projectPurpose: 'Fixture documentation project.',
          currentTruth: ['The fixture is documentation-led and has one Svelte UI example.'],
          architectureAreas: [
            {
              name: 'Documentation',
              purpose: 'Project orientation and architecture notes.',
              canonicalFiles: ['README.md', 'docs/architecture.md'],
            },
          ],
          canonicalAbstractions: [],
          gapsOrRisks: ['The deterministic map is thin and should not be treated as complete architecture knowledge.'],
          readNext: [{ path: 'docs/architecture.md', reason: 'Canonical project architecture note.' }],
          workerGuidance: ['Read the listed documentation before editing related code.'],
          needsBroaderRead: true,
        })
      },
    })

    expect(calls).toEqual(['main', 'repair'])
    expect(enriched.semantic).toMatchObject({
      corpusKind: 'documentation',
      readNext: [{ path: 'docs/architecture.md', reason: 'Canonical project architecture note.' }],
      workerGuidance: ['Read the listed documentation before editing related code.'],
      needsBroaderRead: true,
    })
  })

  it('proposes repeated cross-spec contract-surface patterns without applying them', async () => {
    await fs.mkdir(path.join(projectRoot, 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, 'specs/webhook-delivery.md'),
      [
        '# Webhook delivery',
        '',
        'Contract Surface: Event delivery envelope',
        'Surface Kind: schema',
        'Invariant: Every webhook payload includes eventId, occurredAt, and apiVersion.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(projectRoot, 'specs/audit-stream.md'),
      [
        '# Audit stream',
        '',
        'Contract Surface: Event delivery envelope',
        'Surface Kind: schema',
        'Invariant: Every webhook payload includes eventId, occurredAt, and apiVersion.',
      ].join('\n'),
      'utf-8',
    )

    const result = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'manual',
      now: new Date('2026-06-02T12:00:00.000Z'),
    })

    expect(result.map.contractSurfaceProposals).toEqual([
      expect.objectContaining({
        label: 'Event delivery envelope',
        kind: 'schema',
        ownerApprovalRequired: true,
        evidence: expect.arrayContaining([
          expect.objectContaining({ path: 'specs/webhook-delivery.md' }),
          expect.objectContaining({ path: 'specs/audit-stream.md' }),
        ]),
        repeatedPatterns: ['Every webhook payload includes eventId, occurredAt, and apiVersion.'],
      }),
    ])
  })

  it('repairs obvious malformed semantic JSON deterministically before retrying the model', () => {
    const repaired = parseSemanticJsonObject([
      'Here is the JSON:',
      '{',
      '  "corpusKind": "code",',
      '  "confidence": 0.8,',
      '  "projectPurpose": "Fixture",',
      '  "currentTruth": ["A",],',
      '  "architectureAreas": [],',
      '  "canonicalAbstractions": [],',
      '  "gapsOrRisks": [],',
      '  "readNext": [],',
      '  "workerGuidance": [],',
      '  "needsBroaderRead": false,',
      '}',
    ].join('\n'))

    expect(repaired).toMatchObject({
      corpusKind: 'code',
      currentTruth: ['A'],
      needsBroaderRead: false,
    })
  })

  it('uses the semantic repair model when deterministic cleanup cannot parse the response', async () => {
    const { map } = await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })
    const calls: string[] = []
    const enriched = await enrichCodebaseMapSemantics(map, {
      modelId: 'semantic-test-model',
      async completeJson() {
        calls.push('main')
        return '{ "corpusKind": "code", "projectPurpose": '
      },
      async repairJson({ raw, schemaHint }) {
        calls.push(`repair:${raw.length}:${schemaHint.includes('canonicalAbstractions')}`)
        return JSON.stringify({
          corpusKind: 'code',
          confidence: 0.81,
          projectPurpose: 'Repaired fixture purpose.',
          currentTruth: [],
          architectureAreas: [],
          canonicalAbstractions: [],
          gapsOrRisks: [],
          readNext: [{ path: 'README.md', reason: 'Repaired project orientation.' }],
          workerGuidance: ['Use repaired JSON.'],
          needsBroaderRead: false,
        })
      },
    })

    expect(calls).toEqual(['main', expect.stringMatching(/^repair:/)])
    expect(enriched.semantic).toMatchObject({
      modelId: 'semantic-test-model',
      projectPurpose: 'Repaired fixture purpose.',
      workerGuidance: ['Use repaired JSON.'],
      readNext: [{ path: 'README.md', reason: 'Repaired project orientation.' }],
    })
  })

  it('uses the semantic repair model when JSON parses but violates the schema', async () => {
    const { map } = await refreshCodebaseMap({ projectRoot, memoryDir, reason: 'manual' })
    const enriched = await enrichCodebaseMapSemantics(map, {
      modelId: 'semantic-test-model',
      async completeJson() {
        return JSON.stringify({
          corpusKind: 'code',
          confidence: 'high',
          currentTruth: 'not an array',
        })
      },
      async repairJson({ error, schemaHint }) {
        expect(error).toContain('Expected number')
        expect(schemaHint).toContain('currentTruth')
        return JSON.stringify({
          corpusKind: 'code',
          confidence: 0.84,
          projectPurpose: 'Schema repaired fixture purpose.',
          currentTruth: ['Schema now matches.'],
          architectureAreas: [],
          canonicalAbstractions: [],
          gapsOrRisks: [],
          readNext: [{ path: 'README.md', reason: 'Schema repaired project orientation.' }],
          workerGuidance: ['Use schema-repaired JSON.'],
          needsBroaderRead: false,
        })
      },
    })

    expect(enriched.semantic).toMatchObject({
      confidence: 0.84,
      projectPurpose: 'Schema repaired fixture purpose.',
      currentTruth: ['Schema now matches.'],
      readNext: [{ path: 'README.md', reason: 'Schema repaired project orientation.' }],
      workerGuidance: ['Use schema-repaired JSON.'],
    })
  })
})

async function writeFixtureProject(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src/web/lib'), { recursive: true })
  await fs.mkdir(path.join(root, 'src/web/surfaces/project'), { recursive: true })
  await fs.mkdir(path.join(root, 'src/runtime'), { recursive: true })
  await fs.mkdir(path.join(root, 'docs'), { recursive: true })
  const memoryDir = getProjectStateDir(root)
  await fs.mkdir(memoryDir, { recursive: true })
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
    path.join(memoryDir, 'design-system.yaml'),
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
