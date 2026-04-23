import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskSource, WorkspaceSignal } from '../types.js'

const CANDIDATES = ['CLAUDE.md', 'AGENTS.md', 'CURSOR.md', '.cursorrules'] as const

/**
 * Extracts `context` signals from agent-convention docs. These files usually
 * describe tech stack, test conventions, and invariants — not tasks. We emit
 * a single `context` signal per file, capped at a short excerpt so the
 * importer has enough framing without dragging the whole doc into prompts.
 */
export const agentsMdSource: TaskSource = {
  id: 'agents-md',
  label: 'CLAUDE.md / AGENTS.md',

  async detect({ projectPath }) {
    const signals: WorkspaceSignal[] = []
    for (const name of CANDIDATES) {
      const p = join(projectPath, name)
      if (!existsSync(p)) continue
      const raw = readFileSync(p, 'utf-8').trim()
      if (!raw) continue
      signals.push({
        source: 'agents-md',
        kind: 'context',
        title: `Agent conventions (${name})`,
        evidence: raw.slice(0, 480),
        references: [p],
        confidence: 'high',
      })
    }
    return signals
  },
}
