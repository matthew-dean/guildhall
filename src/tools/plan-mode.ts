/**
 * Enter / exit plan-mode tools.
 *
 * Ported from
 *   openharness/src/openharness/tools/enter_plan_mode_tool.py
 *   openharness/src/openharness/tools/exit_plan_mode_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Upstream writes the new mode to a global settings file (`load_settings`
 *     → mutate → `save_settings`). Guildhall owns permission state on the
 *     QueryEngine itself, so the tool instead calls the `set_permission_mode`
 *     callback that the engine threads into `toolMetadata` at construction.
 *   - If the callback is absent (e.g. a test harness that built tools without
 *     a QueryEngine), the tool falls back to writing `permission_mode` into
 *     metadata alone — the tool-carryover recorder was already doing that
 *     for bookkeeping, so the bookkeeping stays consistent.
 *   - Names are `enter_plan_mode` / `exit_plan_mode` (snake case) to match
 *     the tool-carryover dispatcher in engine/tool-carryover.ts.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'

const noInputSchema = z.object({}).describe('No input required')

type SetPermissionMode = (mode: 'plan' | 'default' | 'full_auto') => void

function applyMode(
  ctx: { metadata: Record<string, unknown> },
  mode: 'plan' | 'default' | 'full_auto',
): boolean {
  const callback = ctx.metadata['set_permission_mode'] as SetPermissionMode | undefined
  ctx.metadata['permission_mode'] = mode
  if (typeof callback === 'function') {
    callback(mode)
    return true
  }
  return false
}

export const enterPlanModeTool = defineTool({
  name: 'enter_plan_mode',
  description:
    'Switch the agent into plan mode. Mutating tools will be blocked until exit_plan_mode is called.',
  inputSchema: noInputSchema,
  jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  isReadOnly: () => false,
  execute: async (_input, ctx) => {
    const applied = applyMode(ctx, 'plan')
    return {
      output: applied
        ? 'Permission mode set to plan. Mutating tools are blocked until exit_plan_mode is called.'
        : 'Recorded plan mode in metadata; engine checker was not swapped (no callback threaded).',
      is_error: false,
    }
  },
})

export const exitPlanModeTool = defineTool({
  name: 'exit_plan_mode',
  description: 'Leave plan mode and restore the default permission checker.',
  inputSchema: noInputSchema,
  jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  isReadOnly: () => false,
  execute: async (_input, ctx) => {
    const applied = applyMode(ctx, 'default')
    return {
      output: applied
        ? 'Permission mode restored to default.'
        : 'Recorded default mode in metadata; engine checker was not swapped (no callback threaded).',
      is_error: false,
    }
  },
})
