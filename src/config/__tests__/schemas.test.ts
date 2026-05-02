import { describe, it, expect } from 'vitest'
import {
  WorkspaceYamlConfig,
  GlobalConfig,
  WorkspaceRegistry,
  WorkspaceRegistryEntry,
  slugify,
  mergeModels,
  resolveModelsForProvider,
  writeModelsForProvider,
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

describe('resolveModelsForProvider', () => {
  it('expands all/smart/workhorse provider shortcuts', () => {
    const result = resolveModelsForProvider({
      'openai-api': {
        smart: 'big-brain',
        workhorse: 'steady-hand',
      },
    }, 'openai-api')
    expect(result).toEqual({
      spec: 'big-brain',
      coordinator: 'big-brain',
      worker: 'steady-hand',
      reviewer: 'steady-hand',
      gateChecker: 'steady-hand',
    })
  })

  it('lets explicit roles override all', () => {
    const result = resolveModelsForProvider({
      'openai-api': {
        all: 'baseline',
        reviewer: 'strict-eye',
      },
    }, 'openai-api')
    expect(result.reviewer).toBe('strict-eye')
    expect(result.worker).toBe('baseline')
  })

  it('falls back to the only provider-scoped entry when no preferred provider is set', () => {
    const result = resolveModelsForProvider({
      'openai-api': {
        all: 'only-model',
      },
    })
    expect(result.worker).toBe('only-model')
  })
})

describe('writeModelsForProvider', () => {
  it('writes explicit role assignments under the selected provider', () => {
    const result = writeModelsForProvider(undefined, 'openai-api', {
      spec: 'qwen/qwen3.5-122b-a10b',
      coordinator: 'qwen/qwen3.5-122b-a10b',
      worker: 'qwen/qwen3.5-122b-a10b',
      reviewer: 'qwen/qwen3.5-122b-a10b',
      gateChecker: 'qwen/qwen3.5-122b-a10b',
    })
    expect(result).toEqual({
      'openai-api': {
        spec: 'qwen/qwen3.5-122b-a10b',
        coordinator: 'qwen/qwen3.5-122b-a10b',
        worker: 'qwen/qwen3.5-122b-a10b',
        reviewer: 'qwen/qwen3.5-122b-a10b',
        gateChecker: 'qwen/qwen3.5-122b-a10b',
      },
    })
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

  it('defaults bootstrap to undefined (opt-in)', () => {
    const config = WorkspaceYamlConfig.parse({ name: 'Test' })
    expect(config.bootstrap).toBeUndefined()
  })

  it('parses a bootstrap block with commands and successGates', () => {
    const config = WorkspaceYamlConfig.parse({
      name: 'Test',
      bootstrap: {
        commands: ['pnpm install'],
        successGates: ['pnpm typecheck'],
        timeoutMs: 300_000,
      },
    })
    expect(config.bootstrap?.commands).toEqual(['pnpm install'])
    expect(config.bootstrap?.successGates).toEqual(['pnpm typecheck'])
    expect(config.bootstrap?.timeoutMs).toBe(300_000)
  })

  it('parses bootstrap.provenance with tried attempts', () => {
    const config = WorkspaceYamlConfig.parse({
      name: 'Test',
      bootstrap: {
        commands: ['pnpm install'],
        successGates: ['pnpm typecheck'],
        provenance: {
          establishedBy: 'meta-intake-agent',
          establishedAt: '2026-04-23T00:00:00.000Z',
          tried: [
            { command: 'pnpm install', result: 'pass' },
            { command: 'pnpm typecheck', result: 'pass' },
          ],
        },
      },
    })
    expect(config.bootstrap?.provenance?.establishedBy).toBe('meta-intake-agent')
    expect(config.bootstrap?.provenance?.tried).toHaveLength(2)
    expect(config.bootstrap?.provenance?.tried[0]?.result).toBe('pass')
  })

  it('applies bootstrap default timeoutMs when commands provided', () => {
    const config = WorkspaceYamlConfig.parse({
      name: 'Test',
      bootstrap: { commands: ['pnpm install'], successGates: [] },
    })
    expect(config.bootstrap?.timeoutMs).toBe(300_000)
  })

  it('rejects bootstrap with negative timeout', () => {
    expect(() =>
      WorkspaceYamlConfig.parse({
        name: 'Test',
        bootstrap: { commands: ['pnpm install'], successGates: [], timeoutMs: -1 },
      }),
    ).toThrow()
  })

  it('parses an mcp.servers block with stdio + http transports', () => {
    const config = WorkspaceYamlConfig.parse({
      name: 'Test',
      mcp: {
        servers: {
          filesystem: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-fs'] },
          jira: { type: 'http', url: 'https://mcp.example/v1', headers: { 'X-Auth': 'token' } },
        },
      },
    })
    expect(Object.keys(config.mcp?.servers ?? {})).toEqual(['filesystem', 'jira'])
    expect(config.mcp?.servers.filesystem).toMatchObject({ type: 'stdio', command: 'npx' })
    expect(config.mcp?.servers.jira).toMatchObject({ type: 'http', url: 'https://mcp.example/v1' })
  })
})

// ---------------------------------------------------------------------------
// GlobalConfig
// ---------------------------------------------------------------------------
describe('GlobalConfig', () => {
  it('disables paid-provider fallback by default', () => {
    const config = GlobalConfig.parse({})
    expect(config.allowPaidProviderFallback).toBe(false)
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
    expect(config.servePort).toBe(7777)
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
