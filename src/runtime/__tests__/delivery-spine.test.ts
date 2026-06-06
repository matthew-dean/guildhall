import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'

import {
  applyContractChangeSet,
  applyFinishedWorkIntakeResult,
  buildTaskContextPacket,
  DELIVERY_SPINE_SCHEMA_DECISIONS,
  deriveQueueCandidates,
  deriveTaskRelationships,
  planTaskSplit,
  ProjectDeliveryModel,
  rejectContractChangeSet,
  revertAppliedContractResult,
  stageContractChangeSet,
  validateFinishedWorkIntakeResult,
  validateProjectPrimitiveSetupResult,
  validateProjectDeliveryModel,
  validateDeliverySpineSchemaDecisions,
  type ProjectDeliveryModel as ProjectDeliveryModelRecord,
} from '../delivery-spine.js'
import { TaskQueue } from '@guildhall/core'

const now = '2026-06-05T12:00:00.000Z'

function task(input: Record<string, any> & Pick<Task, 'id' | 'title'>): Task {
  const { id, title, ...rest } = input
  return {
    description: input.description ?? `${title} description`,
    domain: input.domain ?? 'delivery',
    projectPath: input.projectPath ?? '/workspace/looma-knit',
    status: input.status ?? 'ready',
    priority: input.priority ?? 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    ...rest,
    id,
    title,
  }
}

const model: ProjectDeliveryModelRecord = ProjectDeliveryModel.parse({
  version: 1,
  updatedAt: now,
  drivers: [
    { id: 'knit', label: 'Knit', role: 'primary', paths: ['./apps/knit'] },
    { id: 'looma', label: 'Looma', role: 'provider', paths: ['./packages/looma'] },
    { id: 'storybook', label: 'Storybook', role: 'proof', paths: ['./packages/looma/stories'] },
  ],
  primitives: [
    {
      id: 'focus-manager',
      label: 'Focus manager',
      kind: 'ui_primitive',
      provider: 'looma',
      paths: ['./packages/looma/src/focus'],
      invariants: ['Keyboard focus remains visible and deterministic.'],
      proof: ['interaction'],
      status: 'ready',
      evidence: ['test:focus-manager'],
    },
    {
      id: 'menu-item',
      label: 'MenuItem',
      kind: 'ui_primitive',
      provider: 'looma',
      paths: ['./packages/looma/src/menu'],
      dependsOn: ['focus-manager'],
      invariants: ['Can render as button or link.', 'No default link styling leaks through.'],
      proof: ['storybook', 'interaction'],
      status: 'needs_proof',
    },
    {
      id: 'menu',
      label: 'Menu',
      kind: 'ui_primitive',
      provider: 'looma',
      paths: ['./packages/looma/src/menu'],
      dependsOn: ['menu-item'],
      invariants: ['Menu composes MenuItem states consistently.'],
      proof: ['interaction'],
      status: 'proposed',
    },
  ],
})

describe('project-local delivery spine', () => {
  it('records the schema migration decision for persisted primitive and delivery state', () => {
    const validation = validateDeliverySpineSchemaDecisions(DELIVERY_SPINE_SCHEMA_DECISIONS)

    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
    expect(DELIVERY_SPINE_SCHEMA_DECISIONS.map(decision => decision.persistedSchemaTouched)).toEqual([
      '.guildhall/delivery-spine.json',
      '.guildhall/TASKS.json:tasks[].delivery',
      '.guildhall/delivery-spine.json:validationEvidence',
      '.guildhall/delivery-spine.json:finished-work-intake-derived-records',
    ])
    expect(DELIVERY_SPINE_SCHEMA_DECISIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeClass: 'backward_compatible_reader_change',
        migrationId: null,
        requiredBeforeRun: false,
        compatibilityReader: expect.stringContaining('defaults'),
        fixturesAdded: expect.arrayContaining(['delivery-spine.test.ts: old 0.9 task queue fixture']),
      }),
    ]))
  })

  it('loads old task queues and missing delivery-spine files without requiring a registered migration', () => {
    const oldQueue = TaskQueue.parse({
      lastUpdated: '2026-05-28T12:00:00.000Z',
      tasks: [{
        id: 'task-old-menu',
        title: 'Old menu task',
        description: 'Task persisted before delivery metadata existed.',
        domain: 'ui',
        projectPath: '/workspace/looma-knit',
        status: 'ready',
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        revisionCount: 0,
        remediationAttempts: 0,
        escalations: [],
        agentIssues: [],
        origination: 'human',
        createdAt: '2026-05-28T12:00:00.000Z',
        updatedAt: '2026-05-28T12:00:00.000Z',
      }],
    })
    const emptyDeliveryModel = ProjectDeliveryModel.parse({
      updatedAt: '2026-06-05T12:00:00.000Z',
    })

    expect(oldQueue.tasks[0]?.delivery).toBeUndefined()
    expect(emptyDeliveryModel).toMatchObject({
      version: 1,
      drivers: [],
      primitives: [],
      validationEvidence: [],
      rejectedCandidates: [],
    })
    expect(validateProjectDeliveryModel({
      model: emptyDeliveryModel,
      tasks: oldQueue.tasks,
      projectRoot: '/workspace/looma-knit',
    })).toMatchObject({ valid: true, errors: [] })
  })

  it('normalizes safe path hints and validates unsafe paths plus primitive/task references before they become authoritative', () => {
    const normalized = validateProjectDeliveryModel({
      model: ProjectDeliveryModel.parse({
        ...model,
        drivers: [{ id: 'knit', label: 'Knit', role: 'primary', paths: ['apps/knit'] }],
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          paths: ['/workspace/looma-knit/packages/looma/src/context-menu'],
          invariants: ['Context menu composes Menu behavior.'],
          proof: ['storybook'],
          status: 'needs_proof',
        }],
      }),
      projectRoot: '/workspace/looma-knit',
    })

    expect(normalized.valid).toBe(true)
    expect(normalized.normalized?.drivers[0]?.paths).toEqual(['./apps/knit'])
    expect(normalized.normalized?.primitives[0]?.paths).toEqual(['./packages/looma/src/context-menu'])

    const invalid = validateProjectDeliveryModel({
      model: {
        ...model,
        drivers: ProjectDeliveryModel.parse({
          ...model,
          drivers: [{ id: 'knit', label: 'Knit', role: 'primary', paths: ['../apps/knit'] }],
        }).drivers,
      },
      tasks: [task({
        id: 'task-context-menu',
        title: 'ContextMenu',
        delivery: { driver: 'missing-driver', usesPrimitives: ['menu', 'ghost-primitive'] },
      })],
    })

    expect(invalid.valid).toBe(false)
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_path', path: 'drivers.knit.paths[0]' }),
      expect.objectContaining({ code: 'unknown_driver_reference', path: 'tasks.task-context-menu.delivery.driver' }),
      expect.objectContaining({ code: 'unknown_primitive_reference', path: 'tasks.task-context-menu.delivery.usesPrimitives[1]' }),
    ]))
  })

  it('derives hierarchy, blockers, primitive ancestors, consumers, and proving tasks from one shared model', () => {
    const tasks = [
      task({
        id: 'task-context-menu',
        title: 'ContextMenu package',
        workKind: 'component',
        hierarchy: { childIds: ['task-component', 'task-storybook'], order: 0 },
        delivery: { driver: 'knit', provider: 'looma', supports: ['context-actions'], usesPrimitives: ['menu'] },
      }),
      task({
        id: 'task-component',
        title: 'Component implementation',
        workKind: 'component',
        hierarchy: { parentId: 'task-context-menu', order: 0 },
        delivery: { driver: 'knit', provider: 'looma', supports: ['task-context-menu'], usesPrimitives: ['menu', 'menu-item'] },
      }),
      task({
        id: 'task-storybook',
        title: 'Storybook proof',
        workKind: 'story',
        dependsOn: ['task-component'],
        hierarchy: { parentId: 'task-context-menu', order: 1 },
        delivery: { driver: 'knit', provider: 'storybook', supports: ['task-context-menu'], usesPrimitives: ['menu'], provesPrimitives: ['menu-item'], proofKind: 'storybook' },
      }),
    ]

    const relationships = deriveTaskRelationships({ model, tasks, taskId: 'task-storybook' })

    expect(relationships.hierarchy.parent?.id).toBe('task-context-menu')
    expect(relationships.dependencies.directBlockers.map(blocker => blocker.id)).toEqual(['task-component'])
    expect(relationships.primitiveUse.direct.map(primitive => primitive.id)).toEqual(['menu'])
    expect(relationships.primitiveUse.ancestors.map(primitive => primitive.id)).toEqual(['menu-item', 'focus-manager'])
    expect(relationships.primitiveUse.blockers.map(blocker => blocker.id)).toEqual(['menu', 'menu-item'])
    expect(relationships.primitiveProof.proves.map(primitive => primitive.id)).toEqual(['menu-item'])
    expect(relationships.primitiveProof.provingTasksByPrimitive['menu-item']?.map(provingTask => provingTask.id)).toEqual(['task-storybook'])
    expect(relationships.supports).toEqual(['task-context-menu'])
  })

  it('plans task splits with child delivery metadata and primitive reference validation', () => {
    const parent = task({
      id: 'task-context-menu',
      title: 'ContextMenu package',
      status: 'spec_review',
      delivery: { driver: 'knit', provider: 'looma', usesPrimitives: ['menu', 'menu-item'] },
      sizePlan: {
        taskId: 'task-context-menu',
        score: 5,
        band: 'large',
        action: 'split_recommended',
        factors: [],
        recommendedChildren: [
          {
            title: 'ContextMenu MenuItem implementation',
            reason: 'Compose the MenuItem primitive in the ContextMenu surface.',
            dependsOn: [],
          },
          {
            title: 'ContextMenu Storybook proof',
            reason: 'Prove the menu-item states with visual proof.',
            dependsOn: ['ContextMenu MenuItem implementation'],
            provesPrimitives: ['menu-item'],
          },
        ],
        createdAt: now,
        createdBy: 'task-sizing',
      },
    })

    const plan = planTaskSplit({ model, tasks: [parent], taskId: parent.id })

    expect(plan.errors).toEqual([])
    expect(plan.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plannedTaskId: 'task-context-menu-split-contextmenu-menuitem-implementation',
        delivery: expect.objectContaining({
          driver: 'knit',
          provider: 'looma',
          supports: ['task-context-menu'],
          usesPrimitives: ['menu-item'],
          provesPrimitives: [],
        }),
      }),
      expect.objectContaining({
        plannedTaskId: 'task-context-menu-split-contextmenu-storybook-proof',
        dependsOn: ['task-context-menu-split-contextmenu-menuitem-implementation'],
        delivery: expect.objectContaining({
          proofKind: 'storybook',
          provesPrimitives: ['menu-item'],
        }),
      }),
      expect.objectContaining({
        plannedTaskId: 'task-context-menu-split-prove-menu',
        delivery: expect.objectContaining({
          usesPrimitives: ['menu-item'],
          provesPrimitives: ['menu'],
          proofKind: 'interaction',
        }),
      }),
    ]))

    const invalid = planTaskSplit({
      model,
      tasks: [task({
        ...parent,
        sizePlan: {
          ...parent.sizePlan!,
          recommendedChildren: [{
            title: 'Ghost primitive proof',
            reason: 'Bad structured split recommendation.',
            provesPrimitives: ['ghost'],
          }],
        },
      })],
      taskId: parent.id,
    })
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown_primitive_reference' }),
    ]))
  })

  it('adds primitive-proof split children for unready primitives without existing proving work', () => {
    const parent = task({
      id: 'task-context-menu',
      title: 'ContextMenu package',
      status: 'spec_review',
      delivery: { driver: 'knit', provider: 'looma', usesPrimitives: ['menu'] },
      sizePlan: {
        taskId: 'task-context-menu',
        score: 5,
        band: 'large',
        action: 'split_recommended',
        factors: [],
        recommendedChildren: [
          {
            title: 'ContextMenu component implementation',
            reason: 'Build the component using Menu.',
            usesPrimitives: ['menu'],
            dependsOn: [],
          },
          {
            title: 'ContextMenu Storybook proof',
            reason: 'Prove ContextMenu states after the component exists.',
            dependsOn: ['ContextMenu component implementation'],
            proofKind: 'storybook',
          },
        ],
        createdAt: now,
        createdBy: 'task-sizing',
      },
    })

    const plan = planTaskSplit({ model, tasks: [parent], taskId: parent.id })

    expect(plan.errors).toEqual([])
    expect(plan.children.map(child => child.title)).toEqual([
      'ContextMenu component implementation',
      'ContextMenu Storybook proof',
      'Prove Menu primitive',
      'Prove MenuItem primitive',
    ])
    expect(plan.children.find(child => child.title === 'Prove Menu primitive')).toEqual(expect.objectContaining({
      plannedTaskId: 'task-context-menu-split-prove-menu',
      delivery: expect.objectContaining({
        driver: 'knit',
        provider: 'looma',
        supports: ['task-context-menu'],
        usesPrimitives: ['menu-item'],
        provesPrimitives: ['menu'],
        proofKind: 'interaction',
      }),
    }))
    expect(plan.children.find(child => child.title === 'Prove MenuItem primitive')).toEqual(expect.objectContaining({
      plannedTaskId: 'task-context-menu-split-prove-menuitem',
      delivery: expect.objectContaining({
        usesPrimitives: ['focus-manager'],
        provesPrimitives: ['menu-item'],
        proofKind: 'storybook',
      }),
    }))
  })

  it('builds the worker/UI context packet with why-this-now and correction hooks', () => {
    const tasks = [
      task({
        id: 'task-component',
        title: 'Component implementation',
        workKind: 'component',
        delivery: { driver: 'knit', provider: 'looma', supports: ['task-context-menu'], usesPrimitives: ['menu', 'menu-item'] },
      }),
    ]

    const packet = buildTaskContextPacket({ model, tasks, taskId: 'task-component' })

    expect(packet.deliveryIntent.driver?.label).toBe('Knit')
    expect(packet.deliveryIntent.provider?.label).toBe('Looma')
    expect(packet.primitiveContext.direct.map(primitive => primitive.id)).toEqual(['menu', 'menu-item'])
    expect(packet.primitiveContext.blockers.map(blocker => blocker.id)).toEqual(['menu', 'menu-item'])
    expect(packet.persona.id).toBe('component-delivery')
    expect(packet.whyThisNow).toContain('Knit')
    expect(packet.correctionHooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'delivery.usesPrimitives' }),
      expect.objectContaining({ field: 'delivery.driver' }),
    ]))
  })

  it('selects deterministic personas for component, primitive, proof, security, data, and runtime contexts', () => {
    const personaModel = ProjectDeliveryModel.parse({
      ...model,
      primitives: [
        ...model.primitives,
        {
          id: 'auth-guard',
          label: 'Auth guard',
          kind: 'security_primitive',
          paths: ['./src/auth'],
          invariants: ['Unauthorized users cannot access workspace data.'],
          proof: ['security-regression'],
          status: 'needs_proof',
        },
        {
          id: 'workspace-schema',
          label: 'Workspace schema',
          kind: 'data_primitive',
          paths: ['./db/migrations'],
          invariants: ['Workspace rows keep tenant ownership.'],
          proof: ['migration-test'],
          status: 'needs_proof',
        },
        {
          id: 'service-launcher',
          label: 'Service launcher',
          kind: 'runtime_primitive',
          paths: ['./src/runtime'],
          invariants: ['Service stop/start remains observable.'],
          proof: ['service-start'],
          status: 'needs_proof',
        },
      ],
    })
    const tasks = [
      task({ id: 'task-component', title: 'Component', workKind: 'component', delivery: { usesPrimitives: ['menu'] } }),
      task({ id: 'task-primitive', title: 'Primitive', workKind: 'primitive', delivery: { provesPrimitives: ['menu'] } }),
      task({ id: 'task-story', title: 'Story', workKind: 'story', delivery: { proofKind: 'storybook' } }),
      task({ id: 'task-security', title: 'Auth', delivery: { usesPrimitives: ['auth-guard'] } }),
      task({ id: 'task-data', title: 'Schema', delivery: { usesPrimitives: ['workspace-schema'] } }),
      task({ id: 'task-runtime', title: 'Runtime', delivery: { usesPrimitives: ['service-launcher'] } }),
    ]

    expect(buildTaskContextPacket({ model: personaModel, tasks, taskId: 'task-component' }).persona.id).toBe('component-delivery')
    expect(buildTaskContextPacket({ model: personaModel, tasks, taskId: 'task-primitive' }).persona.id).toBe('primitive-hardening')
    expect(buildTaskContextPacket({ model: personaModel, tasks, taskId: 'task-story' }).persona.id).toBe('proof')
    expect(buildTaskContextPacket({ model: personaModel, tasks, taskId: 'task-security' }).persona.id).toBe('security-primitive')
    expect(buildTaskContextPacket({ model: personaModel, tasks, taskId: 'task-data' }).persona.id).toBe('data-primitive')
    expect(buildTaskContextPacket({ model: personaModel, tasks, taskId: 'task-runtime' }).persona.id).toBe('runtime-primitive')
  })

  it('walks execution and primitive blockers before selecting runnable queue candidates', () => {
    const tasks = [
      task({
        id: 'task-storybook',
        title: 'Storybook proof',
        status: 'ready',
        dependsOn: ['task-component'],
        delivery: { driver: 'knit', provider: 'storybook', usesPrimitives: ['menu'], provesPrimitives: ['menu-item'], proofKind: 'storybook' },
      }),
      task({
        id: 'task-component',
        title: 'Component implementation',
        status: 'ready',
        delivery: { driver: 'knit', provider: 'looma', usesPrimitives: ['menu'] },
      }),
      task({
        id: 'task-menu-proof',
        title: 'Prove Menu primitive',
        status: 'ready',
        delivery: { driver: 'knit', provider: 'looma', provesPrimitives: ['menu'], proofKind: 'interaction' },
      }),
    ]

    const queue = deriveQueueCandidates({ model, tasks })

    expect(queue.runnable.map(candidate => candidate.task.id)).toEqual(['task-menu-proof'])
    expect(queue.blocked.map(candidate => candidate.task.id)).toEqual(['task-storybook', 'task-component'])
    expect(queue.blocked.find(candidate => candidate.task.id === 'task-storybook')?.executionBlockers.map(blocker => blocker.id)).toEqual(['task-component', 'task-menu-proof'])
    expect(queue.blocked.find(candidate => candidate.task.id === 'task-component')?.executionBlockers.map(blocker => blocker.id)).toEqual(['task-menu-proof'])
    expect(queue.blocked.find(candidate => candidate.task.id === 'task-component')?.structuralBlockers.map(blocker => blocker.id)).toEqual(['menu-item'])
    expect(queue.firstRunnable?.task.id).toBe('task-menu-proof')
  })

  it('suggests primitive-proof work when no existing proving task can unblock a structural primitive blocker', () => {
    const tasks = [
      task({
        id: 'task-component',
        title: 'Component implementation',
        status: 'ready',
        delivery: { driver: 'knit', provider: 'looma', usesPrimitives: ['menu'] },
      }),
    ]

    const queue = deriveQueueCandidates({ model, tasks })
    const component = queue.blocked.find(candidate => candidate.task.id === 'task-component')

    expect(component?.structuralBlockers.map(blocker => blocker.id)).toEqual(['menu', 'menu-item'])
    expect(component?.suggestedPrimitiveProofTasks).toEqual([
      expect.objectContaining({
        primitiveId: 'menu',
        title: 'Prove Menu primitive',
        delivery: expect.objectContaining({
          supports: ['task-component'],
          usesPrimitives: ['menu-item'],
          provesPrimitives: ['menu'],
          proofKind: 'interaction',
        }),
      }),
      expect.objectContaining({
        primitiveId: 'menu-item',
        title: 'Prove MenuItem primitive',
        delivery: expect.objectContaining({
          usesPrimitives: ['focus-manager'],
          provesPrimitives: ['menu-item'],
          proofKind: 'storybook',
        }),
      }),
    ])
  })

  it('turns primitive setup output into a reviewable change set before applying it', () => {
    const tasks = [
      task({
        id: 'task-context-menu',
        title: 'ContextMenu implementation',
        delivery: { driver: 'knit', provider: 'looma' },
      }),
    ]

    const result = validateProjectPrimitiveSetupResult({
      model,
      tasks,
      result: {
        primitives: [
          {
            id: 'context-menu',
            label: 'ContextMenu',
            kind: 'ui_primitive',
            provider: 'looma',
            paths: ['./packages/looma/src/context-menu'],
            dependsOn: ['menu'],
            invariants: ['Context menu composes menu behavior without adding bespoke focus rules.'],
            proof: ['storybook'],
            status: 'needs_proof',
          },
        ],
        taskLinks: [
          { taskId: 'task-context-menu', usesPrimitives: ['context-menu'], proofKind: 'storybook' },
        ],
      },
      now,
      actor: 'setup-agent',
      applyPolicy: 'owner_review',
    })

    expect(result.valid).toBe(true)
    expect(result.changeSet?.status).toBe('pending_review')
    expect(result.changeSet?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_primitive', primitiveId: 'context-menu' }),
      expect.objectContaining({ kind: 'link_task_primitives', taskId: 'task-context-menu' }),
    ]))
    expect(result.changeSet?.reviewBuckets.map(bucket => bucket.kind)).toEqual(['keep', 'needs_proof'])
  })

  it('applies and reverts validated primitive setup without deleting later-edited state', () => {
    const tasks = [
      task({
        id: 'task-context-menu',
        title: 'ContextMenu implementation',
        delivery: { driver: 'knit', provider: 'looma' },
      }),
    ]
    const validated = validateProjectPrimitiveSetupResult({
      model,
      tasks,
      result: {
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          dependsOn: ['menu'],
          invariants: ['Context menu composes menu behavior.'],
          proof: ['storybook'],
          status: 'needs_proof',
        }],
        taskLinks: [{ taskId: 'task-context-menu', usesPrimitives: ['context-menu'] }],
      },
      now,
      actor: 'setup-agent',
      applyPolicy: 'owner_review',
    })
    expect(validated.changeSet).toBeTruthy()

    const applied = applyContractChangeSet({
      model,
      tasks,
      changeSet: validated.changeSet!,
      now,
      actor: 'owner',
      ownerOverrideReason: 'Accepted during primitive setup review.',
    })

    expect(applied.model.primitives.find(primitive => primitive.id === 'context-menu')?.status).toBe('needs_proof')
    expect(applied.tasks[0]?.delivery?.usesPrimitives).toEqual(['context-menu'])
    expect(applied.model.validationEvidence.at(-1)).toEqual(expect.objectContaining({
      id: validated.changeSet!.id,
      status: 'applied',
      actor: 'owner',
    }))

    applied.model.primitives = applied.model.primitives.map(primitive =>
      primitive.id === 'context-menu'
        ? { ...primitive, invariants: [...primitive.invariants, 'Owner edited this after apply.'] }
        : primitive,
    )

    const reverted = revertAppliedContractResult({
      model: applied.model,
      tasks: applied.tasks,
      resultId: validated.changeSet!.id,
      now,
      actor: 'owner',
    })

    expect(reverted.model.primitives.some(primitive => primitive.id === 'context-menu')).toBe(true)
    expect(reverted.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'later_edit_preserved', path: 'primitives.context-menu' }),
    ]))
    expect(reverted.tasks[0]?.delivery).toEqual({ driver: 'knit', provider: 'looma' })
  })

  it('records rejected primitive candidates so agents do not repeat them as fresh proposals', () => {
    const validated = validateProjectPrimitiveSetupResult({
      model,
      tasks: [],
      result: {
        primitives: [{
          id: 'menu',
          label: 'Menu duplicate',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/menu'],
          invariants: ['Duplicate proposal.'],
          proof: ['storybook'],
          status: 'needs_proof',
        }],
      },
      now,
      actor: 'setup-agent',
      applyPolicy: 'owner_review',
    })
    expect(validated.changeSet).toBeTruthy()

    const rejected = rejectContractChangeSet({
      model,
      changeSet: validated.changeSet!,
      now,
      actor: 'owner',
      reason: 'Existing Menu primitive already covers this path.',
    })

    expect(rejected.rejectedCandidates.at(-1)).toEqual(expect.objectContaining({
      resultId: validated.changeSet!.id,
      actor: 'owner',
      reason: 'Existing Menu primitive already covers this path.',
    }))
  })

  it('stages owner-review contract results as validation evidence without applying changes', () => {
    const validated = validateProjectPrimitiveSetupResult({
      model,
      tasks: [],
      result: {
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          dependsOn: ['menu'],
          invariants: ['Context menu composes menu behavior.'],
          proof: ['storybook'],
          status: 'needs_proof',
        }],
      },
      now,
      actor: 'setup-agent',
      applyPolicy: 'owner_review',
    })

    const staged = stageContractChangeSet({
      model,
      changeSet: validated.changeSet!,
      now,
      actor: 'setup-agent',
    })

    expect(staged.primitives.some(primitive => primitive.id === 'context-menu')).toBe(false)
    expect(staged.validationEvidence.at(-1)).toEqual(expect.objectContaining({
      id: validated.changeSet!.id,
      status: 'pending_review',
      contractId: 'project-primitive-setup',
      reviewBuckets: expect.arrayContaining([
        expect.objectContaining({ kind: 'keep' }),
        expect.objectContaining({ kind: 'needs_proof' }),
      ]),
    }))
  })

  it('validates finished-work intake without accepting fabricated completed Guildhall tasks or code-only readiness', () => {
    const invalid = validateFinishedWorkIntakeResult({
      model,
      tasks: [],
      corpusRefs: [],
      result: {
        completedGuildhallTasks: ['task-context-menu'],
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          invariants: ['ContextMenu composes menu behavior.'],
          proof: ['storybook'],
          status: 'ready',
        }],
      },
      now,
      actor: 'intake-agent',
    })

    expect(invalid.valid).toBe(false)
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_corpus_refs', path: 'corpusRefs' }),
      expect.objectContaining({ code: 'fabricated_completed_task', path: 'completedGuildhallTasks' }),
      expect.objectContaining({ code: 'ready_without_observed_proof', path: 'primitives.context-menu.status' }),
    ]))
  })

  it('applies finished-work intake as delivery context and future suggestions, not completed tasks', () => {
    const existingTasks = [
      task({
        id: 'task-existing',
        title: 'Existing queued work',
        status: 'ready',
      }),
    ]

    const applied = applyFinishedWorkIntakeResult({
      model,
      tasks: existingTasks,
      corpusRefs: ['pr:42', 'storybook:context-menu'],
      result: {
        shippedPackages: [{
          id: 'context-menu-package',
          label: 'ContextMenu package',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          evidence: [{ kind: 'pr', ref: '42', summary: 'Merged ContextMenu package.' }],
        }],
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          dependsOn: ['menu'],
          invariants: ['ContextMenu composes menu behavior.'],
          proof: ['storybook', 'e2e'],
          status: 'unknown',
        }],
        observedProof: [{
          targetId: 'context-menu',
          targetKind: 'primitive',
          proofKind: 'storybook',
          confidence: 'high',
          evidence: [{ kind: 'storybook', path: './packages/looma/src/context-menu/ContextMenu.stories.ts', summary: 'Storybook states exist.' }],
        }],
        missingProof: [{
          targetId: 'context-menu',
          targetKind: 'primitive',
          expectedProof: ['e2e'],
          reason: 'No browser workflow proof was found.',
        }],
        futureTasks: [{
          title: 'Add ContextMenu e2e proof',
          reason: 'Retrospective intake found Storybook proof but no browser workflow proof.',
          workKind: 'test',
          provesPrimitives: ['context-menu'],
          acceptance: ['ContextMenu opens, focuses, and closes in a browser workflow.'],
          evidence: [{ kind: 'intake', ref: 'pr:42', summary: 'Gap found during finished-work intake.' }],
        }],
      },
      now,
      actor: 'intake-agent',
    })

    expect(applied.validation.valid).toBe(true)
    const contextMenu = applied.model.primitives.find(primitive => primitive.id === 'context-menu')
    expect(contextMenu?.status).toBe('needs_proof')
    expect(contextMenu?.evidence).toEqual(expect.arrayContaining([
      'storybook:./packages/looma/src/context-menu/ContextMenu.stories.ts',
    ]))
    expect(applied.tasks).toEqual(existingTasks)
    expect(applied.model.validationEvidence.at(-1)).toEqual(expect.objectContaining({
      contractId: 'finished-work-intake',
      status: 'applied',
      shippedPackages: expect.arrayContaining([
        expect.objectContaining({ id: 'context-menu-package' }),
      ]),
      futureTasks: expect.arrayContaining([
        expect.objectContaining({ title: 'Add ContextMenu e2e proof' }),
      ]),
    }))
    expect(applied.model.validationEvidence.at(-1)).not.toEqual(expect.objectContaining({
      completedGuildhallTasks: expect.anything(),
    }))
  })
})
