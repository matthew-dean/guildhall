/**
 * Ported from openharness/src/openharness/hooks/loader.py:HookRegistry
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `defaultdict(list)` → `Map<HookEvent, HookDefinition[]>` with lazy init
 *   - `summary()` produces the same shape (colon-separated lines) for parity
 *     with upstream's settings inspector
 *   - `load_hook_registry(settings, plugins)` is deferred: the concrete
 *     settings/plugins loaders live in @guildhall/config + plugin ports that
 *     aren't on the port path yet. Host code can call `registry.register`
 *     directly in the meantime.
 */

import { HookEvent } from '@guildhall/engine'

import type { HookDefinition } from './schemas.js'

export class HookRegistry {
  private readonly hooks = new Map<HookEvent, HookDefinition[]>()

  register(event: HookEvent, hook: HookDefinition): void {
    const existing = this.hooks.get(event)
    if (existing) existing.push(hook)
    else this.hooks.set(event, [hook])
  }

  get(event: HookEvent): HookDefinition[] {
    return [...(this.hooks.get(event) ?? [])]
  }

  summary(): string {
    const lines: string[] = []
    for (const event of Object.values(HookEvent)) {
      const hooks = this.get(event)
      if (hooks.length === 0) continue
      lines.push(`${event}:`)
      for (const hook of hooks) {
        const matcher = hook.matcher ? ` matcher=${hook.matcher}` : ''
        const detail =
          hook.type === 'command'
            ? hook.command
            : hook.type === 'http'
              ? hook.url
              : hook.prompt
        lines.push(`  - ${hook.type}${matcher}: ${detail}`)
      }
    }
    return lines.join('\n')
  }
}
