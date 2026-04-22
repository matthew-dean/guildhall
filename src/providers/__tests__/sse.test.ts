import { describe, expect, it } from 'vitest'

import { parseSseStream, type SseEvent } from '../sse.js'

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  for await (const ev of parseSseStream(stream)) events.push(ev)
  return events
}

describe('parseSseStream', () => {
  it('parses single event with event name and data', async () => {
    const events = await collect(streamFromString('event: ping\ndata: {"a":1}\n\n'))
    expect(events).toEqual([{ event: 'ping', data: '{"a":1}' }])
  })

  it('parses data-only events', async () => {
    const events = await collect(streamFromString('data: hello\n\n'))
    expect(events).toEqual([{ event: null, data: 'hello' }])
  })

  it('reassembles events split across chunks', async () => {
    const events = await collect(
      chunkedStream(['event: delta\nda', 'ta: part', '1\n\nevent: done\ndata: x\n\n']),
    )
    expect(events).toEqual([
      { event: 'delta', data: 'part1' },
      { event: 'done', data: 'x' },
    ])
  })

  it('ignores comment lines starting with :', async () => {
    const events = await collect(streamFromString(': keepalive\ndata: y\n\n'))
    expect(events).toEqual([{ event: null, data: 'y' }])
  })

  it('concatenates multiple data: lines with a newline', async () => {
    const events = await collect(streamFromString('data: line1\ndata: line2\n\n'))
    expect(events).toEqual([{ event: null, data: 'line1\nline2' }])
  })

  it('emits a trailing event without a blank-line terminator', async () => {
    const events = await collect(streamFromString('data: tail'))
    expect(events).toEqual([{ event: null, data: 'tail' }])
  })
})
