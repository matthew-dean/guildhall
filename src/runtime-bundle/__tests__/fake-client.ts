import type { ConversationMessage, UsageSnapshot } from '@guildhall/protocol'

import type {
  ApiMessageRequest,
  ApiStreamEvent,
  SupportsStreamingMessages,
} from '@guildhall/engine'

export interface ScriptedTurn {
  textDeltas?: string[]
  message: ConversationMessage
  usage?: UsageSnapshot
}

export class ScriptedApiClient implements SupportsStreamingMessages {
  private index = 0
  readonly requests: ApiMessageRequest[] = []

  constructor(private readonly script: ScriptedTurn[]) {}

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    this.requests.push(request)
    const turn = this.script[this.index]
    if (!turn) throw new Error(`ScriptedApiClient: script exhausted at index ${this.index}`)
    this.index += 1

    for (const delta of turn.textDeltas ?? []) {
      yield { type: 'text_delta', text: delta }
    }

    yield {
      type: 'message_complete',
      message: turn.message,
      usage: turn.usage ?? { input_tokens: 0, output_tokens: 0 },
      stop_reason: null,
    }
  }
}
