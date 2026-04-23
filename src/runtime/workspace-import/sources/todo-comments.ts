import type { TaskSource, WorkspaceSignal } from '../types.js'

type Exec = NonNullable<import('../types.js').TaskSourceContext['exec']>

const DEFAULT_GLOBS = [
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
  '*.py',
  '*.go',
  '*.rs',
  '*.java',
  '*.kt',
  '*.rb',
  '*.swift',
  '*.c',
  '*.cc',
  '*.cpp',
  '*.h',
  '*.hpp',
] as const

const MAX_MATCHES = 200

/**
 * Greps the working tree for TODO / FIXME / HACK / XXX comments using
 * ripgrep, which respects `.gitignore` and is fast on large repos. Each
 * match becomes an `open_work` signal at `low` confidence — many TODO
 * comments are aspirational scribbles, not real tasks, so the
 * hypothesis-former decides which to promote.
 *
 * Falls back to `[]` silently if ripgrep isn't installed — TODO mining is a
 * nice-to-have, not a blocker.
 */
export const todoCommentsSource: TaskSource = {
  id: 'todo-comments',
  label: 'TODO / FIXME comments',

  async detect({ projectPath, exec }) {
    const run: Exec = exec ?? (await import('./exec-default.js')).execDefault
    const args = [
      '--line-number',
      '--no-heading',
      '--max-count',
      String(MAX_MATCHES),
      '--color',
      'never',
      '-e',
      String.raw`\b(TODO|FIXME|HACK|XXX)\b[:\s]`,
    ]
    for (const g of DEFAULT_GLOBS) {
      args.push('--glob', g)
    }
    let result
    try {
      result = await run('rg', args, { cwd: projectPath, timeoutMs: 15_000 })
    } catch {
      return []
    }
    if (result.code !== 0 && result.code !== 1) return []

    const signals: WorkspaceSignal[] = []
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      // Format: `path:line:content`
      const firstColon = line.indexOf(':')
      if (firstColon < 0) continue
      const secondColon = line.indexOf(':', firstColon + 1)
      if (secondColon < 0) continue
      const file = line.slice(0, firstColon)
      const lineNo = line.slice(firstColon + 1, secondColon)
      const content = line.slice(secondColon + 1).trim()
      const clean = content.replace(/^(\/\/|#|\/\*|\*)\s?/, '').slice(0, 200)
      signals.push({
        source: 'todo-comments',
        kind: 'open_work',
        title: clean.slice(0, 120),
        evidence: clean,
        references: [`${file}:${lineNo}`],
        confidence: 'low',
      })
      if (signals.length >= MAX_MATCHES) break
    }
    return signals
  },
}
