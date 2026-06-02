import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { OPERATING_PROFILES } from '../profiles.js'
import {
  DOMAIN_LEVER_NAMES,
  PROJECT_LEVER_NAMES,
  domainLeversSchema,
  projectLeversSchema,
} from '../schema.js'

function positionSchemaFor(name: string): z.ZodTypeAny | null {
  const projectShape = projectLeversSchema.shape as Record<string, z.ZodObject<{ position: z.ZodTypeAny }>>
  const domainShape = domainLeversSchema.shape as Record<string, z.ZodObject<{ position: z.ZodTypeAny }>>
  return projectShape[name]?.shape.position ?? domainShape[name]?.shape.position ?? null
}

describe('operating profiles', () => {
  it('only reference known levers with valid positions', () => {
    const knownNames = new Set<string>([...PROJECT_LEVER_NAMES, ...DOMAIN_LEVER_NAMES])

    for (const profile of OPERATING_PROFILES) {
      expect(profile.label.length, `${profile.id} label`).toBeGreaterThan(0)
      expect(profile.summary.length, `${profile.id} summary`).toBeGreaterThan(0)

      for (const [name, position] of Object.entries(profile.leverPositions)) {
        expect(knownNames.has(name), `${profile.id}.${name} is a known lever`).toBe(true)
        const schema = positionSchemaFor(name)
        expect(schema, `${profile.id}.${name} has a position schema`).not.toBeNull()
        expect(schema!.safeParse(position).success, `${profile.id}.${name}=${position} is valid`).toBe(true)
      }
    }
  })
})
