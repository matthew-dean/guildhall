import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { DesignSystem, DESIGN_SYSTEM_FILE } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Design-system storage
//
// memory/design-system.yaml is the single source of truth. YAML so humans
// can hand-edit it without fighting JSON quoting; the schema is validated on
// load so bad edits surface at runtime instead of silently drifting into
// agent prompts.
//
// Writes are atomic (`.tmp` → rename) to match the goal-book and task-queue
// stores; a crash mid-write leaves the old or new file, never a truncated
// one.
// ---------------------------------------------------------------------------

export function designSystemPath(memoryDir: string): string {
  return path.join(memoryDir, DESIGN_SYSTEM_FILE)
}

/**
 * Load the design system from disk. Returns `undefined` when the file is
 * missing — a fresh project has no design system yet, and downstream callers
 * should treat that as "nothing approved, nothing to render."
 */
export async function loadDesignSystem(
  memoryDir: string,
): Promise<DesignSystem | undefined> {
  const p = designSystemPath(memoryDir)
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = yaml.load(raw)
    return DesignSystem.parse(parsed ?? {})
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

export async function saveDesignSystem(
  memoryDir: string,
  ds: DesignSystem,
): Promise<void> {
  const p = designSystemPath(memoryDir)
  const tmp = `${p}.tmp`
  const validated = DesignSystem.parse(ds)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(tmp, yaml.dump(validated, { noRefs: true, lineWidth: 100 }), 'utf-8')
  await fs.rename(tmp, p)
}
