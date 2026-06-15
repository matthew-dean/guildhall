import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  acceptStructuralMap,
  applyStructuralMapReviewAction,
  applyStructuralMapCorrection,
  buildStructuralContextSlice,
  draftStructuralMap,
  refreshStructuralMap,
  requestStructuralMapCorrection,
  routeTaskWithStructuralMap,
  shapeStructuralDependencyRequest,
  submitStructuralMapForReview,
  type StructuralDiscoveryProvider,
} from '../structural-map.js'
import {
  beginProjectDependencyConsumerReview,
  commitProjectDependencyDeliveryPlan,
  createProjectDependencyRequest,
  deliverProjectDependency,
  importProjectDependencyRequestForProvider,
  requestProjectDependencyRevision,
} from '../project-graph.js'
import { listOwnerInputRequests } from '../owner-input-store.js'
import { getProjectSystemStatePath, projectStateExists } from '@guildhall/sessions'

let previousConfigDir: string | undefined
let systemDir: string
let projectRoot: string
let consumerRoot: string
let providerRoot: string

async function structuralOwnerQuestionIds(root: string, requestIds: readonly string[]): Promise<string[]> {
  const requests = await listOwnerInputRequests(root)
  const byId = new Map(requests.map(request => [request.id, request]))
  return requestIds
    .map(id => byId.get(id))
    .filter((request): request is NonNullable<typeof request> => Boolean(request))
    .map(request => request.source.kind === 'structural_map' && request.source.questionId
      ? request.source.questionId
      : request.id)
}

async function writeSystemState(root: string, relativePath: string, content: string): Promise<string> {
  const file = getProjectSystemStatePath(root, relativePath)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, content, 'utf8')
  return file
}

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  systemDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-structural-system-'))
  projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-structural-project-'))
  consumerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-structural-consumer-'))
  providerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-structural-provider-'))
  process.env.GUILDHALL_CONFIG_DIR = systemDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fsp.rm(systemDir, { recursive: true, force: true })
  await fsp.rm(projectRoot, { recursive: true, force: true })
  await fsp.rm(consumerRoot, { recursive: true, force: true })
  await fsp.rm(providerRoot, { recursive: true, force: true })
})

describe('structural map drafting', () => {
  it.each([
    {
      name: 'npm',
      lockFile: 'package-lock.json',
      workspaceId: 'workspace:npm',
      evidenceRef: 'provider:npm-workspaces',
      command: 'npm --workspace @fixture/core run test',
    },
    {
      name: 'yarn',
      lockFile: 'yarn.lock',
      workspaceId: 'workspace:yarn',
      evidenceRef: 'provider:yarn-workspaces',
      command: 'yarn workspace @fixture/core test',
    },
    {
      name: 'bun',
      lockFile: 'bun.lock',
      workspaceId: 'workspace:bun',
      evidenceRef: 'provider:bun-workspaces',
      command: 'bun --filter @fixture/core run test',
    },
    {
      name: 'package-json',
      lockFile: undefined,
      workspaceId: 'workspace:package-json',
      evidenceRef: 'provider:package-json-workspaces',
      command: 'npm --workspace @fixture/core run test',
    },
  ])('discovers $name package.json workspaces without pnpm metadata', async ({ lockFile, workspaceId, evidenceRef, command }) => {
    await writePackageJsonWorkspaceFixture(projectRoot, { lockFile })

    const draft = await draftStructuralMap({
      projectId: 'fixture',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(draft.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: workspaceId, kind: 'workspace' }),
      expect.objectContaining({
        id: 'package:fixture-core',
        kind: 'package',
        packageName: '@fixture/core',
      }),
      expect.objectContaining({
        id: 'exec:fixture-core:test',
        command,
      }),
    ]))
    expect(draft.edges).toContainEqual(expect.objectContaining({
      from: 'package:fixture-core',
      to: 'package:fixture-shared',
      kind: 'package_depends_on',
    }))
    expect(draft.evidenceRefs).toEqual(expect.arrayContaining([evidenceRef, 'manifest:package.json#workspaces']))
    expect(draft.nodes).not.toContainEqual(expect.objectContaining({ id: 'workspace:pnpm' }))
  })

  it.each([
    {
      name: 'python',
      setup: writePythonFixture,
      expectedProvider: 'provider:python-project',
      expectedNodes: [
        { id: 'package:python-acme-tools', kind: 'package', label: 'acme-tools' },
        { id: 'exec:python:pytest', kind: 'executable_unit', command: 'python -m pytest' },
      ],
    },
    {
      name: 'rust',
      setup: writeRustFixture,
      expectedProvider: 'provider:cargo-workspace',
      expectedNodes: [
        { id: 'workspace:cargo', kind: 'workspace', label: 'Cargo workspace' },
        { id: 'package:cargo-core', kind: 'package', label: 'core' },
        { id: 'exec:cargo:test', kind: 'executable_unit', command: 'cargo test --workspace' },
      ],
    },
    {
      name: 'composer',
      setup: writeComposerFixture,
      expectedProvider: 'provider:composer-project',
      expectedNodes: [
        { id: 'package:composer-acme-app', kind: 'package', label: 'acme/app' },
        { id: 'exec:composer:test', kind: 'executable_unit', command: 'composer test' },
      ],
    },
    {
      name: 'dotnet',
      setup: writeDotnetFixture,
      expectedProvider: 'provider:dotnet-solution',
      expectedNodes: [
        { id: 'workspace:dotnet', kind: 'workspace', label: 'Acme.sln' },
        { id: 'package:dotnet-acme-core', kind: 'package', label: 'Acme.Core' },
        { id: 'exec:dotnet:test', kind: 'executable_unit', command: 'dotnet test Acme.sln' },
      ],
    },
    {
      name: 'docs-only',
      setup: writeDocsOnlyFixture,
      expectedProvider: 'provider:docs-only',
      expectedNodes: [
        { id: 'domain:docs', kind: 'domain_group', label: 'Docs' },
        { id: 'exec:docs:review', kind: 'executable_unit', command: 'review docs manually' },
      ],
    },
  ])('discovers minimal $name structural shape', async ({ setup, expectedProvider, expectedNodes }) => {
    await setup(projectRoot)

    const draft = await draftStructuralMap({
      projectId: 'fixture',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })

    for (const expectedNode of expectedNodes) {
      expect(draft.nodes).toContainEqual(expect.objectContaining(expectedNode))
    }
    expect(draft.evidenceRefs).toEqual(expect.arrayContaining([expectedProvider]))
  })

  it('infers domains from package-less module/class architecture evidence', async () => {
    await writeModuleArchitectureFixture(projectRoot)

    const draft = await draftStructuralMap({
      projectId: 'modular-app',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(draft.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'domain:billing',
        kind: 'domain_group',
        label: 'billing',
        confidence: 'high',
      }),
      expect.objectContaining({
        id: 'domain:inventory',
        kind: 'domain_group',
        label: 'inventory',
        confidence: 'medium',
      }),
    ]))
    expect(draft.nodes.find(node => node.id === 'domain:billing')?.evidence.map(item => item.ref)).toEqual(expect.arrayContaining([
      'app/services/billing',
      'app/controllers/billing_controller.rb',
      'routes/billing.rb',
      'db/migrations/20260101_create_billing_tables.sql',
      'tests/billing',
    ]))
    expect(draft.evidenceRefs).toEqual(expect.arrayContaining(['provider:module-architecture']))
  })

  it('infers common cross-cutting concerns from repo evidence and owner-defined domains', async () => {
    await writeCrossCuttingFixture(projectRoot)

    const draft = await draftStructuralMap({
      projectId: 'concerns',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(draft.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cross-cutting:parser-parity', label: 'Parser parity' }),
      expect.objectContaining({ id: 'cross-cutting:design-system-reuse', label: 'Design-system reuse' }),
      expect.objectContaining({ id: 'cross-cutting:auth-session-security', label: 'Auth/session security' }),
      expect.objectContaining({ id: 'cross-cutting:migrations', label: 'Migrations' }),
      expect.objectContaining({ id: 'cross-cutting:accessibility', label: 'Accessibility' }),
      expect.objectContaining({ id: 'cross-cutting:observability', label: 'Observability' }),
      expect.objectContaining({ id: 'cross-cutting:release-packaging', label: 'Release packaging' }),
      expect.objectContaining({ id: 'cross-cutting:editor-contract', label: 'Editor contract' }),
    ]))
    expect(draft.nodes.find(node => node.id === 'cross-cutting:editor-contract')?.evidence).toContainEqual(expect.objectContaining({
      kind: 'owner',
      ref: 'owner:looma-knit-editor-contract',
    }))
  })

  it('applies owner review actions without treating correction as an opaque state bucket', async () => {
    await writePackageJsonWorkspaceFixture(projectRoot, {})
    const draft = await draftStructuralMap({
      projectId: 'fixture',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })
    const review = await submitStructuralMapForReview({
      projectRoot,
      mapId: draft.id,
      actor: 'coordinator',
      now: '2026-06-01T12:01:00.000Z',
    })

    let changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'rename_node', nodeId: 'domain:core', label: 'Core runtime' },
      now: '2026-06-01T12:02:00.000Z',
    })
    expect(changed.stateMachine.state).toBe('owner_review')
    expect(changed.nodes).toContainEqual(expect.objectContaining({ id: 'domain:core', label: 'Core runtime', confidence: 'high' }))

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'merge_nodes', sourceNodeId: 'domain:shared', targetNodeId: 'domain:core', label: 'Runtime platform' },
      now: '2026-06-01T12:03:00.000Z',
    })
    expect(changed.nodes).not.toContainEqual(expect.objectContaining({ id: 'domain:shared' }))
    expect(changed.nodes).toContainEqual(expect.objectContaining({ id: 'domain:core', label: 'Runtime platform' }))
    expect(changed.edges.some(edge => edge.from === 'domain:shared' || edge.to === 'domain:shared')).toBe(false)

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'split_node', nodeId: 'domain:core', newNodeId: 'domain:editor', label: 'Editor' },
      now: '2026-06-01T12:04:00.000Z',
    })
    expect(changed.nodes).toContainEqual(expect.objectContaining({ id: 'domain:editor', label: 'Editor', kind: 'domain_group' }))

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'mark_cross_cutting', nodeId: 'domain:editor' },
      now: '2026-06-01T12:05:00.000Z',
    })
    expect(changed.nodes).toContainEqual(expect.objectContaining({ id: 'domain:editor', kind: 'cross_cutting_domain' }))

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'mark_package_only', nodeId: 'package:fixture-core' },
      now: '2026-06-01T12:06:00.000Z',
    })
    expect(changed.edges).not.toContainEqual(expect.objectContaining({ from: 'package:fixture-core', kind: 'package_belongs_to_domain' }))

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'ignore_node', nodeId: 'domain:editor', reason: 'Generated example domain.' },
      now: '2026-06-01T12:07:00.000Z',
    })
    expect(changed.nodes).not.toContainEqual(expect.objectContaining({ id: 'domain:editor' }))

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'defer_decision', questionId: 'confirm-domain-routing', reason: 'Good enough for current routing.' },
      now: '2026-06-01T12:08:00.000Z',
    })
    await expect(structuralOwnerQuestionIds(projectRoot, changed.ownerInputRequestIds)).resolves.not.toContain('confirm-domain-routing')

    changed = await applyStructuralMapReviewAction({
      projectRoot,
      mapId: review.id,
      actor: 'owner',
      action: { kind: 'accept' },
      now: '2026-06-01T12:09:00.000Z',
    })
    expect(changed.stateMachine.state).toBe('accepted')
    expect(changed.transitionReceipts.map(receipt => receipt.event)).toEqual(expect.arrayContaining([
      'request_correction',
      'apply_correction',
      'accept',
    ]))
  })

  it('scores evidence freshness and raises owner questions for conflicting structural evidence', async () => {
    await writeCrossCuttingFixture(projectRoot)
    await writeSystemState(projectRoot, 'structural-domains.json', `${JSON.stringify({
      crossCuttingDomains: [
        {
          id: 'parser-parity',
          label: 'Parsing contracts',
          evidenceRefs: ['owner:renamed-parser-concern'],
        },
      ],
    }, null, 2)}\n`)

    const draft = await draftStructuralMap({
      projectId: 'conflicts',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })

    const parserConcern = draft.nodes.find(node => node.id === 'cross-cutting:parser-parity')
    expect(parserConcern).toEqual(expect.objectContaining({
      confidence: 'conflict',
      evidenceScore: expect.any(Number),
      freshness: 'fresh',
      conflicts: [expect.objectContaining({
        kind: 'label_conflict',
        targetId: 'cross-cutting:parser-parity',
      })],
    }))
    expect(draft.edges.every(edge => typeof edge.evidenceScore === 'number' && edge.freshness)).toBe(true)
    await expect(structuralOwnerQuestionIds(projectRoot, draft.ownerInputRequestIds)).resolves.toContain('resolve-conflict-cross-cutting-parser-parity')
  })

  it('refreshes an accepted structural map with targeted diffs and review questions', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [{ dir: 'packages/core', name: '@example/core', scripts: { test: 'vitest run packages/core' } }],
    })
    const accepted = await acceptFreshMap(projectRoot, 'example')
    await fsp.mkdir(path.join(projectRoot, 'packages', 'editor', 'src'), { recursive: true })
    await fsp.writeFile(path.join(projectRoot, 'packages', 'editor', 'package.json'), `${JSON.stringify({
      name: '@example/editor',
      scripts: { test: 'vitest run packages/editor' },
    }, null, 2)}\n`)
    await fsp.writeFile(path.join(projectRoot, 'README.md'), '# unchanged routing\n')

    const refresh = await refreshStructuralMap({
      projectRoot,
      previousMapId: accepted.id,
      projectId: 'example',
      actor: 'coordinator:example',
      now: '2026-06-01T12:05:00.000Z',
    })

    expect(refresh.nextMap.stateMachine.state).toBe('draft')
    expect(refresh.changes).toContainEqual(expect.objectContaining({
      kind: 'added',
      targetId: 'package:example-editor',
      reviewImpact: 'routing',
    }))
    expect(refresh.reviewQuestions).toContainEqual(expect.objectContaining({
      id: 'review-added-package-example-editor',
      reason: 'structural_refresh_changed_routing',
    }))
    expect(refresh.reviewQuestions).not.toContainEqual(expect.objectContaining({
      id: 'review-changed-package-example-core',
    }))
    expect(refresh.staleNodeIds).toEqual(expect.arrayContaining(['package:example-editor', 'domain:editor', 'exec:example-editor:test']))
    expect(fs.existsSync(getProjectSystemStatePath(projectRoot, path.join('structural-map', 'refreshes', `${refresh.id}.json`)))).toBe(true)
  })

  it('runs structural discovery providers so package managers can be added without changing the draft core', async () => {
    const customProvider: StructuralDiscoveryProvider = {
      id: 'fixture-provider',
      label: 'Fixture provider',
      async detect() {
        return {
          detected: true,
          evidence: [{ kind: 'manifest', ref: 'fixture.project', confidence: 'high' }],
        }
      },
      async discover() {
        return {
          nodes: [
            {
              id: 'workspace:fixture',
              kind: 'workspace',
              label: 'Fixture workspace',
              relativePath: '.',
              evidence: [{ kind: 'manifest', ref: 'fixture.project', confidence: 'high' }],
              confidence: 'high',
            },
            {
              id: 'package:fixture-lib',
              kind: 'package',
              label: '@fixture/lib',
              relativePath: 'lib',
              packageName: '@fixture/lib',
              packageId: 'fixture-lib',
              scripts: { test: 'fixture test' },
              evidence: [{ kind: 'manifest', ref: 'fixture.project#lib', confidence: 'high' }],
              confidence: 'high',
            },
          ],
          edges: [],
          evidenceRefs: ['manifest:fixture.project'],
        }
      },
    }

    const draft = await draftStructuralMap({
      projectId: 'fixture',
      projectRoot,
      discoveryProviders: [customProvider],
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(draft.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workspace:fixture', kind: 'workspace' }),
      expect.objectContaining({ id: 'package:fixture-lib', kind: 'package' }),
      expect.objectContaining({
        id: 'exec:fixture-lib:test',
        command: 'pnpm --filter @fixture/lib test',
      }),
    ]))
    expect(draft.evidenceRefs).toEqual(expect.arrayContaining(['provider:fixture-provider', 'manifest:fixture.project']))
  })

  it('persists an evidence-backed draft without mutating target repo config', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [
        {
          dir: 'packages/core',
          name: '@example/core',
          scripts: {
            test: 'vitest run packages/core',
            build: 'tsc -p packages/core/tsconfig.json',
          },
          deps: { '@example/parser': 'workspace:*' },
        },
        {
          dir: 'packages/parser',
          name: '@example/parser',
          scripts: { test: 'vitest run packages/parser' },
        },
        {
          dir: 'packages/docs',
          name: '@example/docs',
          scripts: { build: 'vitepress build docs' },
        },
      ],
    })
    await fsp.mkdir(path.join(projectRoot, 'node_modules', 'vendored', '.git'), { recursive: true })
    await fsp.mkdir(path.join(projectRoot, 'docs', 'future', 'node-copy-reduction'), { recursive: true })
    await fsp.writeFile(
      path.join(projectRoot, 'docs', 'future', 'node-copy-reduction', 'HANDOFF.md'),
      '# Node-copy reduction\n\nUse verify:node-copy-frontier before landing eval/render work.\n',
    )

    const draft = await draftStructuralMap({
      projectId: 'example',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(draft.stateMachine.state).toBe('draft')
    expect(draft.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'git:root',
        kind: 'git_authority_root',
        role: 'top_level_authority',
      }),
      expect.objectContaining({
        id: 'monorepo:root',
        kind: 'monorepo',
      }),
      expect.objectContaining({
        id: 'workspace:pnpm',
        kind: 'workspace',
      }),
      expect.objectContaining({
        id: 'package:example-core',
        kind: 'package',
        packageName: '@example/core',
      }),
      expect.objectContaining({
        id: 'domain:core',
        kind: 'domain_group',
        label: 'core',
      }),
      expect.objectContaining({
        id: 'cross-cutting:node-copy-reduction',
        kind: 'cross_cutting_domain',
        label: 'Node-copy reduction',
      }),
      expect.objectContaining({
        id: 'exec:root:verify-node-copy-frontier',
        kind: 'executable_unit',
        command: 'pnpm run verify:node-copy-frontier',
      }),
    ]))
    expect(draft.ignoredGitRoots).toContainEqual(expect.objectContaining({
      relativePath: 'node_modules/vendored',
      reason: 'vendored_dependency_git_metadata',
    }))
    expect(draft.edges).toContainEqual(expect.objectContaining({
      from: 'package:example-core',
      to: 'package:example-parser',
      kind: 'package_depends_on',
    }))
    await expect(structuralOwnerQuestionIds(projectRoot, draft.ownerInputRequestIds)).resolves.toContain('confirm-domain-routing')
    expect(fs.existsSync(path.join(projectRoot, 'guildhall.yaml'))).toBe(false)
    expect(fs.existsSync(getProjectSystemStatePath(projectRoot, path.join('structural-map', 'drafts', `${draft.id}.json`)))).toBe(true)
  })

  it('uses a deterministic review state machine before a map becomes routing truth', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [{ dir: 'packages/core', name: '@example/core', scripts: { test: 'vitest run packages/core' } }],
    })
    const draft = await draftStructuralMap({
      projectId: 'example',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })
    const submitted = await submitStructuralMapForReview({
      projectRoot,
      mapId: draft.id,
      actor: 'coordinator:example',
      now: '2026-06-01T12:01:00.000Z',
    })
    const correctionRequested = await requestStructuralMapCorrection({
      projectRoot,
      mapId: draft.id,
      actor: 'owner',
      request: {
        id: 'rename-core-domain',
        targetId: 'domain:core',
        requestedChange: 'Rename Core to Runtime core.',
        reason: 'Owner-facing routing name should match the project language.',
      },
      now: '2026-06-01T12:02:00.000Z',
    })

    expect(submitted.stateMachine.state).toBe('owner_review')
    expect(correctionRequested.stateMachine.state).toBe('correction_requested')
    await expect(acceptStructuralMap({
      projectRoot,
      mapId: draft.id,
      actor: 'owner',
      now: '2026-06-01T12:03:00.000Z',
    })).rejects.toThrow(/cannot accept from correction_requested/)

    const corrected = await applyStructuralMapCorrection({
      projectRoot,
      mapId: draft.id,
      actor: 'coordinator:example',
      correctionRequestId: 'rename-core-domain',
      changes: [{ kind: 'rename_node', nodeId: 'domain:core', label: 'Runtime core' }],
      now: '2026-06-01T12:03:00.000Z',
    })
    const accepted = await acceptStructuralMap({
      projectRoot,
      mapId: draft.id,
      actor: 'owner',
      now: '2026-06-01T12:04:00.000Z',
    })

    expect(corrected.stateMachine.state).toBe('owner_review')
    expect(accepted.stateMachine.state).toBe('accepted')
    expect(accepted.nodes).toContainEqual(expect.objectContaining({
      id: 'domain:core',
      label: 'Runtime core',
    }))
    expect(accepted.transitionReceipts.map(receipt => receipt.event)).toEqual([
      'submit_for_review',
      'request_correction',
      'apply_correction',
      'accept',
    ])
    expect(fs.existsSync(getProjectSystemStatePath(projectRoot, path.join('structural-map', 'accepted.json')))).toBe(true)
  })
})

describe('structural context and project graph handoffs', () => {
  it('routes tasks through accepted structural maps with coordinator assignment and cross-cutting activation', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [
        { dir: 'packages/css-parser', name: '@example/css-parser', scripts: { test: 'vitest run packages/css-parser' } },
        { dir: 'packages/less-parser', name: '@example/less-parser', scripts: { test: 'vitest run packages/less-parser' } },
        { dir: 'packages/scss-parser', name: '@example/scss-parser', scripts: { test: 'vitest run packages/scss-parser' } },
      ],
    })
    const accepted = await acceptFreshMap(projectRoot, 'example')

    const route = routeTaskWithStructuralMap({
      map: accepted,
      task: {
        id: 'task-parser-fixture',
        title: 'Fix css parser fixture parity',
        files: ['packages/css-parser/src/index.ts'],
        text: 'Keep parser parity with Less and SCSS fixtures.',
      },
      coordinators: [
        {
          id: 'coordinator:parser',
          domainIds: ['domain:parser'],
          crossCuttingDomainIds: ['cross-cutting:parser-parity'],
        },
      ],
    })

    expect(route).toEqual(expect.objectContaining({
      primaryDomainId: 'domain:parser',
      coordinatorId: 'coordinator:parser',
      gitAuthorityRootId: 'git:root',
      packageIds: ['package:example-css-parser'],
      executableUnitIds: ['exec:example-css-parser:test'],
      crossCuttingDomainIds: ['cross-cutting:parser-parity'],
    }))
    expect(route.routeReasons).toEqual(expect.arrayContaining([
      'matched-file:packages/css-parser/src/index.ts',
      'activated-cross-cutting:cross-cutting:parser-parity',
      'assigned-coordinator:coordinator:parser',
    ]))

    await expect(async () => routeTaskWithStructuralMap({
      map: { ...accepted, stateMachine: { ...accepted.stateMachine, state: 'owner_review' } },
      task: { id: 'blocked', title: 'Blocked' },
    })).rejects.toThrow(/must be accepted/)
  })

  it('builds a focused context slice with handles and omission reasons', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [
        { dir: 'packages/core', name: '@example/core', scripts: { test: 'vitest run packages/core' } },
        { dir: 'packages/docs', name: '@example/docs', scripts: { build: 'vitepress build docs' } },
      ],
    })
    const draft = await draftStructuralMap({
      projectId: 'example',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })
    await submitStructuralMapForReview({
      projectRoot,
      mapId: draft.id,
      actor: 'coordinator:example',
      now: '2026-06-01T12:01:00.000Z',
    })
    const accepted = await acceptStructuralMap({
      projectRoot,
      mapId: draft.id,
      actor: 'owner',
      now: '2026-06-01T12:02:00.000Z',
    })

    const slice = buildStructuralContextSlice(accepted, {
      id: 'task-core-render',
      title: 'Fix core render buffer placement',
      files: ['packages/core/src/render.ts'],
      text: 'Eval/render work in core needs focused proof.',
    })

    expect(slice.routingAuthority).toEqual(expect.objectContaining({
      gitAuthorityRootId: 'git:root',
      primaryDomainId: 'domain:core',
      executableUnitIds: expect.arrayContaining(['exec:example-core:test']),
    }))
    expect(slice.handles).toEqual(expect.arrayContaining([
      'structural-map://example/domains/core',
      'package://example/example-core',
      'git-root://example/root',
    ]))
    expect(slice.omitted).toContainEqual(expect.objectContaining({
      handle: 'package://example/example-docs',
      reason: 'unrelated_to_task_domain',
      confidence: 'high',
    }))
  })

  it('shapes cross-project agent requests from accepted structural maps and leaves delivery to the provider project', async () => {
    await writeRepoFixture(consumerRoot, {
      name: '@knit/root',
      workspace: ['packages/*'],
      packages: [{ dir: 'packages/app', name: '@knit/app', scripts: { test: 'vitest run packages/app' } }],
    })
    await writeRepoFixture(providerRoot, {
      name: '@looma/root',
      workspace: ['packages/*'],
      packages: [{ dir: 'packages/editor', name: '@looma/editor', scripts: { test: 'vitest run packages/editor' } }],
    })

    const consumerMap = await acceptFreshMap(consumerRoot, 'knit')
    const providerMap = await acceptFreshMap(providerRoot, 'looma')
    const request = shapeStructuralDependencyRequest({
      consumerMap,
      providerMap,
      consumerProject: { id: 'knit', label: 'Knit', path: consumerRoot },
      providerProject: { id: 'looma', label: 'Looma', path: providerRoot },
      requestedDomainId: 'domain:editor',
      consumerNeed: 'Knit needs Looma editor comment anchors exposed for its composition surface.',
      expectedDelivery: {
        format: 'editor integration contract',
        channel: 'package-manager delivery',
        providerProofPlan: ['pnpm --filter @looma/editor test'],
        consumerVerificationPlan: ['pnpm --filter @knit/app test'],
      },
      requestedBy: 'coordinator:knit',
      now: '2026-06-01T12:05:00.000Z',
    })

    expect(request.rationale).toContain('domain:editor is provider-owned by Looma')
    expect(request.providerProject.path).toBe(providerRoot)
    expect(request.domain).toEqual(expect.objectContaining({
      id: 'domain:editor',
      label: 'editor',
    }))

    const edge = await createProjectDependencyRequest(request)
    await importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: providerRoot,
      importedBy: 'coordinator:looma',
      now: '2026-06-01T12:06:00.000Z',
    })
    await commitProjectDependencyDeliveryPlan({
      edgeId: edge.id,
      providerProjectPath: providerRoot,
      plannedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'editor integration contract',
        channel: 'package-manager delivery',
        providerProofPlan: ['pnpm --filter @looma/editor test'],
        consumerVerificationPlan: ['pnpm --filter @knit/app test'],
      },
      now: '2026-06-01T12:07:00.000Z',
    })
    await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerRoot,
      deliveredBy: 'coordinator:looma',
      deliveryReceipt: {
        id: 'delivery-1',
        format: 'raw component internals',
        channel: 'package-manager delivery',
        coordinates: '@looma/editor@0.0.0-dev.20260601',
        providerProof: ['pnpm --filter @looma/editor test'],
      },
      now: '2026-06-01T12:08:00.000Z',
    })
    await beginProjectDependencyConsumerReview({
      edgeId: edge.id,
      consumerProjectPath: consumerRoot,
      reviewedBy: 'coordinator:knit',
      verificationContext: 'Knit app integration',
      now: '2026-06-01T12:09:00.000Z',
    })
    const returned = await requestProjectDependencyRevision({
      edgeId: edge.id,
      consumerProjectPath: consumerRoot,
      returnedBy: 'coordinator:knit',
      returnPacket: {
        deliveryReceiptId: 'delivery-1',
        mismatchKind: 'format',
        expected: 'editor integration contract',
        received: 'raw component internals',
        failedVerification: ['pnpm --filter @knit/app test'],
        evidenceRefs: ['task:knit-editor-anchors'],
        requestedCorrection: 'Expose the agreed integration contract rather than component internals.',
      },
      now: '2026-06-01T12:10:00.000Z',
    })

    expect(edge.stateMachine.state).toBe('submitted')
    expect(returned.stateMachine.state).toBe('revision_requested')
    expect(projectStateExists(providerRoot, path.join('project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(true)
    expect(projectStateExists(providerRoot, path.join('project-graph', 'deliveries', `${edge.id}.json`))).toBe(true)
    expect(projectStateExists(consumerRoot, path.join('project-graph', 'outgoing-requests', `${edge.id}.json`))).toBe(true)
  })
})

async function writeRepoFixture(root: string, input: {
  name: string
  workspace: string[]
  packages: Array<{
    dir: string
    name: string
    scripts?: Record<string, string>
    deps?: Record<string, string>
  }>
}): Promise<void> {
  await fsp.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: input.name,
    private: true,
    scripts: {
      test: 'vitest run',
      'verify:node-copy-frontier': 'node scripts/verify-node-copy-frontier.mjs',
    },
    packageManager: 'pnpm@10.0.0',
  }, null, 2)}\n`)
  await fsp.writeFile(path.join(root, 'pnpm-workspace.yaml'), `packages:\n${input.workspace.map(pattern => `  - ${pattern}`).join('\n')}\n`)
  await fsp.mkdir(path.join(root, 'scripts'), { recursive: true })
  await fsp.writeFile(path.join(root, 'scripts', 'verify-node-copy-frontier.mjs'), '')
  for (const pkg of input.packages) {
    await fsp.mkdir(path.join(root, pkg.dir, 'src'), { recursive: true })
    await fsp.writeFile(path.join(root, pkg.dir, 'package.json'), `${JSON.stringify({
      name: pkg.name,
      scripts: pkg.scripts ?? {},
      dependencies: pkg.deps ?? {},
    }, null, 2)}\n`)
    await fsp.writeFile(path.join(root, pkg.dir, 'src', 'index.ts'), `export const name = ${JSON.stringify(pkg.name)}\n`)
  }
}

async function writePackageJsonWorkspaceFixture(root: string, input: {
  lockFile?: string
}): Promise<void> {
  await fsp.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: '@fixture/root',
    private: true,
    workspaces: ['packages/*'],
    scripts: { test: 'vitest run' },
  }, null, 2)}\n`)
  if (input.lockFile) {
    await fsp.writeFile(path.join(root, input.lockFile), '')
  }
  await fsp.mkdir(path.join(root, 'packages', 'core', 'src'), { recursive: true })
  await fsp.writeFile(path.join(root, 'packages', 'core', 'package.json'), `${JSON.stringify({
    name: '@fixture/core',
    scripts: { test: 'vitest run packages/core' },
    dependencies: { '@fixture/shared': 'workspace:*' },
  }, null, 2)}\n`)
  await fsp.mkdir(path.join(root, 'packages', 'shared', 'src'), { recursive: true })
  await fsp.writeFile(path.join(root, 'packages', 'shared', 'package.json'), `${JSON.stringify({
    name: '@fixture/shared',
    scripts: { test: 'vitest run packages/shared' },
  }, null, 2)}\n`)
}

async function writePythonFixture(root: string): Promise<void> {
  await fsp.writeFile(path.join(root, 'pyproject.toml'), [
    '[project]',
    'name = "acme-tools"',
    'version = "0.1.0"',
    '',
    '[tool.pytest.ini_options]',
    'testpaths = ["tests"]',
    '',
  ].join('\n'))
  await fsp.mkdir(path.join(root, 'src', 'acme_tools'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'acme_tools', '__init__.py'), '')
  await fsp.mkdir(path.join(root, 'tests'), { recursive: true })
  await fsp.writeFile(path.join(root, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n')
}

async function writeRustFixture(root: string): Promise<void> {
  await fsp.writeFile(path.join(root, 'Cargo.toml'), [
    '[workspace]',
    'members = ["crates/core"]',
    '',
  ].join('\n'))
  await fsp.mkdir(path.join(root, 'crates', 'core', 'src'), { recursive: true })
  await fsp.writeFile(path.join(root, 'crates', 'core', 'Cargo.toml'), [
    '[package]',
    'name = "core"',
    'version = "0.1.0"',
    'edition = "2021"',
    '',
  ].join('\n'))
}

async function writeComposerFixture(root: string): Promise<void> {
  await fsp.writeFile(path.join(root, 'composer.json'), `${JSON.stringify({
    name: 'acme/app',
    autoload: { 'psr-4': { 'Acme\\\\': 'src/' } },
    scripts: { test: 'phpunit' },
  }, null, 2)}\n`)
  await fsp.mkdir(path.join(root, 'src'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'App.php'), '<?php\nnamespace Acme;\n')
}

async function writeDotnetFixture(root: string): Promise<void> {
  await fsp.writeFile(path.join(root, 'Acme.sln'), [
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    'Project("{GUID}") = "Acme.Core", "src\\Acme.Core\\Acme.Core.csproj", "{GUID2}"',
    'EndProject',
    '',
  ].join('\n'))
  await fsp.mkdir(path.join(root, 'src', 'Acme.Core'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'Acme.Core', 'Acme.Core.csproj'), [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>',
    '</Project>',
    '',
  ].join('\n'))
}

async function writeDocsOnlyFixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, 'docs'), { recursive: true })
  await fsp.writeFile(path.join(root, 'README.md'), '# Research notes\n')
  await fsp.writeFile(path.join(root, 'docs', 'index.md'), '# Project docs\n')
}

async function writeModuleArchitectureFixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, 'app', 'services', 'billing'), { recursive: true })
  await fsp.writeFile(path.join(root, 'app', 'services', 'billing', 'invoice_service.rb'), 'class InvoiceService; end\n')
  await fsp.mkdir(path.join(root, 'app', 'controllers'), { recursive: true })
  await fsp.writeFile(path.join(root, 'app', 'controllers', 'billing_controller.rb'), 'class BillingController; end\n')
  await fsp.mkdir(path.join(root, 'routes'), { recursive: true })
  await fsp.writeFile(path.join(root, 'routes', 'billing.rb'), 'route "/billing"\n')
  await fsp.mkdir(path.join(root, 'db', 'migrations'), { recursive: true })
  await fsp.writeFile(path.join(root, 'db', 'migrations', '20260101_create_billing_tables.sql'), 'create table billing_invoices;\n')
  await fsp.mkdir(path.join(root, 'tests', 'billing'), { recursive: true })
  await fsp.writeFile(path.join(root, 'tests', 'billing', 'billing_test.rb'), 'assert true\n')
  await fsp.mkdir(path.join(root, 'app', 'jobs'), { recursive: true })
  await fsp.writeFile(path.join(root, 'app', 'jobs', 'inventory_sync_job.rb'), 'class InventorySyncJob; end\n')
  await fsp.mkdir(path.join(root, 'app', 'commands', 'inventory'), { recursive: true })
  await fsp.writeFile(path.join(root, 'app', 'commands', 'inventory', 'recount_command.rb'), 'class RecountCommand; end\n')
}

async function writeCrossCuttingFixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, 'packages', 'css-parser'), { recursive: true })
  await fsp.mkdir(path.join(root, 'packages', 'less-parser'), { recursive: true })
  await fsp.mkdir(path.join(root, 'packages', 'scss-parser'), { recursive: true })
  await fsp.mkdir(path.join(root, 'packages', 'ui', 'src'), { recursive: true })
  await fsp.writeFile(path.join(root, 'packages', 'ui', 'src', 'Button.svelte'), '<button><slot /></button>\n')
  await fsp.mkdir(path.join(root, 'src', 'auth'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'auth', 'session.ts'), 'export const session = true\n')
  await fsp.mkdir(path.join(root, 'db', 'migrations'), { recursive: true })
  await fsp.writeFile(path.join(root, 'db', 'migrations', '001_create_users.sql'), 'create table users;\n')
  await fsp.mkdir(path.join(root, 'src', 'components'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'components', 'Dialog.svelte'), '<div role="dialog" aria-label="Settings"></div>\n')
  await fsp.mkdir(path.join(root, 'src', 'observability'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'observability', 'tracing.ts'), 'export const trace = true\n')
  await fsp.mkdir(path.join(root, 'scripts'), { recursive: true })
  await fsp.writeFile(path.join(root, 'scripts', 'release.mjs'), 'console.log("release")\n')
  await writeSystemState(root, 'structural-domains.json', `${JSON.stringify({
    crossCuttingDomains: [
      {
        id: 'editor-contract',
        label: 'Editor contract',
        evidenceRefs: ['owner:looma-knit-editor-contract'],
      },
    ],
  }, null, 2)}\n`)
}

async function acceptFreshMap(projectRoot: string, projectId: string) {
  const draft = await draftStructuralMap({
    projectId,
    projectRoot,
    now: '2026-06-01T12:00:00.000Z',
  })
  await submitStructuralMapForReview({
    projectRoot,
    mapId: draft.id,
    actor: `coordinator:${projectId}`,
    now: '2026-06-01T12:01:00.000Z',
  })
  return acceptStructuralMap({
    projectRoot,
    mapId: draft.id,
    actor: 'owner',
    now: '2026-06-01T12:02:00.000Z',
  })
}
