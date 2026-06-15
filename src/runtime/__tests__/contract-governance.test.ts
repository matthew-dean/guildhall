import { describe, expect, it } from 'vitest'

import {
  ContractRegistry,
  ContractRecord,
  applyContractIntake,
  applyContractOwnerCorrection,
  applyContractProofResult,
  deriveContractQueuePressure,
} from '../contract-governance.js'
import { validateBuiltInProjectMigrationDefinitions } from '../migrations.js'

const baseContract: ContractRecord = {
  id: 'primitive:menu-item',
  label: 'MenuItem primitive',
  type: 'ui_component',
  owner: 'looma',
  provider: 'looma',
  paths: ['./packages/looma/src/menu'],
  consumers: [],
  invariants: ['Can render as button or link.'],
  obligations: ['Do not leak default link styling.'],
  proofRequirements: ['storybook', 'interaction'],
  validationState: 'observed',
  evidenceRefs: [],
  lastObservedSource: 'finished-work-intake',
  updatedAt: '2026-06-05T12:00:00.000Z',
}

describe('contract governance registry', () => {
  it('observes contracts, attaches proof, flags missing proof, violations, invalidation, and queue pressure', () => {
    let registry = ContractRegistry.empty('2026-06-05T12:00:00.000Z')

    registry = applyContractIntake(registry, {
      source: 'finished-work-intake',
      contracts: [baseContract],
    })
    expect(registry.contracts['primitive:menu-item']?.validationState).toBe('observed')

    registry = applyContractProofResult(registry, {
      contractId: 'primitive:menu-item',
      proofKind: 'storybook',
      evidenceRef: 'test:storybook-menu-item',
      passed: true,
      observedAt: '2026-06-05T12:05:00.000Z',
    })
    expect(registry.contracts['primitive:menu-item']).toMatchObject({
      validationState: 'needs_proof',
      evidenceRefs: ['test:storybook-menu-item'],
    })

    registry = applyContractProofResult(registry, {
      contractId: 'primitive:menu-item',
      proofKind: 'interaction',
      evidenceRef: 'test:interaction-menu-item',
      passed: true,
      observedAt: '2026-06-05T12:10:00.000Z',
    })
    expect(registry.contracts['primitive:menu-item']?.validationState).toBe('validated')

    registry = applyContractOwnerCorrection(registry, {
      action: 'flag_possible_violation',
      contractId: 'primitive:menu-item',
      reason: 'Visual evidence suggests link styling may leak under hover.',
      updatedAt: '2026-06-05T12:12:00.000Z',
    })
    expect(registry.contracts['primitive:menu-item']).toMatchObject({
      validationState: 'possibly_violated',
      staleReasons: ['Visual evidence suggests link styling may leak under hover.'],
    })

    registry = applyContractProofResult(registry, {
      contractId: 'primitive:menu-item',
      proofKind: 'interaction',
      evidenceRef: 'test:interaction-regression',
      passed: false,
      observedAt: '2026-06-05T12:15:00.000Z',
      summary: 'Keyboard focus moved behind the menu.',
    })
    expect(registry.contracts['primitive:menu-item']).toMatchObject({
      validationState: 'violated',
      staleReasons: expect.arrayContaining(['Keyboard focus moved behind the menu.']),
    })

    registry = applyContractOwnerCorrection(registry, {
      action: 'invalidate',
      contractId: 'primitive:menu-item',
      reason: 'MenuItem contract changed after link-rendering review.',
      updatedAt: '2026-06-05T12:20:00.000Z',
    })
    expect(registry.contracts['primitive:menu-item']?.validationState).toBe('invalidated')
    expect(deriveContractQueuePressure(registry, ['primitive:menu-item'])).toEqual([{
      contractId: 'primitive:menu-item',
      label: 'MenuItem primitive',
      pressure: 'needs_proof',
      reason: 'Contract is invalidated and needs fresh proof or owner review.',
    }])
  })

  it('renames, rejects, and merges contracts through owner corrections', () => {
    let registry = ContractRegistry.empty('2026-06-05T12:00:00.000Z')
    registry = applyContractIntake(registry, {
      source: 'spec-intake',
      contracts: [
        baseContract,
        { ...baseContract, id: 'primitive:menuitem', label: 'Menu item duplicate' },
      ],
    })

    registry = applyContractOwnerCorrection(registry, {
      action: 'rename',
      contractId: 'primitive:menu-item',
      label: 'Menu item',
      updatedAt: '2026-06-05T12:30:00.000Z',
    })
    registry = applyContractOwnerCorrection(registry, {
      action: 'merge',
      contractId: 'primitive:menuitem',
      mergeIntoContractId: 'primitive:menu-item',
      reason: 'Duplicate primitive spelling.',
      updatedAt: '2026-06-05T12:35:00.000Z',
    })
    registry = applyContractOwnerCorrection(registry, {
      action: 'reject',
      contractId: 'primitive:menuitem',
      reason: 'Merged into primitive:menu-item.',
      updatedAt: '2026-06-05T12:40:00.000Z',
    })

    expect(registry.contracts['primitive:menu-item']?.label).toBe('Menu item')
    expect(registry.contracts['primitive:menu-item']?.aliases).toContain('primitive:menuitem')
    expect(registry.rejectedContracts['primitive:menuitem']).toMatchObject({
      reason: 'Merged into primitive:menu-item.',
    })
  })
})

describe('migration definition quality checks', () => {
  it('keeps built-in migration definitions reviewable and owner-facing', () => {
    expect(validateBuiltInProjectMigrationDefinitions()).toEqual({
      valid: true,
      errors: [],
    })
  })
})
