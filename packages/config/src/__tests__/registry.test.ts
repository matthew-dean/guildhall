import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// We need to mock the home directory so registry.ts reads/writes to a temp dir
// ---------------------------------------------------------------------------

const TMP_HOME = join(tmpdir(), `forge-test-${process.pid}`)
const TMP_FORGE = join(TMP_HOME, '.forge')

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => TMP_HOME }
})

// Import after mock is set up
const { readRegistry, registerWorkspace, findWorkspace, unregisterWorkspace, touchWorkspace, listWorkspaces, updateWorkspace } =
  await import('../registry.js')

describe('registry', () => {
  beforeEach(() => {
    mkdirSync(TMP_FORGE, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP_FORGE)) {
      rmSync(TMP_FORGE, { recursive: true, force: true })
    }
  })

  describe('readRegistry', () => {
    it('returns empty registry when file does not exist', () => {
      const registry = readRegistry()
      expect(registry.workspaces).toEqual([])
      expect(registry.version).toBe(1)
    })
  })

  describe('registerWorkspace', () => {
    it('registers a new workspace', () => {
      const entry = registerWorkspace({
        id: 'my-project',
        path: '/home/user/my-project',
        name: 'My Project',
        tags: [],
      })
      expect(entry.id).toBe('my-project')
      expect(entry.registeredAt).toBeTruthy()

      const registry = readRegistry()
      expect(registry.workspaces).toHaveLength(1)
    })

    it('throws on duplicate id', () => {
      registerWorkspace({ id: 'dup', path: '/path/one', name: 'One', tags: [] })
      expect(() =>
        registerWorkspace({ id: 'dup', path: '/path/two', name: 'Two', tags: [] })
      ).toThrow(/already registered/)
    })

    it('throws on duplicate path', () => {
      registerWorkspace({ id: 'one', path: '/same/path', name: 'One', tags: [] })
      expect(() =>
        registerWorkspace({ id: 'two', path: '/same/path', name: 'Two', tags: [] })
      ).toThrow(/already registered/)
    })
  })

  describe('listWorkspaces', () => {
    it('returns all registered workspaces', () => {
      registerWorkspace({ id: 'alpha', path: '/alpha', name: 'Alpha', tags: [] })
      registerWorkspace({ id: 'beta', path: '/beta', name: 'Beta', tags: [] })
      expect(listWorkspaces()).toHaveLength(2)
    })
  })

  describe('findWorkspace', () => {
    it('finds by id', () => {
      registerWorkspace({ id: 'find-me', path: '/find/me', name: 'Find Me', tags: [] })
      const found = findWorkspace('find-me')
      expect(found?.name).toBe('Find Me')
    })

    it('returns undefined for unknown id', () => {
      expect(findWorkspace('nope')).toBeUndefined()
    })
  })

  describe('updateWorkspace', () => {
    it('updates workspace fields', () => {
      registerWorkspace({ id: 'update-me', path: '/update/me', name: 'Old Name', tags: [] })
      const updated = updateWorkspace('update-me', { name: 'New Name', tags: ['fresh'] })
      expect(updated.name).toBe('New Name')
      expect(updated.tags).toContain('fresh')
    })

    it('throws for unknown id', () => {
      expect(() => updateWorkspace('ghost', { name: 'Ghost' })).toThrow(/not found/)
    })
  })

  describe('unregisterWorkspace', () => {
    it('removes by id', () => {
      registerWorkspace({ id: 'remove-me', path: '/remove/me', name: 'Remove Me', tags: [] })
      expect(unregisterWorkspace('remove-me')).toBe(true)
      expect(listWorkspaces()).toHaveLength(0)
    })

    it('returns false for unknown id', () => {
      expect(unregisterWorkspace('ghost')).toBe(false)
    })
  })

  describe('touchWorkspace', () => {
    it('sets lastSeenAt', () => {
      registerWorkspace({ id: 'touch-me', path: '/touch/me', name: 'Touch Me', tags: [] })
      touchWorkspace('touch-me')
      const entry = findWorkspace('touch-me')
      expect(entry?.lastSeenAt).toBeTruthy()
    })

    it('is a no-op for unknown id', () => {
      expect(() => touchWorkspace('ghost')).not.toThrow()
    })
  })
})
