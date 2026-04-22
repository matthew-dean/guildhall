/**
 * Ported from openharness/src/openharness/engine/messages.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic BaseModel → Zod discriminated union on `type`
 *   - ToolUseBlock default id factory: `toolu_${uuid4().hex}` → `toolu_${crypto.randomUUID().replace(/-/g, '')}`
 *   - `ImageBlock.from_path` dropped from the wire module; image loading belongs in the engine package (Node fs + mime types)
 *   - `assistant_message_from_api` dropped; it's provider-SDK-specific and belongs in the engine package
 *   - `to_api_param` method → serializeContentBlock / toApiParam free functions (keeps the schema file pure)
 *   - `field_validator` that normalized null content → Zod preprocess on the ConversationMessage schema
 */

import { z } from 'zod'

// -------- Content blocks --------

export const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})
export type TextBlock = z.infer<typeof textBlockSchema>

export const imageBlockSchema = z.object({
  type: z.literal('image'),
  media_type: z.string(),
  data: z.string(),
  source_path: z.string().default(''),
})
export type ImageBlock = z.infer<typeof imageBlockSchema>

export const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().default(() => `toolu_${crypto.randomUUID().replace(/-/g, '')}`),
  name: z.string(),
  input: z.record(z.unknown()).default({}),
})
export type ToolUseBlock = z.infer<typeof toolUseBlockSchema>

export const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().default(false),
})
export type ToolResultBlock = z.infer<typeof toolResultBlockSchema>

export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  imageBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
])
export type ContentBlock = z.infer<typeof contentBlockSchema>

// -------- Conversation message --------

export const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .preprocess((v) => (v == null ? [] : v), z.array(contentBlockSchema))
    .default([]),
})
export type ConversationMessage = z.infer<typeof conversationMessageSchema>

// -------- Constructors --------

export function userMessageFromText(text: string): ConversationMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

export function userMessageFromContent(content: ContentBlock[]): ConversationMessage {
  return { role: 'user', content: [...content] }
}

// -------- Accessors --------

export function messageText(message: ConversationMessage): string {
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

export function messageToolUses(message: ConversationMessage): ToolUseBlock[] {
  return message.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
}

export function isEffectivelyEmpty(message: ConversationMessage): boolean {
  if (message.content.length === 0) return true
  for (const block of message.content) {
    if (block.type === 'text') {
      if (block.text.trim().length > 0) return false
    } else {
      return false
    }
  }
  return true
}

// -------- Serialization to provider wire format --------

export function serializeContentBlock(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.media_type, data: block.data },
      }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      }
  }
}

export function toApiParam(message: ConversationMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content.map(serializeContentBlock),
  }
}

// -------- Sanitization --------

/**
 * Normalize restored conversation history into a provider-safe sequence.
 *
 * Drops empty assistant messages and trims malformed trailing tool turns
 * (an assistant tool_use never matched by a user tool_result). Those broken
 * tails happen when a session is interrupted mid-turn and would cause
 * OpenAI-compatible providers to reject the resumed conversation.
 *
 * Ported from openharness/src/openharness/engine/messages.py:sanitize_conversation_messages.
 */
export function sanitizeConversationMessages(
  messages: ConversationMessage[],
): ConversationMessage[] {
  const sanitized: ConversationMessage[] = []
  let pendingToolUseIds = new Set<string>()
  let pendingToolUseIndex: number | null = null

  for (let message of messages) {
    if (message.role === 'assistant' && isEffectivelyEmpty(message)) continue

    const toolUses = message.role === 'assistant' ? messageToolUses(message) : []
    const toolResults =
      message.role === 'user'
        ? message.content.filter((b): b is ToolResultBlock => b.type === 'tool_result')
        : []

    let matchedPendingToolResults = false
    if (pendingToolUseIds.size > 0) {
      const resultIds = new Set(toolResults.map((b) => b.tool_use_id))
      const allMatched = [...pendingToolUseIds].every((id) => resultIds.has(id))
      if (message.role !== 'user' || !allMatched) {
        if (pendingToolUseIndex !== null && pendingToolUseIndex < sanitized.length) {
          sanitized.splice(pendingToolUseIndex, 1)
        }
        pendingToolUseIds = new Set()
        pendingToolUseIndex = null
      } else {
        matchedPendingToolResults = true
        pendingToolUseIds = new Set()
        pendingToolUseIndex = null
      }
    }

    if (message.role === 'user' && toolResults.length > 0 && !matchedPendingToolResults) {
      const content = message.content.filter((b) => b.type !== 'tool_result')
      if (content.length === 0) continue
      message = { role: 'user', content }
    }

    sanitized.push(message)

    if (toolUses.length > 0) {
      pendingToolUseIds = new Set(toolUses.map((b) => b.id))
      pendingToolUseIndex = sanitized.length - 1
    }
  }

  if (
    pendingToolUseIds.size > 0 &&
    pendingToolUseIndex !== null &&
    pendingToolUseIndex < sanitized.length
  ) {
    sanitized.splice(pendingToolUseIndex, 1)
  }

  return sanitized
}
