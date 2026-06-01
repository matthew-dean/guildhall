import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapWorkspace, registerWorkspace } from '@guildhall/config'

import {
  acceptProjectDependencyDelivery,
  beginProjectDependencyConsumerReview,
  commitProjectDependencyDeliveryPlan,
  createProjectDependencyRequest,
  deliverProjectDependency,
  importProjectDependencyRequestForProvider,
  queryProjectGraphView,
  readProjectGraphRegistry,
  requestProjectDependencyRevision,
  reviseProjectDependencyPlan,
  writeLocalProjectGraphDraft,
} from '../project-graph.js'

let previousConfigDir: string | undefined
let systemDir: string
let consumerProject: string
let providerProject: string

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  systemDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-system-'))
  consumerProject = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-consumer-'))
  providerProject = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-provider-'))
  process.env.GUILDHALL_CONFIG_DIR = systemDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fsp.rm(systemDir, { recursive: true, force: true })
  await fsp.rm(consumerProject, { recursive: true, force: true })
  await fsp.rm(providerProject, { recursive: true, force: true })
})

describe('local project graph', () => {
  it('drafts a local graph from registered projects without requiring one shared folder', () => {
    bootstrapWorkspace(consumerProject, { id: 'knit', name: 'Knit' })
    bootstrapWorkspace(providerProject, { id: 'looma', name: 'Looma' })
    registerWorkspace({ id: 'knit', path: consumerProject, name: 'Knit', tags: [] })
    registerWorkspace({ id: 'looma', path: providerProject, name: 'Looma', tags: [] })

    const graph = writeLocalProjectGraphDraft({
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local-project:knit',
        type: 'local_guildhall_project',
        label: 'Knit',
        path: consumerProject,
      }),
      expect.objectContaining({
        id: 'local-project:looma',
        type: 'local_guildhall_project',
        label: 'Looma',
        path: providerProject,
      }),
    ]))
    expect(fs.existsSync(path.join(systemDir, 'project-graph', 'registry.json'))).toBe(true)
    expect(fs.existsSync(path.join(systemDir, 'project-graph', 'graphs', 'local.json'))).toBe(true)
  })

  it('publishes a provider request through the neutral exchange and writes only the consumer mirror', async () => {
    bootstrapWorkspace(consumerProject, { id: 'knit', name: 'Knit' })
    bootstrapWorkspace(providerProject, { id: 'looma', name: 'Looma' })

    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'knit', path: consumerProject, label: 'Knit' },
      providerProject: { id: 'looma', path: providerProject, label: 'Looma' },
      domain: { id: 'domain:editor', label: 'Editor' },
      consumerNeed: 'Knit needs inline editor comments from Looma.',
      rationale: 'The editor domain is provider-owned by Looma.',
      requestedBy: 'coordinator:knit',
      expectedDelivery: {
        format: 'editor annotation component API',
        channel: 'npm dev tag or local path',
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:00:00.000Z',
    })

    expect(edge.stateMachine.state).toBe('submitted')
    expect(edge.transitionReceipts).toEqual([
      expect.objectContaining({
        machineId: 'project-dependency-edge',
        from: 'draft',
        event: 'submit',
        to: 'submitted',
        actor: 'coordinator:knit',
      }),
    ])

    const registry = readProjectGraphRegistry()
    expect(registry.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local-project:knit', path: consumerProject }),
      expect.objectContaining({ id: 'local-project:looma', path: providerProject }),
    ]))
    expect(registry.edges).toContainEqual(expect.objectContaining({
      id: edge.id,
      state: 'submitted',
      consumerProjectId: 'knit',
      providerProjectId: 'looma',
    }))

    expect(fs.existsSync(path.join(systemDir, 'project-graph', 'edges', `${edge.id}.json`))).toBe(true)
    expect(fs.existsSync(path.join(systemDir, 'project-graph', 'exchange', 'provider-requests', `${edge.id}.json`))).toBe(true)
    expect(fs.existsSync(path.join(consumerProject, '.guildhall', 'project-graph', 'outgoing-requests', `${edge.id}.json`))).toBe(true)
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(false)
  })

  it('lets only the provider project import, shape, and deliver a dependency request', async () => {
    bootstrapWorkspace(consumerProject, { id: 'knit', name: 'Knit' })
    bootstrapWorkspace(providerProject, { id: 'looma', name: 'Looma' })
    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'knit', path: consumerProject, label: 'Knit' },
      providerProject: { id: 'looma', path: providerProject, label: 'Looma' },
      domain: { id: 'domain:editor', label: 'Editor' },
      consumerNeed: 'Knit needs inline editor comments from Looma.',
      rationale: 'The editor domain is provider-owned by Looma.',
      requestedBy: 'coordinator:knit',
      now: '2026-06-01T12:00:00.000Z',
    })

    await expect(importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: consumerProject,
      importedBy: 'coordinator:knit',
      domain: { id: 'domain:editor', label: 'Editor' },
      now: '2026-06-01T12:01:00.000Z',
    })).rejects.toThrow(/does not own provider authority/)

    const imported = await importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      importedBy: 'coordinator:looma',
      domain: { id: 'domain:editor', label: 'Editor' },
      providerTaskRef: 'task:looma-editor-comments',
      now: '2026-06-01T12:01:00.000Z',
    })
    const planned = await commitProjectDependencyDeliveryPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      plannedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'editor annotation component API',
        channel: 'npm dev tag',
        providerProofPlan: ['Run Looma editor package tests.'],
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:02:00.000Z',
    })
    const delivered = await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      deliveredBy: 'coordinator:looma',
      deliveryReceipt: {
        id: 'delivery-1',
        format: 'editor annotation component API',
        channel: 'npm dev tag',
        coordinates: '@looma/editor@0.0.0-dev.20260601',
        providerProof: ['pnpm --filter @looma/editor test'],
      },
      now: '2026-06-01T12:03:00.000Z',
    })

    expect(imported.stateMachine.state).toBe('provider_shaping')
    expect(planned.stateMachine.state).toBe('provider_working')
    expect(delivered.stateMachine.state).toBe('delivered')
    expect(delivered.providerTaskRef).toBe('task:looma-editor-comments')
    expect(delivered.transitionReceipts.map(receipt => receipt.event)).toEqual([
      'submit',
      'accept_for_shaping',
      'commit_delivery_plan',
      'deliver',
    ])
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(true)
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'deliveries', `${edge.id}.json`))).toBe(true)
  })

  it('keeps provider completion separate from consumer acceptance and supports return/redelivery', async () => {
    bootstrapWorkspace(consumerProject, { id: 'knit', name: 'Knit' })
    bootstrapWorkspace(providerProject, { id: 'looma', name: 'Looma' })
    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'knit', path: consumerProject, label: 'Knit' },
      providerProject: { id: 'looma', path: providerProject, label: 'Looma' },
      consumerNeed: 'Knit needs inline editor comments from Looma.',
      rationale: 'The editor domain is provider-owned by Looma.',
      requestedBy: 'coordinator:knit',
      now: '2026-06-01T12:00:00.000Z',
    })
    await importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      importedBy: 'coordinator:looma',
      now: '2026-06-01T12:01:00.000Z',
    })
    await commitProjectDependencyDeliveryPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      plannedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'editor annotation component API',
        channel: 'npm dev tag',
        providerProofPlan: ['Run Looma editor package tests.'],
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:02:00.000Z',
    })
    const delivered = await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      deliveredBy: 'coordinator:looma',
      deliveryReceipt: {
        id: 'delivery-1',
        format: 'framework-neutral core API',
        channel: 'npm dev tag',
        coordinates: '@looma/editor@0.0.0-dev.20260601',
        providerProof: ['pnpm --filter @looma/editor test'],
      },
      now: '2026-06-01T12:03:00.000Z',
    })

    expect(delivered.stateMachine.state).toBe('delivered')
    await expect(acceptProjectDependencyDelivery({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      acceptedBy: 'coordinator:knit',
      consumerProof: ['pnpm test'],
      now: '2026-06-01T12:04:00.000Z',
    })).rejects.toThrow(/cannot accept_delivery from delivered/)

    await beginProjectDependencyConsumerReview({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      reviewedBy: 'coordinator:knit',
      verificationContext: 'Knit editor integration task',
      now: '2026-06-01T12:04:00.000Z',
    })
    const returned = await requestProjectDependencyRevision({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      returnedBy: 'coordinator:knit',
      returnPacket: {
        deliveryReceiptId: 'delivery-1',
        mismatchKind: 'format',
        expected: 'Svelte editor annotation adapter',
        received: 'framework-neutral core API',
        failedVerification: ['Knit adapter import failed.'],
        evidenceRefs: ['task:knit-editor-integration'],
        requestedCorrection: 'Expose the Svelte adapter accepted in the delivery plan.',
      },
      now: '2026-06-01T12:05:00.000Z',
    })
    expect(returned.stateMachine.state).toBe('revision_requested')
    expect(fs.existsSync(path.join(systemDir, 'project-graph', 'exchange', 'consumer-returns', `${edge.id}.json`))).toBe(true)

    await reviseProjectDependencyPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      revisedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        providerProofPlan: ['Run adapter tests.'],
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:06:00.000Z',
    })
    await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      deliveredBy: 'coordinator:looma',
      deliveryReceipt: {
        id: 'delivery-2',
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        coordinates: '@looma/editor@0.0.0-dev.20260601.2',
        providerProof: ['pnpm --filter @looma/editor test'],
      },
      now: '2026-06-01T12:07:00.000Z',
    })
    await beginProjectDependencyConsumerReview({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      reviewedBy: 'coordinator:knit',
      verificationContext: 'Knit editor integration task',
      now: '2026-06-01T12:08:00.000Z',
    })
    const accepted = await acceptProjectDependencyDelivery({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      acceptedBy: 'coordinator:knit',
      consumerProof: ['pnpm --filter knit test'],
      now: '2026-06-01T12:09:00.000Z',
    })

    expect(accepted.stateMachine.state).toBe('resolved')
    expect(accepted.consumerAcceptance?.consumerProof).toEqual(['pnpm --filter knit test'])
    expect(readProjectGraphRegistry().edges).toContainEqual(expect.objectContaining({
      id: edge.id,
      state: 'resolved',
    }))
  })

  it('records coordinator communication packets with each project coordinator context', async () => {
    bootstrapWorkspace(consumerProject, { id: 'knit', name: 'Knit' })
    bootstrapWorkspace(providerProject, { id: 'looma', name: 'Looma' })
    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'knit', path: consumerProject, label: 'Knit' },
      providerProject: { id: 'looma', path: providerProject, label: 'Looma' },
      domain: { id: 'domain:editor', label: 'Editor' },
      consumerNeed: 'Knit needs inline editor comments from Looma.',
      rationale: 'The editor domain is provider-owned by Looma.',
      requestedBy: 'coordinator:knit',
      expectedDelivery: {
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      consumerCoordinatorContext: {
        projectId: 'knit',
        coordinatorId: 'coordinator:knit',
        activeTaskId: 'task-knit-editor',
        summary: 'Knit is consuming the editor API in its comment UI.',
        evidenceRefs: ['task:task-knit-editor', 'domain:editor-comments'],
      },
      now: '2026-06-01T12:00:00.000Z',
    })
    await importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      importedBy: 'coordinator:looma',
      providerTaskRef: 'task-looma-adapter',
      providerCoordinatorContext: {
        projectId: 'looma',
        coordinatorId: 'coordinator:looma',
        activeTaskId: 'task-looma-adapter',
        summary: 'Looma owns the editor package and can shape the adapter.',
        evidenceRefs: ['package:@looma/editor'],
      },
      now: '2026-06-01T12:01:00.000Z',
    })
    await commitProjectDependencyDeliveryPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      plannedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        providerProofPlan: ['Run Looma adapter tests.'],
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      providerCoordinatorContext: {
        projectId: 'looma',
        coordinatorId: 'coordinator:looma',
        summary: 'The adapter can ship behind a dev tag.',
        evidenceRefs: ['task:task-looma-adapter'],
      },
      now: '2026-06-01T12:02:00.000Z',
    })
    await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      deliveredBy: 'coordinator:looma',
      deliveryReceipt: {
        id: 'delivery-1',
        format: 'framework-neutral core API',
        channel: 'npm dev tag',
        coordinates: '@looma/editor@0.0.0-dev.20260601',
        providerProof: ['pnpm --filter @looma/editor test'],
      },
      providerCoordinatorContext: {
        projectId: 'looma',
        coordinatorId: 'coordinator:looma',
        summary: 'Published the first delivery for Knit to consume.',
        evidenceRefs: ['delivery:delivery-1'],
      },
      now: '2026-06-01T12:03:00.000Z',
    })
    await beginProjectDependencyConsumerReview({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      reviewedBy: 'coordinator:knit',
      verificationContext: 'Knit editor integration task',
      now: '2026-06-01T12:04:00.000Z',
    })
    await requestProjectDependencyRevision({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      returnedBy: 'coordinator:knit',
      returnPacket: {
        deliveryReceiptId: 'delivery-1',
        mismatchKind: 'format',
        expected: 'Svelte editor annotation adapter',
        received: 'framework-neutral core API',
        failedVerification: ['Knit adapter import failed.'],
        evidenceRefs: ['task:knit-editor-integration'],
        requestedCorrection: 'Expose the Svelte adapter accepted in the delivery plan.',
      },
      consumerCoordinatorContext: {
        projectId: 'knit',
        coordinatorId: 'coordinator:knit',
        summary: 'Knit could not consume the delivered format.',
        evidenceRefs: ['verification:knit-adapter-import'],
      },
      now: '2026-06-01T12:05:00.000Z',
    })
    await reviseProjectDependencyPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      revisedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        providerProofPlan: ['Run adapter tests.'],
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:06:00.000Z',
    })
    await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      deliveredBy: 'coordinator:looma',
      deliveryReceipt: {
        id: 'delivery-2',
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        coordinates: '@looma/editor@0.0.0-dev.20260601.2',
        providerProof: ['pnpm --filter @looma/editor test'],
      },
      now: '2026-06-01T12:07:00.000Z',
    })
    await beginProjectDependencyConsumerReview({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      reviewedBy: 'coordinator:knit',
      verificationContext: 'Knit editor integration task',
      now: '2026-06-01T12:08:00.000Z',
    })
    const accepted = await acceptProjectDependencyDelivery({
      edgeId: edge.id,
      consumerProjectPath: consumerProject,
      acceptedBy: 'coordinator:knit',
      consumerProof: ['pnpm --filter knit test'],
      consumerCoordinatorContext: {
        projectId: 'knit',
        coordinatorId: 'coordinator:knit',
        summary: 'Knit consumed the corrected adapter successfully.',
        evidenceRefs: ['proof:pnpm-filter-knit-test'],
      },
      now: '2026-06-01T12:09:00.000Z',
    })

    expect(accepted.communicationRecords.map(record => record.kind)).toEqual(expect.arrayContaining([
      'consumer_request',
      'provider_intake',
      'negotiated_delivery_plan',
      'delivery_receipt',
      'consumer_return',
      'final_acceptance',
    ]))
    expect(accepted.communicationRecords.find(record => record.kind === 'consumer_request')?.coordinatorContext).toMatchObject({
      projectId: 'knit',
      activeTaskId: 'task-knit-editor',
    })
    expect(accepted.communicationRecords.find(record => record.kind === 'provider_intake')?.coordinatorContext).toMatchObject({
      projectId: 'looma',
      activeTaskId: 'task-looma-adapter',
    })
    const communicationPath = path.join(systemDir, 'project-graph', 'exchange', 'coordinator-communications', `${edge.id}.jsonl`)
    const communicationLines = (await fsp.readFile(communicationPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(communicationLines.map(record => record.kind)).toEqual(accepted.communicationRecords.map(record => record.kind))
  })

  it('queries a scoped project graph view with local projects, authorities, channels, and unresolved requests', async () => {
    bootstrapWorkspace(consumerProject, { id: 'knit', name: 'Knit' })
    bootstrapWorkspace(providerProject, { id: 'looma', name: 'Looma' })
    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'knit', path: consumerProject, label: 'Knit' },
      providerProject: { id: 'looma', path: providerProject, label: 'Looma' },
      domain: { id: 'domain:editor', label: 'Editor' },
      consumerNeed: 'Knit needs inline editor comments from Looma.',
      rationale: 'The editor domain is provider-owned by Looma.',
      requestedBy: 'coordinator:knit',
      expectedDelivery: {
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:00:00.000Z',
    })
    await importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      importedBy: 'coordinator:looma',
      now: '2026-06-01T12:01:00.000Z',
    })
    await commitProjectDependencyDeliveryPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      plannedBy: 'coordinator:looma',
      deliveryExpectation: {
        format: 'Svelte editor annotation adapter',
        channel: 'npm dev tag',
        providerProofPlan: ['Run Looma adapter tests.'],
        consumerVerificationPlan: ['Run Knit editor integration tests.'],
      },
      now: '2026-06-01T12:02:00.000Z',
    })

    const view = queryProjectGraphView({
      projectId: 'knit',
      projectPath: consumerProject,
    })

    expect(view.currentProject.id).toBe('knit')
    expect(view.localProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'knit', role: 'current' }),
      expect.objectContaining({ id: 'looma', role: 'provider' }),
    ]))
    expect(view.authorityRoots).toContainEqual(expect.objectContaining({
      projectId: 'looma',
      domainId: 'domain:editor',
      authority: 'provider',
    }))
    expect(view.dependencyEdges).toContainEqual(expect.objectContaining({
      id: edge.id,
      state: 'provider_working',
      consumerProjectId: 'knit',
      providerProjectId: 'looma',
      unresolved: true,
    }))
    expect(view.deliveryChannels).toContainEqual(expect.objectContaining({
      edgeId: edge.id,
      channel: 'npm dev tag',
      format: 'Svelte editor annotation adapter',
    }))
    expect(view.unresolvedRequests).toContainEqual(expect.objectContaining({
      edgeId: edge.id,
      waitingOn: 'provider',
    }))
  })
})
