import { describe, expect, it, vi } from 'vitest'

vi.mock('@guildhall/core', () => ({
  DEFAULT_LOCAL_MODEL_ASSIGNMENT: {
    spec: 'local-spec',
    coordinator: 'local-coordinator',
    worker: 'local-worker',
    reviewer: 'local-reviewer',
    gateChecker: 'local-gate-checker',
  },
  STANDARD_CODE_REVIEW_RUBRIC: [],
  STANDARD_TS_GATES: [],
}))

async function loadForgeConfig(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  const previous = { ...process.env }
  for (const key of ['FORGE_MEMORY_DIR', 'LOOMA_PATH', 'KNIT_PATH']) {
    delete process.env[key]
  }
  Object.assign(process.env, env)
  try {
    return (await import('../guildhall.config.js')).forgeConfig
  } finally {
    process.env = previous
  }
}

describe('forgeConfig', () => {
  it('defaults to local model assignments and the standard Looma/Knit coordinator domains', async () => {
    const config = await loadForgeConfig()

    expect(config.memoryDir).toBe('./memory')
    expect(config.models).toEqual({
      spec: 'local-spec',
      coordinator: 'local-coordinator',
      worker: 'local-worker',
      reviewer: 'local-reviewer',
      gateChecker: 'local-gate-checker',
    })
    expect(config.maxRevisions).toBe(3)
    expect(config.heartbeatInterval).toBe(5)
    expect(config.coordinators.map((coordinator) => coordinator.id)).toEqual(['looma', 'knit'])
    expect(config.coordinators[0]?.projectPaths).toEqual(['../looma'])
    expect(config.coordinators[1]?.projectPaths).toEqual(['../knit'])
    expect(config.coordinators[0]?.concerns.map((concern) => concern.id)).toEqual([
      'api-genericity',
      'accessibility',
      'ssr-first',
      'documentation',
    ])
    expect(config.coordinators[1]?.concerns.map((concern) => concern.id)).toEqual([
      'product-quality',
      'looma-migration',
      'velocity',
    ])
  })

  it('lets project-local environment variables override memory and sibling project paths', async () => {
    const config = await loadForgeConfig({
      FORGE_MEMORY_DIR: '/tmp/guildhall-memory',
      LOOMA_PATH: '/workspace/looma',
      KNIT_PATH: '/workspace/knit',
    })

    expect(config.memoryDir).toBe('/tmp/guildhall-memory')
    expect(config.coordinators[0]?.projectPaths).toEqual(['/workspace/looma'])
    expect(config.coordinators[1]?.projectPaths).toEqual(['/workspace/knit'])
  })
})
