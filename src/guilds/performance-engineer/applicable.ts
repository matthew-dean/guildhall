import type { GuildSignals } from '../types.js'

const PERF_KEYWORDS =
  /\b(perf|performance|bundle|lazy|cache|memoize|rerender|render|optimization|speed|latency|slow|fast|fps|core web vitals|lcp|inp|cls|index|query|n\+1)\b/i

export function applicable(signals: GuildSignals): boolean {
  // Any task that touches product surface is performance-adjacent (you're
  // shipping code the user will run). Keep the predicate permissive — the
  // reviewer can mark items n-a if truly irrelevant.
  if (signals.task.productBrief) return true
  return PERF_KEYWORDS.test(
    `${signals.task.title} ${signals.task.description}`,
  )
}
