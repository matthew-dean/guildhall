import { describe, it, expect } from 'vitest'
import {
  MODEL_CATALOG,
  ROLE_PROFILES,
  DEFAULT_LOCAL_MODEL_ASSIGNMENT,
  DEFAULT_HYBRID_MODEL_ASSIGNMENT,
  DEFAULT_CLOUD_MODEL_ASSIGNMENT,
  ModelCatalogEntry,
  ModelAssignmentConfig,
  recommendModelsForRole,
  findModel,
} from '../models.js'

describe('MODEL_CATALOG', () => {
  it('contains at least one model per provider type', () => {
    const providers = new Set(MODEL_CATALOG.map(m => m.provider))
    expect(providers).toContain('lm-studio')
    expect(providers).toContain('anthropic')
    expect(providers).toContain('openai')
  })

  it('all entries are valid ModelCatalogEntry shapes', () => {
    for (const entry of MODEL_CATALOG) {
      expect(() => ModelCatalogEntry.parse(entry)).not.toThrow()
    }
  })

  it('all ratings are within 0–3', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.reasoning).toBeGreaterThanOrEqual(0)
      expect(m.reasoning).toBeLessThanOrEqual(3)
      expect(m.codegen).toBeGreaterThanOrEqual(0)
      expect(m.codegen).toBeLessThanOrEqual(3)
      expect(m.speed).toBeGreaterThanOrEqual(0)
      expect(m.speed).toBeLessThanOrEqual(3)
    }
  })

  it('all entries have at least one recommendedRole', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.recommendedRoles.length).toBeGreaterThan(0)
    }
  })

  it('all entries have non-empty notes', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.notes.trim().length).toBeGreaterThan(0)
    }
  })

  it('all model ids are unique', () => {
    const ids = MODEL_CATALOG.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('ROLE_PROFILES', () => {
  const roles = ['spec', 'coordinator', 'worker', 'reviewer', 'gateChecker'] as const

  it('defines a profile for every agent role', () => {
    for (const role of roles) {
      expect(ROLE_PROFILES[role]).toBeDefined()
    }
  })

  it('spec and coordinator have maximum reasoning score', () => {
    expect(ROLE_PROFILES.spec.reasoning).toBe(3)
    expect(ROLE_PROFILES.coordinator.reasoning).toBe(3)
  })

  it('worker has maximum codegen score', () => {
    expect(ROLE_PROFILES.worker.codegen).toBe(3)
  })

  it('reviewer and gateChecker prefer speed', () => {
    expect(ROLE_PROFILES.reviewer.preferSpeed).toBe(true)
    expect(ROLE_PROFILES.gateChecker.preferSpeed).toBe(true)
  })

  it('spec and coordinator do not prefer speed', () => {
    expect(ROLE_PROFILES.spec.preferSpeed).toBe(false)
    expect(ROLE_PROFILES.coordinator.preferSpeed).toBe(false)
  })
})

describe('findModel', () => {
  it('returns the correct entry for a known id', () => {
    const result = findModel('qwen2.5-coder-32b-instruct')
    expect(result).toBeDefined()
    expect(result?.provider).toBe('lm-studio')
  })

  it('returns undefined for an unknown id', () => {
    expect(findModel('nonexistent-model-xyz')).toBeUndefined()
  })
})

describe('recommendModelsForRole', () => {
  it('returns models recommended for the worker role', () => {
    const results = recommendModelsForRole('worker')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(m => m.recommendedRoles.includes('worker'))).toBe(true)
  })

  it('returns models in descending suitability order for coordinator', () => {
    const results = recommendModelsForRole('coordinator')
    // First result should have high reasoning (coordinator needs reasoning: 3)
    expect(results[0]?.reasoning).toBeGreaterThanOrEqual(2)
  })

  it('returns at least one local and one cloud model for most roles', () => {
    for (const role of ['spec', 'coordinator', 'worker', 'reviewer'] as const) {
      const results = recommendModelsForRole(role)
      const hasLocal = results.some(m => m.provider === 'lm-studio')
      const hasCloud = results.some(m => m.provider === 'anthropic' || m.provider === 'openai')
      expect(hasLocal).toBe(true)
      expect(hasCloud).toBe(true)
    }
  })
})

describe('default model assignments', () => {
  it('DEFAULT_LOCAL_MODEL_ASSIGNMENT is a valid ModelAssignmentConfig', () => {
    expect(() => ModelAssignmentConfig.parse(DEFAULT_LOCAL_MODEL_ASSIGNMENT)).not.toThrow()
  })

  it('DEFAULT_HYBRID_MODEL_ASSIGNMENT is a valid ModelAssignmentConfig', () => {
    expect(() => ModelAssignmentConfig.parse(DEFAULT_HYBRID_MODEL_ASSIGNMENT)).not.toThrow()
  })

  it('DEFAULT_CLOUD_MODEL_ASSIGNMENT is a valid ModelAssignmentConfig', () => {
    expect(() => ModelAssignmentConfig.parse(DEFAULT_CLOUD_MODEL_ASSIGNMENT)).not.toThrow()
  })

  it('all local assignment models exist in catalog', () => {
    for (const id of Object.values(DEFAULT_LOCAL_MODEL_ASSIGNMENT)) {
      expect(findModel(id)).toBeDefined()
    }
  })

  it('local assignment uses only lm-studio models', () => {
    for (const id of Object.values(DEFAULT_LOCAL_MODEL_ASSIGNMENT)) {
      expect(findModel(id)?.provider).toBe('lm-studio')
    }
  })

  it('cloud assignment uses only cloud models', () => {
    for (const id of Object.values(DEFAULT_CLOUD_MODEL_ASSIGNMENT)) {
      const provider = findModel(id)?.provider
      expect(['anthropic', 'openai', 'google']).toContain(provider)
    }
  })
})
