import { describe, it, expect } from 'vitest'
import {
  WorkspaceYamlConfig,
  GlobalConfig,
  WorkspaceRegistry,
  WorkspaceRegistryEntry,
  slugify,
  mergeModels,
} from '../schemas.js'
import { DEFAULT_LOCAL_MODEL_ASSIGNMENT } from '@guildhall/core'

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('My Project')).toBe('my-project')
  })

  it('removes leading/trailing dashes', () => {
    expect(slugify('  project  ')).toBe('project')
  })

  it('collapses multiple separators', () => {
    expect(slugify('Looma & Knit!')).toBe('looma-knit')
  })

  it('falls back to "workspace" for empty strings', () => {
    expect(slugify('')).toBe('workspace')
    expect(slugify('---')).toBe('workspace')
  })
})

// ---------------------------------------------------------------------------
// mergeModels
// ---------------------------------------------------------------------------
describe('mergeModels', () => {
  it('returns built-in defaults when no overrides provided', () => {
    const result = mergeModels({}, undefined)
    expect(result).toEqual(DEFAULT_LOCAL_MODEL_ASSIGNMENT)
  })

  it('workspace overrides take precedence over global', () => {
    const result = mergeModels(
      { spec: 'global-model' },
      { spec: 'workspace-model' }
    )
    expect(result.spec).toBe('workspace-model')
  })

  it('global overrides take precedence over defaults', () => {
    const result = mergeModels(
      { worker: 'global-worker' },
      undefined
    )
    expect(result.worker).toBe('global-worker')
  })

  it('partial workspace override only affects specified roles', () => {
    const result = mergeModels({}, { spec: 'qwen2.5-coder-32b-instruct' })
    // Other roles should still be defaults
    expect(result.coordinator).toBe(DEFAULT_LOCAL_MODEL_ASSIGNMENT.coordinator)
  })
})

// ---------------------------------------------------------------------------
// WorkspaceYamlConfig
// ---------------------------------------------------------------------------
describe('WorkspaceYamlConfig', () => {
  it('parses a minimal config', () => {
    const config = WorkspaceYamlConfig.parse({ name: 'Test' })
    expect(config.name).toBe('Test')
    expect(config.coordinators).toEqual([])
    expect(config.maxRevisions).toBe(3)
    expect(config.heartbeatInterval).toBe(5)
    expect(config.ignore).toContain('node_modules')
  })

  it('rejects empty name', () => {
    expect(() => WorkspaceYamlConfig.parse({ name: '' })).toThrow()
  })

  it('validates id format', () => {
    expect(() => WorkspaceYamlConfig.parse({ name: 'Test', id: 'INVALID ID' })).toThrow()
    expect(WorkspaceYamlConfig.parse({ name: 'Test', id: 'valid-id-123' }).id).toBe('valid-id-123')
  })

  it('parses coordinators', () => {
    const config = WorkspaceYamlConfig.parse({
      name: 'Test',
      coordinators: [{ id: 'looma', name: 'UI Lead', domain: 'looma', path: 'packages/ui' }],
    })
    expect(config.coordinators).toHaveLength(1)
    expect(config.coordinators[0]?.domain).toBe('looma')
    expect(config.coordinators[0]?.mandate).toBe('')
    expect(config.coordinators[0]?.concerns).toEqual([])
    expect(config.coordinators[0]?.autonomousDecisions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GlobalConfig
// ---------------------------------------------------------------------------
describe('GlobalConfig', () => {
  it('parses with all defaults', () => {
    const config = GlobalConfig.parse({})
    expect(config.maxRevisions).toBe(3)
    expect(config.heartbeatInterval).toBe(5)
    expect(config.lmStudioUrl).toBe('http://localhost:1234/v1')
    expect(config.servePort).toBe(7842)
  })

  it('validates servePort range', () => {
    expect(() => GlobalConfig.parse({ servePort: 80 })).toThrow()
    expect(GlobalConfig.parse({ servePort: 3000 }).servePort).toBe(3000)
  })

  it('validates lmStudioUrl is a URL', () => {
    expect(() => GlobalConfig.parse({ lmStudioUrl: 'not-a-url' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// WorkspaceRegistry
// ---------------------------------------------------------------------------
describe('WorkspaceRegistry', () => {
  it('defaults to empty workspaces array', () => {
    const registry = WorkspaceRegistry.parse({})
    expect(registry.workspaces).toEqual([])
    expect(registry.version).toBe(1)
  })

  it('parses valid entries', () => {
    const registry = WorkspaceRegistry.parse({
      version: 1,
      workspaces: [{
        id: 'my-project',
        path: '/home/user/project',
        name: 'My Project',
        registeredAt: new Date().toISOString(),
      }],
    })
    expect(registry.workspaces).toHaveLength(1)
    expect(registry.workspaces[0]?.id).toBe('my-project')
  })

  it('rejects invalid workspace id format', () => {
    expect(() => WorkspaceRegistryEntry.parse({
      id: 'UPPERCASE',
      path: '/some/path',
      name: 'Test',
      registeredAt: new Date().toISOString(),
    })).toThrow()
  })
})
