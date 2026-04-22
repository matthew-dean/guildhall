import { describe, it, expect } from 'vitest'
import type { ProjectLevers } from '@guildhall/levers'
import {
  SlotAllocator,
  resolvePortBase,
  resolveEnvPrefix,
  buildSlotEnv,
  slotSystemPromptRule,
  isSlotAllocationEnabled,
  slotCapacityFromLever,
  resolveSlotShape,
  DEFAULT_PORT_BASE,
  DEFAULT_PORT_STRIDE,
  DEFAULT_ENV_PREFIX_TEMPLATE,
} from '../slot-allocator.js'

function makeLevers(
  runtime: 'none' | 'slot_allocation',
  dispatch: { kind: 'serial' } | { kind: 'fanout'; n: number },
): Pick<ProjectLevers, 'runtime_isolation' | 'concurrent_task_dispatch'> {
  const common = {
    rationale: 'test',
    setAt: '2026-04-20T00:00:00.000Z',
    setBy: 'system-default' as const,
  }
  return {
    runtime_isolation: { position: runtime, ...common },
    concurrent_task_dispatch: { position: dispatch, ...common },
  }
}

describe('resolvePortBase / resolveEnvPrefix (pure)', () => {
  it('uses built-in defaults when config is empty', () => {
    expect(resolvePortBase(0)).toBe(DEFAULT_PORT_BASE)
    expect(resolvePortBase(2)).toBe(DEFAULT_PORT_BASE + 2 * DEFAULT_PORT_STRIDE)
    expect(resolveEnvPrefix(0)).toBe('GUILDHALL_W0_')
    expect(resolveEnvPrefix(3)).toBe('GUILDHALL_W3_')
  })

  it('honors custom portBase + portStride', () => {
    expect(resolvePortBase(0, { portBase: 4000, portStride: 10 })).toBe(4000)
    expect(resolvePortBase(4, { portBase: 4000, portStride: 10 })).toBe(4040)
  })

  it('honors custom envVarPrefixTemplate', () => {
    expect(
      resolveEnvPrefix(2, { envVarPrefixTemplate: 'MYPROJ_{slot}__' }),
    ).toBe('MYPROJ_2__')
  })

  it('works when template has no {slot} placeholder', () => {
    expect(resolveEnvPrefix(5, { envVarPrefixTemplate: 'FIXED_' })).toBe('FIXED_')
  })

  it('replaces multiple {slot} occurrences', () => {
    expect(
      resolveEnvPrefix(7, { envVarPrefixTemplate: 'S{slot}_S{slot}_' }),
    ).toBe('S7_S7_')
  })
})

describe('SlotAllocator', () => {
  it('rejects non-positive capacity at construction', () => {
    expect(() => new SlotAllocator(0)).toThrow(/positive integer/i)
    expect(() => new SlotAllocator(-1)).toThrow()
    expect(() => new SlotAllocator(1.5)).toThrow()
  })

  it('allocates slots starting at index 0', () => {
    const a = new SlotAllocator(3)
    const s0 = a.allocate('t1')
    const s1 = a.allocate('t2')
    expect(s0?.index).toBe(0)
    expect(s1?.index).toBe(1)
    expect(s0?.portBase).toBe(DEFAULT_PORT_BASE)
    expect(s1?.portBase).toBe(DEFAULT_PORT_BASE + DEFAULT_PORT_STRIDE)
    expect(s0?.envVarPrefix).toBe('GUILDHALL_W0_')
    expect(s1?.envVarPrefix).toBe('GUILDHALL_W1_')
  })

  it('returns null when at capacity', () => {
    const a = new SlotAllocator(2)
    expect(a.allocate('t1')).not.toBeNull()
    expect(a.allocate('t2')).not.toBeNull()
    expect(a.allocate('t3')).toBeNull()
  })

  it('releases a slot and reuses its index', () => {
    const a = new SlotAllocator(2)
    const s0 = a.allocate('t1')!
    a.allocate('t2')
    a.release('t1')
    expect(a.inUse).toBe(1)
    const reused = a.allocate('t3')!
    expect(reused.index).toBe(s0.index)
  })

  it('is idempotent — re-allocating the same taskId returns the existing slot', () => {
    const a = new SlotAllocator(3)
    const first = a.allocate('t1')!
    const second = a.allocate('t1')!
    expect(second).toBe(first)
    expect(a.inUse).toBe(1)
  })

  it('release is no-op for unknown taskId', () => {
    const a = new SlotAllocator(2)
    expect(() => a.release('unknown')).not.toThrow()
    expect(a.inUse).toBe(0)
  })

  it('allocates the lowest free slot after a release gap', () => {
    const a = new SlotAllocator(4)
    a.allocate('t1') // 0
    a.allocate('t2') // 1
    a.allocate('t3') // 2
    a.release('t2') // frees 1
    const s = a.allocate('t4')!
    expect(s.index).toBe(1)
  })

  it('slotsInUse reflects current allocations', () => {
    const a = new SlotAllocator(3)
    a.allocate('t1')
    a.allocate('t2')
    expect(a.slotsInUse()).toEqual(new Set([0, 1]))
    a.release('t1')
    expect(a.slotsInUse()).toEqual(new Set([1]))
  })

  it('getByTask returns the slot held by a task', () => {
    const a = new SlotAllocator(2)
    a.allocate('t1')
    const got = a.getByTask('t1')
    expect(got?.index).toBe(0)
    expect(a.getByTask('never')).toBeUndefined()
  })

  it('honors custom config on allocated slots', () => {
    const a = new SlotAllocator(3, {
      portBase: 5000,
      portStride: 50,
      envVarPrefixTemplate: 'FOO_{slot}_',
    })
    const s1 = a.allocate('t1')!
    const s2 = a.allocate('t2')!
    expect(s1.portBase).toBe(5000)
    expect(s2.portBase).toBe(5050)
    expect(s1.envVarPrefix).toBe('FOO_0_')
    expect(s2.envVarPrefix).toBe('FOO_1_')
  })
})

describe('buildSlotEnv', () => {
  it('includes the three canonical GUILDHALL_* vars', () => {
    const a = new SlotAllocator(1)
    const slot = a.allocate('t1')!
    const env = buildSlotEnv(slot)
    expect(env.GUILDHALL_SLOT).toBe('0')
    expect(env.GUILDHALL_PORT_BASE).toBe(String(DEFAULT_PORT_BASE))
    expect(env.GUILDHALL_ENV_PREFIX).toBe('GUILDHALL_W0_')
  })

  it('merges sharedEnv passthrough', () => {
    const a = new SlotAllocator(1)
    const slot = a.allocate('t1')!
    const env = buildSlotEnv(slot, { sharedEnv: { DATABASE_URL: 'postgres://x', FOO: 'bar' } })
    expect(env.DATABASE_URL).toBe('postgres://x')
    expect(env.FOO).toBe('bar')
    // Canonical vars still present and take precedence over any same-named shared var
    expect(env.GUILDHALL_SLOT).toBe('0')
  })

  it('canonical vars override shared-env with colliding names', () => {
    const a = new SlotAllocator(1)
    const slot = a.allocate('t1')!
    const env = buildSlotEnv(slot, {
      sharedEnv: { GUILDHALL_SLOT: 'hacked', OTHER: 'keep' },
    })
    expect(env.GUILDHALL_SLOT).toBe('0')
    expect(env.OTHER).toBe('keep')
  })

  it('values are all strings (env-var contract)', () => {
    const a = new SlotAllocator(1)
    const slot = a.allocate('t1')!
    const env = buildSlotEnv(slot)
    for (const v of Object.values(env)) {
      expect(typeof v).toBe('string')
    }
  })
})

describe('slotSystemPromptRule', () => {
  it('names the slot, port base, and env prefix', () => {
    const a = new SlotAllocator(2)
    const slot = a.allocate('t1')!
    const rule = slotSystemPromptRule(slot)
    expect(rule).toContain('slot is **0**')
    expect(rule).toContain(`Port base is **${DEFAULT_PORT_BASE}**`)
    expect(rule).toContain('GUILDHALL_W0_')
    expect(rule).toContain('GUILDHALL_SLOT')
    expect(rule).toContain('GUILDHALL_PORT_BASE')
    expect(rule).toContain('GUILDHALL_ENV_PREFIX')
  })

  it('reflects custom config in prompt text', () => {
    const a = new SlotAllocator(3, {
      portBase: 9000,
      portStride: 10,
      envVarPrefixTemplate: 'X{slot}_',
    })
    a.allocate('t0')
    const slot = a.allocate('t1')!
    const rule = slotSystemPromptRule(slot)
    expect(rule).toContain('slot is **1**')
    expect(rule).toContain('Port base is **9010**')
    expect(rule).toContain('X1_')
  })
})

describe('lever resolution helpers', () => {
  it('isSlotAllocationEnabled mirrors the runtime_isolation lever', () => {
    expect(isSlotAllocationEnabled(makeLevers('none', { kind: 'serial' }))).toBe(false)
    expect(
      isSlotAllocationEnabled(makeLevers('slot_allocation', { kind: 'serial' })),
    ).toBe(true)
  })

  it('slotCapacityFromLever: serial → 1, fanout_N → N', () => {
    expect(slotCapacityFromLever(makeLevers('none', { kind: 'serial' }))).toBe(1)
    expect(
      slotCapacityFromLever(makeLevers('none', { kind: 'fanout', n: 4 })),
    ).toBe(4)
  })

  it('resolveSlotShape combines both levers', () => {
    expect(
      resolveSlotShape(makeLevers('slot_allocation', { kind: 'fanout', n: 3 })),
    ).toEqual({ enabled: true, capacity: 3 })
    expect(
      resolveSlotShape(makeLevers('none', { kind: 'fanout', n: 3 })),
    ).toEqual({ enabled: false, capacity: 3 })
    expect(
      resolveSlotShape(makeLevers('slot_allocation', { kind: 'serial' })),
    ).toEqual({ enabled: true, capacity: 1 })
  })
})

describe('defaults export sanity', () => {
  it('DEFAULT_ENV_PREFIX_TEMPLATE references {slot}', () => {
    expect(DEFAULT_ENV_PREFIX_TEMPLATE).toContain('{slot}')
  })
})
