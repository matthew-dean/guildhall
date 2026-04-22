/**
 * Ported from openharness/src/openharness/api/usage.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic BaseModel → Zod schema
 *   - total_tokens computed property → helper function
 */

import { z } from 'zod'

export const usageSnapshotSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
})

export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>

export function totalTokens(usage: UsageSnapshot): number {
  return usage.input_tokens + usage.output_tokens
}

export const emptyUsage: UsageSnapshot = { input_tokens: 0, output_tokens: 0 }
