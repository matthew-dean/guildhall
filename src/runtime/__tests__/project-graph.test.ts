import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapWorkspace, registerWorkspace, writeWorkspaceConfig } from '@guildhall/config'
import { getProjectSystemStatePath } from '@guildhall/sessions'

import {
  acceptProjectDependencyDelivery,
  assignProjectDomainAuthority,
  assignProjectDomainResponsibility,
  beginProjectDependencyConsumerReview,
  commitProjectDependencyDeliveryPlan,
  createProjectDependencyRequest,
  deliverProjectDependency,
  importProjectDependencyRequestForProvider,
  queryProjectGraphView,
  readProjectGraphRegistry,
  registerProjectGraphContractSurface,
  requestProjectDependencyRevision,
  reviseProjectDependencyPlan,
  writeLocalProjectGraphDraft,
} from '../project-graph.js'

let previousConfigDir: string | undefined
let systemDir: string
let consumerProject: string
let providerProject: string
let workspaceProject: string

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  systemDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-system-'))
  consumerProject = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-consumer-'))
  providerProject = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-provider-'))
  workspaceProject = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-graph-workspace-'))
  process.env.GUILDHALL_CONFIG_DIR = systemDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fsp.rm(systemDir, { recursive: true, force: true })
  await fsp.rm(consumerProject, { recursive: true, force: true })
  await fsp.rm(providerProject, { recursive: true, force: true })
  await fsp.rm(workspaceProject, { recursive: true, force: true })
})

describe('local project graph', () => {
  it('drafts a local graph from registered projects without requiring one shared folder', () => {
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
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

  it('persists explicit domain authority assignments without writing provider project state', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
    registerWorkspace({ id: 'knit', path: consumerProject, name: 'Knit', tags: [] })
    registerWorkspace({ id: 'looma', path: providerProject, name: 'Looma', tags: [] })
    writeLocalProjectGraphDraft({ now: '2026-06-01T12:00:00.000Z' })

    await assignProjectDomainAuthority({
      domain: { id: 'domain:editor', label: 'Editor' },
      providerProject: { id: 'looma', label: 'Looma', path: providerProject },
      assignedBy: 'owner',
      now: '2026-06-01T12:01:00.000Z',
    })

    const registry = readProjectGraphRegistry()
    expect(registry.domainAuthorities).toContainEqual(expect.objectContaining({
      domain: { id: 'domain:editor', label: 'Editor' },
      providerProject: expect.objectContaining({ id: 'looma', path: providerProject }),
      assignedBy: 'owner',
    }))
    expect(fs.existsSync(path.join(systemDir, 'project-graph', 'domain-authorities', 'domain-editor.json'))).toBe(true)
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'incoming-requests'))).toBe(false)

    const providerView = queryProjectGraphView({ projectId: 'looma', projectPath: providerProject })
    expect(providerView.domainAuthorities).toContainEqual(expect.objectContaining({
      domain: expect.objectContaining({ id: 'domain:editor' }),
      providerProject: expect.objectContaining({ id: 'looma' }),
    }))
    expect(providerView.authorityRoots).toContainEqual(expect.objectContaining({
      projectId: 'looma',
      domainId: 'domain:editor',
      assigned: true,
    }))
  })

  it('builds an accurate monorepo domain and coordinator graph without cross-project auto-assignment', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Narrative Harness' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
    registerWorkspace({ id: 'harness', path: consumerProject, name: 'Narrative Harness', tags: [] })
    registerWorkspace({ id: 'looma', path: providerProject, name: 'Looma', tags: [] })

    const view = queryProjectGraphView({
      projectId: 'harness',
      projectPath: consumerProject,
      structuralDomains: [
        { id: 'domain:design', label: 'Design', kind: 'domain_group' },
        { id: 'domain:story-engine', label: 'Story Engine', kind: 'domain_group' },
      ],
      coordinators: [
        { id: 'design-coordinator', name: 'Design Coordinator', domain: 'design' },
        { id: 'story-engine', name: 'Story Engine', domain: 'story-engine' },
      ],
    })

    expect(view.localProjects).toEqual([
      expect.objectContaining({ id: 'harness', role: 'current' }),
    ])
    expect(view.localProjects).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'looma' }),
    ]))
    expect(view.localProjectIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'harness', role: 'current' }),
      expect.objectContaining({ id: 'looma', role: 'indexed' }),
    ]))
    expect(view.structuralDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'domain:design',
        label: 'Design',
        kind: 'structural_domain',
        coordinatorId: 'design-coordinator',
      }),
      expect.objectContaining({
        id: 'domain:story-engine',
        label: 'Story Engine',
        coordinatorId: 'story-engine',
      }),
    ]))
    expect(view.domainAuthorities).toEqual([])
    expect(view.authorityRoots).toEqual([])
  })

  it('does not project unrelated domain authority assignments as related work', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Narrative Harness' })
    bootstrapWorkspace(providerProject, { name: 'Guildhall' })
    registerWorkspace({ id: 'narrative-harness', path: consumerProject, name: 'Narrative Harness', tags: [] })
    registerWorkspace({ id: 'guildhall', path: providerProject, name: 'Guildhall', tags: [] })
    registerWorkspace({ id: 'jess', path: workspaceProject, name: 'Jess', tags: [] })

    await assignProjectDomainAuthority({
      domain: { id: 'domain:jess-css', label: 'Jess CSS' },
      providerProject: { id: 'jess', label: 'Jess', path: workspaceProject },
      assignedBy: 'owner',
      now: '2026-06-01T12:05:00.000Z',
    })
    await assignProjectDomainAuthority({
      domain: { id: 'domain:workflow', label: 'Workflow' },
      providerProject: { id: 'guildhall', label: 'Guildhall', path: providerProject },
      assignedBy: 'owner',
      now: '2026-06-01T12:06:00.000Z',
    })

    const view = queryProjectGraphView({
      projectId: 'narrative-harness',
      projectPath: consumerProject,
      structuralDomains: [
        { id: 'domain:workflow', label: 'Workflow', kind: 'cross_cutting_domain' },
      ],
    })

    expect(view.localProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'narrative-harness', role: 'current' }),
      expect.objectContaining({ id: 'guildhall', role: 'provider' }),
    ]))
    expect(view.localProjects).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'jess' }),
    ]))
    expect(view.localProjectIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'jess', role: 'indexed' }),
    ]))
    expect(view.domainAuthorities).toEqual([
      expect.objectContaining({
        domain: expect.objectContaining({ id: 'domain:workflow' }),
        providerProject: expect.objectContaining({ id: 'guildhall' }),
      }),
    ])
    expect(view.authorityRoots).toEqual([
      expect.objectContaining({
        projectId: 'guildhall',
        domainId: 'domain:workflow',
        assigned: true,
      }),
    ])
  })

  it('preserves coordinator domain labels without guessing capitalization', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Jess' })
    registerWorkspace({ id: 'jess', path: consumerProject, name: 'Jess', tags: [] })

    const view = queryProjectGraphView({
      projectId: 'jess',
      projectPath: consumerProject,
      coordinators: [
        { id: 'css-parser', name: 'CSS Parser coordinator', domain: 'css-parser' },
        { id: 'plugin-js', name: 'Plugin JS coordinator', domain: 'plugin-js' },
        { id: 'vscode-extension', name: 'VS Code Extension coordinator', domain: 'vscode-extension' },
      ],
    })

    expect(view.structuralDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'domain:css-parser', label: 'css-parser' }),
      expect.objectContaining({ id: 'domain:plugin-js', label: 'plugin-js' }),
      expect.objectContaining({ id: 'domain:vscode-extension', label: 'vscode-extension' }),
    ]))
  })

  it('expands registered workspace child projects into first-class provider targets', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Narrative Harness' })
    await fsp.mkdir(path.join(workspaceProject, 'looma'), { recursive: true })
    await fsp.mkdir(path.join(workspaceProject, 'knit'), { recursive: true })
    writeWorkspaceConfig(workspaceProject, {
      name: 'Looma + Knit',
      id: 'looma-knit',
      kind: 'workspace',
      projects: [
        { id: 'looma', label: 'Looma', type: 'library', path: 'looma', coordinator: 'looma' },
        { id: 'knit', label: 'Knit', type: 'app', path: 'knit', coordinator: 'knit' },
      ],
    } as Parameters<typeof writeWorkspaceConfig>[1])
    registerWorkspace({ id: 'narrative-harness', path: consumerProject, name: 'Narrative Harness', tags: [] })
    registerWorkspace({ id: 'looma-knit', path: workspaceProject, name: 'Looma + Knit', tags: [] })

    const view = queryProjectGraphView({
      projectId: 'narrative-harness',
      projectPath: consumerProject,
      structuralDomains: [
        { id: 'domain:ui-foundation', label: 'UI foundation', kind: 'domain_group' },
      ],
    })

    expect(view.localProjects).toEqual([
      expect.objectContaining({ id: 'narrative-harness', role: 'current' }),
    ])
    expect(view.localProjects).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'looma-knit' }),
      expect.objectContaining({ id: 'looma' }),
      expect.objectContaining({ id: 'knit' }),
    ]))
    expect(view.localProjectIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'narrative-harness', role: 'current' }),
      expect.objectContaining({ id: 'looma-knit', role: 'indexed', path: workspaceProject }),
      expect.objectContaining({ id: 'looma', label: 'Looma', role: 'indexed', path: path.join(workspaceProject, 'looma') }),
      expect.objectContaining({ id: 'knit', label: 'Knit', role: 'indexed', path: path.join(workspaceProject, 'knit') }),
    ]))
  })

  it('models domain responsibility facets without assigning consumer configuration away', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Narrative Harness' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
    registerWorkspace({ id: 'narrative-harness', path: consumerProject, name: 'Narrative Harness', tags: [] })
    registerWorkspace({ id: 'looma', path: providerProject, name: 'Looma', tags: [] })

    await assignProjectDomainResponsibility({
      domain: { id: 'domain:ui-foundation', label: 'UI foundation' },
      facet: 'provider_capability',
      responsibleProject: { id: 'looma', label: 'Looma', path: providerProject },
      assignedBy: 'owner',
      now: '2026-06-01T12:30:00.000Z',
    })
    await assignProjectDomainResponsibility({
      domain: { id: 'domain:ui-foundation', label: 'UI foundation' },
      facet: 'shared_contract',
      responsibleProject: { id: 'looma', label: 'Looma', path: providerProject },
      assignedBy: 'owner',
      now: '2026-06-01T12:31:00.000Z',
    })

    const view = queryProjectGraphView({
      projectId: 'narrative-harness',
      projectPath: consumerProject,
      structuralDomains: [
        { id: 'domain:ui-foundation', label: 'UI foundation', kind: 'domain_group' },
      ],
    })

    expect(view.domainResponsibilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domainId: 'domain:ui-foundation',
        facet: 'provider_capability',
        responsibleProjectId: 'looma',
        authority: 'provider',
      }),
      expect.objectContaining({
        domainId: 'domain:ui-foundation',
        facet: 'shared_contract',
        responsibleProjectId: 'looma',
        authority: 'shared',
      }),
      expect.objectContaining({
        domainId: 'domain:ui-foundation',
        facet: 'consumer_configuration',
        responsibleProjectId: 'narrative-harness',
        authority: 'consumer',
        assignable: false,
      }),
      expect.objectContaining({
        domainId: 'domain:ui-foundation',
        facet: 'consumer_verification',
        responsibleProjectId: 'narrative-harness',
        authority: 'consumer',
        assignable: false,
      }),
    ]))
  })

  it('publishes a provider request through the neutral exchange and writes only the consumer mirror', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })

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
    expect(fs.existsSync(getProjectSystemStatePath(consumerProject, path.join('project-graph', 'outgoing-requests', `${edge.id}.json`)))).toBe(true)
    expect(fs.existsSync(path.join(consumerProject, '.guildhall', 'project-graph', 'outgoing-requests', `${edge.id}.json`))).toBe(false)
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(false)
  })

  it('lets only the provider project import, shape, and deliver a dependency request', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
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
    expect(fs.existsSync(getProjectSystemStatePath(providerProject, path.join('project-graph', 'incoming-requests', `${edge.id}.json`)))).toBe(true)
    expect(fs.existsSync(getProjectSystemStatePath(providerProject, path.join('project-graph', 'deliveries', `${edge.id}.json`)))).toBe(true)
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(false)
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'deliveries', `${edge.id}.json`))).toBe(false)
  })

  it('keeps provider completion separate from consumer acceptance and supports return/redelivery', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
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
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
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
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
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

  it('keeps delivery channels ecosystem-neutral instead of overfitting to npm dev tags', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Narrative Harness' })
    bootstrapWorkspace(providerProject, { name: 'Guildhall' })
    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'harness', path: consumerProject, label: 'Narrative Harness' },
      providerProject: { id: 'guildhall', path: providerProject, label: 'Guildhall' },
      consumerNeed: 'Harness needs a spec artifact from Guildhall.',
      rationale: 'Guildhall owns the project workflow model.',
      requestedBy: 'coordinator:harness',
      expectedDelivery: {
        format: 'workflow spec artifact',
        channel: 'mcp artifact',
        deliveryChannel: {
          kind: 'mcp_artifact',
          label: 'Guildhall artifact',
          coordinates: 'guildhall://project/artifacts/flow-audit',
        },
        consumerVerificationPlan: ['Open the artifact and verify the workflow section.'],
      },
      now: '2026-06-01T12:00:00.000Z',
    })
    await importProjectDependencyRequestForProvider({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      importedBy: 'coordinator:guildhall',
      now: '2026-06-01T12:01:00.000Z',
    })
    await commitProjectDependencyDeliveryPlan({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      plannedBy: 'coordinator:guildhall',
      deliveryExpectation: {
        format: 'workflow spec artifact',
        channel: 'mcp artifact',
        deliveryChannel: {
          kind: 'mcp_artifact',
          label: 'Guildhall artifact',
          coordinates: 'guildhall://project/artifacts/flow-audit',
        },
        providerProofPlan: ['Run docs artifact validation.'],
        consumerVerificationPlan: ['Open the artifact and verify the workflow section.'],
      },
      now: '2026-06-01T12:02:00.000Z',
    })
    await deliverProjectDependency({
      edgeId: edge.id,
      providerProjectPath: providerProject,
      deliveredBy: 'coordinator:guildhall',
      deliveryReceipt: {
        id: 'delivery-1',
        format: 'workflow spec artifact',
        channel: 'local path artifact',
        coordinates: 'internal/specs/workflow.md',
        deliveryChannel: {
          kind: 'local_path_artifact',
          label: 'Checked-in spec',
          coordinates: 'internal/specs/workflow.md',
          path: 'internal/specs/workflow.md',
        },
        providerProof: ['pnpm docs:check'],
      },
      now: '2026-06-01T12:03:00.000Z',
    })

    const view = queryProjectGraphView({
      projectId: 'harness',
      projectPath: consumerProject,
    })

    expect(view.deliveryChannels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'mcp_artifact',
        coordinates: 'guildhall://project/artifacts/flow-audit',
      }),
      expect.objectContaining({
        kind: 'local_path_artifact',
        coordinates: 'internal/specs/workflow.md',
      }),
    ]))
  })

  it('keeps future Jira Linear and GitHub authority refs as local references only', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Knit' })
    bootstrapWorkspace(providerProject, { name: 'Looma' })
    const edge = await createProjectDependencyRequest({
      consumerProject: { id: 'knit', path: consumerProject, label: 'Knit' },
      providerProject: { id: 'looma', path: providerProject, label: 'Looma' },
      consumerNeed: 'Knit needs an editor adapter from Looma.',
      rationale: 'The editor domain is tracked externally but executed locally.',
      requestedBy: 'coordinator:knit',
      remoteAuthorityRefs: [
        {
          id: 'jira:DESIGN-42',
          kind: 'jira',
          label: 'DESIGN-42',
          externalId: 'DESIGN-42',
          url: 'https://jira.example/browse/DESIGN-42',
        },
        {
          id: 'github:123',
          kind: 'github_issues',
          label: 'Issue #123',
          externalId: '123',
          url: 'https://github.com/acme/looma/issues/123',
        },
      ],
      now: '2026-06-01T12:00:00.000Z',
    })

    const view = queryProjectGraphView({
      projectId: 'knit',
      projectPath: consumerProject,
    })

    expect(edge.remoteAuthorityRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'jira:DESIGN-42', kind: 'jira' }),
      expect.objectContaining({ id: 'github:123', kind: 'github_issues' }),
    ]))
    expect(view.remoteAuthorityRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        edgeId: edge.id,
        id: 'jira:DESIGN-42',
        kind: 'jira',
        executionMode: 'local_request_reference',
      }),
      expect.objectContaining({
        edgeId: edge.id,
        id: 'github:123',
        kind: 'github_issues',
        executionMode: 'local_request_reference',
      }),
    ]))
    expect(fs.existsSync(path.join(providerProject, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`))).toBe(false)
  })

  it('projects contract-surface nodes and scoped surface facets through the project graph view', async () => {
    bootstrapWorkspace(consumerProject, { name: 'Narrative Harness' })
    bootstrapWorkspace(providerProject, { name: 'Guildhall' })
    registerWorkspace({ id: 'narrative-harness', path: consumerProject, name: 'Narrative Harness', tags: [] })
    registerWorkspace({ id: 'guildhall', path: providerProject, name: 'Guildhall', tags: [] })

    await registerProjectGraphContractSurface({
      id: 'guildhall.owner-input',
      label: 'Owner input',
      kind: 'domain_capability',
      owningProject: { id: 'guildhall', label: 'Guildhall', path: providerProject },
      domain: { id: 'domain:owner-input', label: 'Owner input' },
      authority: 'shared',
      scope: 'workspace',
      sourceRefs: [{ kind: 'structured_spec', artifactId: 'bounded-chat', summary: 'Bounded chat owner-input spec.' }],
      consumerRefs: [{ id: 'narrative-harness', label: 'Narrative Harness', path: consumerProject }],
      invariants: [
        {
          id: 'one-decision-one-session',
          label: 'One decision, one session',
          rule: 'One owner decision links to one bounded-chat session.',
          proofObligations: ['Owner-input store idempotency test.'],
        },
      ],
      decisions: [],
      createdBy: 'coordinator:guildhall',
      now: '2026-06-02T12:00:00.000Z',
    })

    const graph = writeLocalProjectGraphDraft({ now: '2026-06-02T12:01:00.000Z' })
    expect(graph.nodes).toContainEqual(expect.objectContaining({
      id: 'contract-surface:guildhall.owner-input',
      type: 'contract_surface',
      label: 'Owner input',
    }))

    const view = queryProjectGraphView({
      projectId: 'narrative-harness',
      projectPath: consumerProject,
      structuralDomains: [
        { id: 'domain:owner-input', label: 'Owner input', kind: 'cross_cutting_domain' },
      ],
    })

    expect(view.contractSurfaces).toContainEqual(expect.objectContaining({
      id: 'guildhall.owner-input',
      label: 'Owner input',
      nodeId: 'contract-surface:guildhall.owner-input',
      owningProjectId: 'guildhall',
      authority: 'shared',
      domainId: 'domain:owner-input',
      consumerCount: 1,
      invariantCount: 1,
      state: 'proposed',
      scopedReason: 'consumer',
    }))
  })

  it('projects surface review packets with invariants, decisions, and proof obligations', async () => {
    bootstrapWorkspace(providerProject, { name: 'Guildhall' })
    registerWorkspace({ id: 'guildhall', path: providerProject, name: 'Guildhall', tags: [] })

    await registerProjectGraphContractSurface({
      id: 'guildhall.structure-review',
      label: 'Structure review packets',
      kind: 'domain_capability',
      owningProject: { id: 'guildhall', label: 'Guildhall', path: providerProject },
      domain: { id: 'domain:structure', label: 'Structure' },
      authority: 'shared',
      scope: 'project',
      sourceRefs: [{ kind: 'structured_spec', artifactId: 'contract-surfaces', summary: 'Contract surfaces spec.' }],
      consumerRefs: [{ id: 'thread', label: 'Thread' }],
      invariants: [{
        id: 'structure-owns-review-projection',
        label: 'Structure owns review projection',
        rule: 'Structure renders packet context; Thread owns the discussion.',
        proofObligations: ['Structure UI packet rendering test.'],
      }],
      decisions: [{
        id: 'decision-2026-06-03-structure-thread-split',
        summary: 'Keep owner-facing packet context in Structure and discussion in Thread.',
        decidedAt: '2026-06-03T10:00:00.000Z',
        decidedBy: 'owner',
        evidenceRefs: ['artifact:flow-audit'],
      }],
      createdBy: 'coordinator:guildhall',
      now: '2026-06-03T12:00:00.000Z',
    })

    const view = queryProjectGraphView({
      projectId: 'guildhall',
      projectPath: providerProject,
      surfaceReviewPackets: [{
        id: 'surface-review:task-123:guildhall.structure-review',
        surface: {
          id: 'guildhall.structure-review',
          label: 'Structure review packets',
          kind: 'domain_capability',
          authority: 'shared',
          scope: 'project',
          owningProject: { id: 'guildhall', label: 'Guildhall', path: providerProject },
          domain: { id: 'domain:structure', label: 'Structure' },
        },
        currentSpecRef: 'task:task-123',
        knownConsumers: [{ id: 'thread', label: 'Thread' }],
        existingInvariants: [{
          id: 'structure-owns-review-projection',
          label: 'Structure owns review projection',
          rule: 'Structure renders packet context; Thread owns the discussion.',
          proofObligations: ['Structure UI packet rendering test.'],
        }],
        existingDecisions: [{
          id: 'decision-2026-06-03-structure-thread-split',
          summary: 'Keep owner-facing packet context in Structure and discussion in Thread.',
          decidedAt: '2026-06-03T10:00:00.000Z',
          decidedBy: 'owner',
          evidenceRefs: ['artifact:flow-audit'],
        }],
        siblingSpecRefs: ['task:task-077'],
        driftFindings: ['Settings still mentions contract review readiness only.'],
        currentDelta: {
          surfaceId: 'guildhall.structure-review',
          relation: 'extends',
          summary: 'Adds owner-facing packet projection to Structure.',
          proofObligations: ['Render packet content in Structure.'],
        },
        proofObligations: ['Render packet content in Structure.'],
        reviewFocus: ['Does this preserve Thread as the discussion surface?'],
      }],
    })

    expect(view.contractSurfaces).toContainEqual(expect.objectContaining({
      id: 'guildhall.structure-review',
      reviewPackets: [expect.objectContaining({
        id: 'surface-review:task-123:guildhall.structure-review',
        currentSpecRef: 'task:task-123',
        knownConsumers: ['Thread'],
        existingInvariants: [expect.objectContaining({
          label: 'Structure owns review projection',
          rule: 'Structure renders packet context; Thread owns the discussion.',
        })],
        existingDecisions: [expect.objectContaining({
          summary: 'Keep owner-facing packet context in Structure and discussion in Thread.',
        })],
        siblingSpecRefs: ['task:task-077'],
        driftFindings: ['Settings still mentions contract review readiness only.'],
        currentDeltaSummary: 'Adds owner-facing packet projection to Structure.',
        proofObligations: ['Render packet content in Structure.'],
        reviewFocus: ['Does this preserve Thread as the discussion surface?'],
      })],
    }))
  })
})
