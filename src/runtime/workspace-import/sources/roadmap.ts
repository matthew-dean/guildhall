import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskSource, WorkspaceSignal } from '../types.js'

const CANDIDATES = [
  'ROADMAP.md',
  'TODO.md',
  'docs/ROADMAP.md',
  'docs/TODO.md',
  'docs/roadmap.md',
  'docs/todo.md',
] as const

/**
 * Walks ROADMAP/TODO files and emits an `open_work` signal per unchecked
 * checklist item (`- [ ] …`) and per top-level bullet.
 *
 * Checked items (`- [x]`) become `milestone` signals so progress backfill can
 * credit them as already-done work.
 */
export const roadmapSource: TaskSource = {
  id: 'roadmap',
  label: 'ROADMAP / TODO',

  async detect({ projectPath }) {
    const signals: WorkspaceSignal[] = []
    const seen = new Set<string>()
    for (const rel of CANDIDATES) {
      const p = join(projectPath, rel)
      if (!existsSync(p)) continue
      const st = statSync(p)
      const key = `${st.dev}:${st.ino}`
      if (seen.has(key)) continue
      seen.add(key)
      const raw = readFileSync(p, 'utf-8')
      for (const line of raw.split('\n')) {
        const checked = /^\s*[-*]\s*\[[xX]\]\s+(.+?)\s*$/.exec(line)
        if (checked) {
          signals.push({
            source: 'roadmap',
            kind: 'milestone',
            title: checked[1]!.slice(0, 120),
            evidence: line.trim().slice(0, 240),
            references: [p],
            confidence: 'high',
          })
          continue
        }
        const unchecked = /^\s*[-*]\s*\[\s?\]\s+(.+?)\s*$/.exec(line)
        if (unchecked) {
          signals.push({
            source: 'roadmap',
            kind: 'open_work',
            title: unchecked[1]!.slice(0, 120),
            evidence: line.trim().slice(0, 240),
            references: [p],
            confidence: 'high',
          })
          continue
        }
        const plainTop = /^[-*]\s+(.+?)\s*$/.exec(line)
        if (plainTop) {
          signals.push({
            source: 'roadmap',
            kind: 'open_work',
            title: plainTop[1]!.slice(0, 120),
            evidence: line.trim().slice(0, 240),
            references: [p],
            confidence: 'medium',
          })
        }
      }
    }
    return signals
  },
}
