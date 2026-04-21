/**
 * Ported from openharness/src/openharness/skills/types.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `@dataclass(frozen=True)` → TS `interface` (frozen semantics
 *     enforced by `Readonly` via TS; we don't deep-freeze at runtime because
 *     skills are treated as opaque content blobs throughout the codebase)
 *   - Optional `path: str | None = None` → `path?: string`
 */

export interface SkillDefinition {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly source: string
  readonly path?: string
}
