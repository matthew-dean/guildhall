import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getProjectStateDir } from '@guildhall/sessions'
import {
  buildWorkerCorpusContext,
  refreshCodebaseMap,
  renderDesignGovernancePacket,
} from '../index.js'

describe('corpus design-governance diagnostics', () => {
  let projectRoot: string
  let memoryDir: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-governance-'))
    memoryDir = getProjectStateDir(projectRoot)
    await writeGuildhallGovernanceFixture(projectRoot)
  })

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  it('detects portable design-system risks during corpus refresh', async () => {
    const { map } = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'manual',
      now: new Date('2026-06-01T12:00:00.000Z'),
    })

    expect(map.designGovernance?.diagnostics.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'token_family_split',
      'raw_visual_values',
      'variant_vocabulary_sprawl',
      'duplicate_primitive_family',
      'surface_ownership_sprawl',
      'missing_component_contract',
    ]))

    const tokenSplit = diagnostic(map, 'token_family_split')
    expect(tokenSplit.evidence.map((item) => item.path)).toEqual(expect.arrayContaining([
      'packages/ui/src/styles.css',
      'src/web/tokens.css',
    ]))

    const variants = diagnostic(map, 'variant_vocabulary_sprawl')
    expect(variants.summary).toContain('regular')
    expect(variants.summary).toContain('attention')
    expect(variants.evidence.some((item) => item.path === 'src/web/lib/NoticeBand.svelte')).toBe(true)

    const duplicates = diagnostic(map, 'duplicate_primitive_family')
    expect(duplicates.summary).toContain('NoticeBand')
    expect(duplicates.summary).toContain('FrameCard/Card')

    const surface = diagnostic(map, 'surface_ownership_sprawl')
    expect(surface.summary).toContain('SettingsTab.svelte')
    expect(surface.summary).toContain('project graph')

    const rawValues = diagnostic(map, 'raw_visual_values')
    expect(rawValues.recommendation).toContain('role tokens')
    expect(rawValues.evidence.some((item) => item.path === 'src/web/surfaces/project/SettingsTab.svelte')).toBe(true)

    expect(map.designGovernance?.learningProposals.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'project_design_system_memory_update',
      'component_contract_addition',
      'corpus_map_override',
      'guildhall_product_learning',
    ]))
    expect(map.designGovernance?.learningProposals.every((item) => item.ownerApprovalRequired)).toBe(true)
  })

  it('renders a compact worker and reviewer governance packet for UI tasks', async () => {
    const { map } = await refreshCodebaseMap({
      projectRoot,
      memoryDir,
      reason: 'manual',
      now: new Date('2026-06-01T12:00:00.000Z'),
    })

    const packet = renderDesignGovernancePacket(map)

    expect(packet).toContain('## Design Governance')
    expect(packet).toContain('Canonical design-system authority: .guildhall/design-system.yaml')
    expect(packet).toContain('Token authority: packages/ui/src/styles.css')
    expect(packet).toContain('Component authority: packages/ui/src/components/FrameCard.svelte, packages/ui/src/components/NoticeBand.svelte')
    expect(packet).toContain('Known duplicate primitive families: FrameCard/Card, NoticeBand')
    expect(packet).toContain('Variant vocabulary risks: attention, default, regular')
    expect(packet).toContain('Learning proposals require owner approval:')
    expect(packet).toContain('Required reviewer checks:')
    expect(packet).toContain('Name the token/component roles reused or extended.')
    expect(packet).toContain('Reject local one-off styling when a governed primitive exists.')
    expect(packet).toContain('Reject new variant names unless a component contract changed.')

    const workerContext = buildWorkerCorpusContext(map, {
      id: 'task-ui',
      title: 'Reduce SettingsTab card and notice sprawl',
      description: 'Move SettingsTab onto governed UI primitives without adding local CSS variants.',
      likelyFiles: ['src/web/surfaces/project/SettingsTab.svelte'],
    }, { maxChars: 5000 })

    expect(workerContext).toContain('## Design Governance')
    expect(workerContext).toContain('Known duplicate primitive families: FrameCard/Card, NoticeBand')
    expect(workerContext).toContain('Reject new variant names unless a component contract changed.')
  })
})

function diagnostic(
  map: Awaited<ReturnType<typeof refreshCodebaseMap>>['map'],
  kind: NonNullable<Awaited<ReturnType<typeof refreshCodebaseMap>>['map']['designGovernance']>['diagnostics'][number]['kind'],
) {
  const found = map.designGovernance?.diagnostics.find((item) => item.kind === kind)
  expect(found, `Expected diagnostic kind ${kind}`).toBeDefined()
  return found!
}

async function writeGuildhallGovernanceFixture(root: string): Promise<void> {
  await fs.mkdir(path.join(root, '.guildhall'), { recursive: true })
  await fs.mkdir(path.join(root, 'packages/ui/src/components'), { recursive: true })
  await fs.mkdir(path.join(root, 'src/web/lib'), { recursive: true })
  await fs.mkdir(path.join(root, 'src/web/surfaces/project'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { svelte: '5.0.0' } }, null, 2),
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, '.guildhall/design-system.yaml'),
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
      'approvedAt: 2026-06-01T00:00:00.000Z',
    ].join('\n'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'packages/ui/src/styles.css'),
    ':root {\n  --gh-color-canvas: #fff;\n  --gh-space-3: 12px;\n}\n',
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'src/web/tokens.css'),
    ':root {\n  --fs-title: 1.25rem;\n  --s-3: 12px;\n  --r-panel: 10px;\n}\n',
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'packages/ui/src/components/NoticeBand.svelte'),
    '<section class="gh-notice-band"><slot /></section>\n',
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'packages/ui/src/components/FrameCard.svelte'),
    [
      '<script lang="ts">',
      "  type FrameCardTone = 'default' | 'info' | 'warn'",
      '</script>',
      '<section class="gh-frame-card"><slot /></section>',
    ].join('\n'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'src/web/lib/NoticeBand.svelte'),
    [
      '<script lang="ts">',
      "  type Tone = 'neutral' | 'accent' | 'attention' | 'ok' | 'warn' | 'danger'",
      "  type Density = 'regular' | 'compact'",
      '</script>',
      '<div class="notice-band tone-attention density-regular"><slot /></div>',
      '<style>',
      '  .notice-band {',
      '    padding: 14px;',
      '    border-radius: 10px;',
      '    font-weight: 700;',
      '    color: #4c1d95;',
      '  }',
      '</style>',
    ].join('\n'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'src/web/lib/Card.svelte'),
    [
      '<article class="card"><slot /></article>',
      '<style>',
      '  .card {',
      '    padding: 18px;',
      '    border-radius: 12px;',
      '    box-shadow: 0 10px 20px rgb(15 23 42 / 0.12);',
      '  }',
      '</style>',
    ].join('\n'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, 'src/web/surfaces/project/SettingsTab.svelte'),
    [
      '<script lang="ts">',
      "  const sections = ['ready', 'providers', 'facts', 'learning', 'reintake', 'project graph', 'design feedback', 'advanced levers']",
      '  export let readiness = false',
      '  export let providers = []',
      '  export let facts = []',
      '  export let memory = []',
      '  export let projectGraph = null',
      '</script>',
      '<section class="settings-card">{sections.join(", ")}</section>',
      '<style>',
      '  .settings-card {',
      '    margin-top: 7px;',
      '    padding: 1.25rem;',
      '    font-size: 1.375rem;',
      '    line-height: 1.72;',
      '    z-index: 42;',
      '  }',
      '</style>',
    ].join('\n'),
    'utf-8',
  )
}
