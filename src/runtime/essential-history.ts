import type { ApiMessageRequest, SupportsStreamingMessages } from '@guildhall/engine'
import { messageText } from '@guildhall/protocol'
import type { ExploringHistorySummaryInput } from '@guildhall/tools'

const MAX_SUMMARY_CHARS = 6_000
const MAX_INPUT_CHARS = 12_000

function bounded(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_INPUT_CHARS) return trimmed
  const head = Math.floor(MAX_INPUT_CHARS / 2)
  return `${trimmed.slice(0, head)}\n\n[older detail omitted]\n\n${trimmed.slice(- (MAX_INPUT_CHARS - head))}`
}

function summaryPrompt(input: ExploringHistorySummaryInput): string {
  return [
    'Update the compact essential history for a software-project intake conversation.',
    'Rewrite the prior record plus the new message into durable project memory.',
    'Keep only facts, decisions, constraints, scope boundaries, accepted intent, unresolved questions, and next actions that affect the plan.',
    'Remove greetings, repetition, agent narration, tool chatter, process commentary, and conversational filler.',
    'Do not invent or resolve anything. Preserve uncertainty explicitly when the evidence is incomplete.',
    'Use short headings and bullets. Return only the essential history, with no preamble and no transcript framing.',
    `Keep the result under ${MAX_SUMMARY_CHARS} characters.`,
    '',
    'Prior essential history:',
    bounded(input.priorHistory) || '(none)',
    '',
    `New ${input.role} message:`,
    bounded(input.content),
  ].join('\n')
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

/**
 * Uses the configured context-indexer lane as a cheap, precise memory writer.
 * The result is deliberately a string rather than a second persisted object:
 * the essential-history file is the only durable representation of intake
 * conversation state.
 */
export function buildEssentialHistorySummarizer(opts: {
  apiClient: SupportsStreamingMessages
  model: string
  timeoutMs?: number
}): (input: ExploringHistorySummaryInput) => Promise<string | null> {
  return async (input) => {
    const timeout = timeoutSignal(opts.timeoutMs ?? 15_000)
    const request: ApiMessageRequest = {
      model: opts.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: summaryPrompt(input) }] }],
      system_prompt:
        'You are Guildhall Essential History, a small deterministic project-memory writer. Preserve only durable planning truth.',
      max_tokens: 900,
      temperature: 0,
      tools: [],
      signal: timeout.signal,
    }
    try {
      for await (const event of opts.apiClient.streamMessage(request)) {
        if (event.type !== 'message_complete') continue
        const summary = messageText(event.message).trim()
        return summary ? summary.slice(0, MAX_SUMMARY_CHARS) : null
      }
      return null
    } catch {
      return null
    } finally {
      timeout.dispose()
    }
  }
}
