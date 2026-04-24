import type { GuildSignals } from '../types.js'

const API_KEYWORDS =
  /\b(api|endpoint|route|handler|controller|rest|graphql|trpc|grpc|openapi|swagger|schema|request|response|webhook|http)\b/i

export function applicable(signals: GuildSignals): boolean {
  return API_KEYWORDS.test(`${signals.task.title} ${signals.task.description}`)
}
