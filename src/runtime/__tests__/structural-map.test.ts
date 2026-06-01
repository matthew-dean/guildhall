import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  acceptStructuralMap,
  applyStructuralMapCorrection,
  buildStructuralContextSlice,
  draftStructuralMap,
  requestStructuralMapCorrection,
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

let previousConfigDir: string | undefined
let systemDir: string
let projectRoot: string
let consumerRoot: string
let providerRoot: string

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
        label: 'Core',
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
    expect(draft.ownerQuestions).toContainEqual(expect.objectContaining({
      id: 'confirm-domain-routing',
      reason: 'owner_review_required_before_routing_truth',
    }))
    expect(fs.existsSync(path.join(projectRoot, 'guildhall.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(projectRoot, '.guildhall', 'structural-map', 'drafts', `${draft.id}.json`))).toBe(true)
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
    expect(fs.existsSync(path.join(projectRoot, '.guildhall', 'structural-map', 'accepted.json'))).toBe(true)
  })
})

describe('structural context and project graph handoffs', () => {
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
      label: 'Editor',
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
    expect(fs.existsSync(path.join(providerRoot, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(true)
    expect(fs.existsSync(path.join(providerRoot, '.guildhall', 'project-graph', 'deliveries', `${edge.id}.json`))).toBe(true)
    expect(fs.existsSync(path.join(consumerRoot, '.guildhall', 'project-graph', 'outgoing-requests', `${edge.id}.json`))).toBe(true)
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
