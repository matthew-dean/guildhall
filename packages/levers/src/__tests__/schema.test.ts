import { describe, it, expect } from 'vitest'
import * as v from 'valibot'

import {
  concurrentDispatchPositionSchema,
  rejectionDampeningPositionSchema,
  leverSettingsSchema,
  PROJECT_LEVER_NAMES,
  DOMAIN_LEVER_NAMES,
} from '../schema.js'
import { makeDefaultSettings } from '../defaults.js'

describe('concurrentDispatchPositionSchema', () => {
  it('accepts {kind: serial}', () => {
    expect(v.safeParse(concurrentDispatchPositionSchema, { kind: 'serial' }).success).toBe(true)
  })

  it('accepts fanout with n>=2', () => {
    expect(
      v.safeParse(concurrentDispatchPositionSchema, { kind: 'fanout', n: 3 }).success,
    ).toBe(true)
  })

  it('rejects fanout with n=1 (use serial instead)', () => {
    expect(
      v.safeParse(concurrentDispatchPositionSchema, { kind: 'fanout', n: 1 }).success,
    ).toBe(false)
  })

  it('rejects non-integer n', () => {
    expect(
      v.safeParse(concurrentDispatchPositionSchema, { kind: 'fanout', n: 2.5 }).success,
    ).toBe(false)
  })
})

describe('rejectionDampeningPositionSchema', () => {
  it('accepts off', () => {
    expect(v.safeParse(rejectionDampeningPositionSchema, { kind: 'off' }).success).toBe(true)
  })

  it('accepts soft_penalty with after>=1', () => {
    expect(
      v.safeParse(rejectionDampeningPositionSchema, { kind: 'soft_penalty', after: 2 }).success,
    ).toBe(true)
  })

  it('accepts hard_suppress with after>=1', () => {
    expect(
      v.safeParse(rejectionDampeningPositionSchema, { kind: 'hard_suppress', after: 1 }).success,
    ).toBe(true)
  })

  it('rejects after=0', () => {
    expect(
      v.safeParse(rejectionDampeningPositionSchema, { kind: 'soft_penalty', after: 0 }).success,
    ).toBe(false)
  })
})

describe('default LeverSettings', () => {
  it('validates against the schema', () => {
    const settings = makeDefaultSettings()
    const result = v.safeParse(leverSettingsSchema, settings)
    if (!result.success) {
      // Surface issues in the error for easier debugging.
      throw new Error(JSON.stringify(result.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('has an entry for every project lever in PROJECT_LEVER_NAMES', () => {
    const settings = makeDefaultSettings()
    for (const name of PROJECT_LEVER_NAMES) {
      expect(settings.project[name]).toBeDefined()
      expect(settings.project[name].setBy).toBe('system-default')
      expect(settings.project[name].rationale.length).toBeGreaterThan(0)
    }
  })

  it('has an entry for every domain lever in the default domain', () => {
    const settings = makeDefaultSettings()
    for (const name of DOMAIN_LEVER_NAMES) {
      expect(settings.domains.default[name]).toBeDefined()
      expect(settings.domains.default[name].setBy).toBe('system-default')
      expect(settings.domains.default[name].rationale.length).toBeGreaterThan(0)
    }
  })

  it('tags every default entry with setBy=system-default for provenance', () => {
    // This is the anti-"hidden defaults" contract: every lever has an audit
    // trail on first creation, even before the Spec Agent refines them.
    const settings = makeDefaultSettings()
    const allEntries = [
      ...Object.values(settings.project),
      ...Object.values(settings.domains.default),
    ]
    for (const entry of allEntries) {
      expect(entry.setBy).toBe('system-default')
    }
  })

  it('uses an ISO timestamp for setAt', () => {
    const frozen = new Date('2026-04-20T17:30:00.000Z')
    const settings = makeDefaultSettings(frozen)
    expect(settings.project.agent_health_strictness.setAt).toBe('2026-04-20T17:30:00.000Z')
  })
})

describe('parameterized lever positions round-trip', () => {
  it('fanout position survives schema parse', () => {
    const settings = makeDefaultSettings()
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 4 },
      rationale: 'enable 4-way fanout',
      setAt: new Date().toISOString(),
      setBy: 'spec-agent-intake',
    }
    const result = v.safeParse(leverSettingsSchema, settings)
    expect(result.success).toBe(true)
  })

  it('soft_penalty dampening survives schema parse', () => {
    const settings = makeDefaultSettings()
    settings.project.rejection_dampening = {
      position: { kind: 'soft_penalty', after: 3 },
      rationale: 'apply soft penalty after 3 rejections of same shape',
      setAt: new Date().toISOString(),
      setBy: 'coordinator:design',
    }
    const result = v.safeParse(leverSettingsSchema, settings)
    expect(result.success).toBe(true)
  })

  it('accepts coordinator:<name> as a valid setter', () => {
    const settings = makeDefaultSettings()
    settings.project.merge_policy = {
      position: 'ff_only_with_push',
      rationale: 'team is ready for auto-push',
      setAt: new Date().toISOString(),
      setBy: 'coordinator:release',
    }
    const result = v.safeParse(leverSettingsSchema, settings)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown setter value', () => {
    const settings = makeDefaultSettings()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(settings.project.merge_policy as any).setBy = 'some-random-agent'
    const result = v.safeParse(leverSettingsSchema, settings)
    expect(result.success).toBe(false)
  })
})
