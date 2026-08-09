import fsp from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'

const config = {
  memoryDir: process.env.GUILDHALL_MP_MEMORY_DIR,
  rawRequest: process.env.GUILDHALL_MP_RAW_REQUEST,
  targetId: process.env.GUILDHALL_MP_TARGET_ID,
  targetTitle: process.env.GUILDHALL_MP_TARGET_TITLE,
  readyPath: process.env.GUILDHALL_MP_READY_PATH,
  startPath: process.env.GUILDHALL_MP_START_PATH,
  resultPath: process.env.GUILDHALL_MP_RESULT_PATH,
  postBarrierDelayMs: Number(process.env.GUILDHALL_MP_POST_BARRIER_DELAY_MS ?? 0),
}

async function waitForPath(filePath: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fsp.access(filePath)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for multiprocess allocation start: ${filePath}`)
}

const workerTest = [
  config.memoryDir,
  config.rawRequest,
  config.targetId,
  config.targetTitle,
  config.readyPath,
  config.startPath,
  config.resultPath,
].every(value => typeof value === 'string' && value.length > 0)
  ? it
  : it.skip

workerTest('creates one pressure-test intake from a synchronized process', async () => {
  expect(config.memoryDir).toBeTruthy()
  expect(config.readyPath).toBeTruthy()
  expect(config.startPath).toBeTruthy()
  expect(config.resultPath).toBeTruthy()

  const mutableFs = fsp as {
    access: typeof fsp.access
    link: typeof fsp.link
  }
  const originalAccess = fsp.access.bind(fsp)
  const originalLink = fsp.link.bind(fsp)
  let gated = false
  // Gate both the old check-before-write path and the durable link claim so
  // this regression deterministically exercises the same cross-process race.
  const gate = async (): Promise<void> => {
    if (gated) return
    gated = true
    await fsp.mkdir(path.dirname(config.readyPath!), { recursive: true })
    await fsp.writeFile(config.readyPath!, 'ready\n', 'utf-8')
    await waitForPath(config.startPath!)
    if (config.postBarrierDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, config.postBarrierDelayMs))
    }
  }

  mutableFs.access = async (...args: Parameters<typeof fsp.access>) => {
    try {
      return await originalAccess(...args)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') await gate()
      throw error
    }
  }
  mutableFs.link = async (...args: Parameters<typeof fsp.link>) => {
    await gate()
    return originalLink(...args)
  }

  try {
    const { createPressureTestIntake } = await import('../../pressure-test-intake.js')
    const intake = await createPressureTestIntake({
      memoryDir: config.memoryDir!,
      target: {
        type: 'release',
        id: config.targetId!,
        title: config.targetTitle!,
      },
      rawRequest: config.rawRequest!,
    })
    await fsp.writeFile(config.resultPath!, JSON.stringify({
      id: intake.id,
      rawRequest: intake.rawRequest,
      createdAt: intake.createdAt,
      target: intake.target,
    }), 'utf-8')
  } finally {
    mutableFs.access = originalAccess
    mutableFs.link = originalLink
  }
})
