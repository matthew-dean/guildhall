import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  startProcessLogRetention,
  trimProcessLogDescriptor,
} from '../process-log-retention.js'

const openDescriptors: number[] = []
const tempFiles: string[] = []

afterEach(() => {
  while (openDescriptors.length > 0) fs.closeSync(openDescriptors.pop()!)
  while (tempFiles.length > 0) fs.rmSync(tempFiles.pop()!, { force: true })
})

function openTempLog(contents: string): { fd: number; filePath: string } {
  const filePath = path.join(os.tmpdir(), `guildhall-process-log-${process.pid}-${Date.now()}-${Math.random()}`)
  const fd = fs.openSync(filePath, 'w+')
  openDescriptors.push(fd)
  tempFiles.push(filePath)
  fs.writeSync(fd, contents)
  return { fd, filePath }
}

describe('process log retention', () => {
  it('trims regular log files that exceed the bound', () => {
    const { fd, filePath } = openTempLog('a'.repeat(12))

    expect(trimProcessLogDescriptor(fd, 8)).toBe(true)
    expect(fs.statSync(filePath).size).toBe(0)
  })

  it('leaves bounded log files alone', () => {
    const { fd, filePath } = openTempLog('a'.repeat(8))

    expect(trimProcessLogDescriptor(fd, 8)).toBe(false)
    expect(fs.statSync(filePath).size).toBe(8)
  })

  it('trims immediately and returns a stoppable timer', () => {
    const { fd, filePath } = openTempLog('a'.repeat(12))

    const stop = startProcessLogRetention({ descriptors: [fd], maxBytes: 8, intervalMs: 0 })

    expect(fs.statSync(filePath).size).toBe(0)
    expect(() => stop()).not.toThrow()
  })
})
