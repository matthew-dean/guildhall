import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { TaskSource, WorkspaceSignal, TaskSourceContext } from '../types.js'

type Exec = NonNullable<TaskSourceContext['exec']>

const DEFAULT_LIMIT = 40

const MILESTONE_KEYWORDS = /\b(release|ship|launch|v\d+\.\d+|milestone|cutover)\b/i
const FIX_KEYWORDS = /^(fix|bug|hotfix|patch)\b/i

interface GitLogRoot {
  path: string
  domainHint?: string
}

function gitLogRoots(projectPath: string): GitLogRoot[] {
  if (existsSync(join(projectPath, '.git'))) return [{ path: projectPath }]
  let entries
  try {
    entries = readdirSync(projectPath, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && !['.git', 'node_modules', 'dist', 'build', 'coverage'].includes(entry.name))
    .map((entry) => ({ path: join(projectPath, entry.name), domainHint: basename(entry.name).toLowerCase() }))
    .filter((entry) => existsSync(join(entry.path, '.git')))
    .sort((left, right) => (left.domainHint ?? '').localeCompare(right.domainHint ?? ''))
}

/**
 * Reads recent git history and emits `milestone` signals for commits that
 * look like completed work. Heuristics:
 *
 * - subjects matching MILESTONE_KEYWORDS → high-confidence milestones
 * - `feat:` / `feature:` conventional-commit prefixes → medium milestones
 * - merge commits (`Merge pull request ...`) → medium milestones
 *
 * We deliberately ignore `fix:` and `chore:` — they are not milestones.
 * Caller can cap via `limit` (default 40).
 */
export function makeGitLogSource(opts: { limit?: number } = {}): TaskSource {
  const limit = opts.limit ?? DEFAULT_LIMIT
  return {
    id: 'git-log',
    label: 'Git history',

    async detect({ projectPath, exec }) {
      const roots = gitLogRoots(projectPath)
      if (roots.length === 0) return []
      const run: Exec = exec ?? (await import('./exec-default.js')).execDefault

      const signals: WorkspaceSignal[] = []
      for (const root of roots) {
        let result
        try {
          result = await run(
            'git',
            [
              'log',
              `-n`,
              String(limit),
              '--pretty=format:%H\x1f%s\x1f%an\x1f%ad',
              '--date=iso-strict',
            ],
            { cwd: root.path, timeoutMs: 10_000 },
          )
        } catch {
          continue
        }
        if (result.code !== 0) continue

        for (const line of result.stdout.split('\n')) {
          if (!line.trim()) continue
          const [sha, subject, author, date] = line.split('\x1f')
          if (!sha || !subject) continue
          if (FIX_KEYWORDS.test(subject)) continue

          let confidence: WorkspaceSignal['confidence'] | undefined
          if (MILESTONE_KEYWORDS.test(subject)) confidence = 'high'
          else if (/^(feat|feature)\b/i.test(subject)) confidence = 'medium'
          else if (/^Merge pull request/.test(subject)) confidence = 'medium'
          if (!confidence) continue

          signals.push({
            signalId: root.domainHint ? `${root.domainHint}:${sha}` : sha,
            source: 'git-log',
            kind: 'milestone',
            title: subject,
            evidence: `${root.domainHint ? `${root.domainHint}: ` : ''}${sha.slice(0, 8)} ${subject}${author ? ` (${author}${date ? `, ${date}` : ''})` : ''}`.slice(
              0,
              240,
            ),
            references: [root.domainHint ? `${root.domainHint}:${sha}` : sha],
            ...(root.domainHint ? { domainHint: root.domainHint } : {}),
            confidence,
          })
        }
      }
      return signals
    },
  }
}

export const gitLogSource: TaskSource = makeGitLogSource()
