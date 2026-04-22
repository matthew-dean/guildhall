/**
 * Minimal SSE parser. The Response bodies we consume here all follow the
 * `event: <name>\ndata: <json>\n\n` convention; we don't need the full
 * whatwg event-source spec (retry/id handling, multi-line data).
 *
 * Upstream equivalent: the ad-hoc framing in openharness/api/codex_client.py
 * and implicit handling by the Anthropic/OpenAI SDKs.
 */

export interface SseEvent {
  event: string | null
  data: string
}

/**
 * Async-iterate SSE events from a Response body. The caller is responsible
 * for checking `response.ok` before handing us the stream.
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sepIndex: number
      while ((sepIndex = indexOfBlankLine(buffer)) !== -1) {
        const frame = buffer.slice(0, sepIndex)
        buffer = buffer.slice(sepIndex).replace(/^(?:\r?\n){2}/, '')
        const event = parseFrame(frame)
        if (event !== null) yield event
      }
    }
    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail.length > 0) {
      const event = parseFrame(tail)
      if (event !== null) yield event
    }
  } finally {
    reader.releaseLock()
  }
}

function indexOfBlankLine(s: string): number {
  const lf = s.indexOf('\n\n')
  const crlf = s.indexOf('\r\n\r\n')
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}

function parseFrame(frame: string): SseEvent | null {
  let event: string | null = null
  const dataLines: string[] = []
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line.length === 0 || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
