import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP_HOME = path.join(os.tmpdir(), `guildhall-provider-runtime-${process.pid}`)
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => TMP_HOME }
})

const {
  bootstrapWorkspace,
  updateProjectConfig,
  updateGlobalConfig,
  setProvider,
} = await import('@guildhall/config')
const {
  buildSelectApiClientOptions,
  getRuntimeProviderConfig,
  resolveOpenAiCompatibleConcurrency,
  resolveLaneConcurrencyPlan,
  resolveReviewerFanoutPolicy,
} = await import('../provider-runtime-config.js')

let tmpProject: string

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.LLAMA_CPP_URL
  delete process.env.LM_STUDIO_BASE_URL
  mkdirSync(path.join(TMP_HOME, '.guildhall'), { recursive: true })
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-provider-runtime-proj-'))
  bootstrapWorkspace(tmpProject, { name: 'Provider Runtime Test' })
})

afterEach(async () => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true, force: true })
  await fs.rm(tmpProject, { recursive: true, force: true })
})

describe('getRuntimeProviderConfig', () => {
  it('normalizes preferred provider, fallback flag, and custom OpenAI-compatible base URL together', () => {
    updateProjectConfig(tmpProject, {
      preferredProvider: 'openai-api',
      allowPaidProviderFallback: true,
    })
    setProvider('openai-api', {
      apiKey: 'nvapi-test',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })

    const result = getRuntimeProviderConfig({
      projectPath: tmpProject,
      models: {
        spec: 'qwen/qwen3.5-122b-a10b',
        coordinator: 'qwen/qwen3.5-122b-a10b',
        worker: 'qwen/qwen3.5-122b-a10b',
        reviewer: 'qwen/qwen3.5-122b-a10b',
        gateChecker: 'qwen/qwen3.5-122b-a10b',
        contextIndexer: 'qwen/qwen3.5-122b-a10b',
      },
    })

    expect(result.preferredProvider).toBe('openai-api')
    expect(result.preferredProviderFamily).toBe('openai-compatible')
    expect(result.preferredProviderCapabilities).toMatchObject({
      streaming: true,
      toolCalls: true,
      reasoningSideChannel: 'compatible',
      localServer: false,
    })
    expect(result.allowPaidProviderFallback).toBe(true)
    expect(result.selectOptions).toMatchObject({
      preferredProvider: 'openai-api',
      allowPaidProviderFallback: true,
      openaiApiKey: 'nvapi-test',
      openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    })
  })

  it('falls back to global allowPaidProviderFallback when the project does not override it', () => {
    updateGlobalConfig({ allowPaidProviderFallback: true })

    const result = getRuntimeProviderConfig({
      projectPath: tmpProject,
      models: {
        spec: 'gpt-5.3-codex',
        coordinator: 'gpt-5.3-codex',
        worker: 'gpt-5.3-codex',
        reviewer: 'gpt-5.3-codex',
        gateChecker: 'gpt-5.3-codex',
        contextIndexer: 'gpt-5.3-codex',
      },
    })

    expect(result.allowPaidProviderFallback).toBe(true)
    expect(result.selectOptions.allowPaidProviderFallback).toBe(true)
  })

  it('uses the global preferred provider when the project does not override it', () => {
    updateGlobalConfig({ preferredProvider: 'openai-api' })
    setProvider('openai-api', {
      apiKey: 'nvapi-test',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })

    const result = getRuntimeProviderConfig({
      projectPath: tmpProject,
      models: {
        spec: 'qwen/qwen3.5-122b-a10b',
        coordinator: 'qwen/qwen3.5-122b-a10b',
        worker: 'qwen/qwen3.5-122b-a10b',
        reviewer: 'qwen/qwen3.5-122b-a10b',
        gateChecker: 'qwen/qwen3.5-122b-a10b',
        contextIndexer: 'qwen/qwen3.5-122b-a10b',
      },
    })

    expect(result.preferredProvider).toBe('openai-api')
    expect(result.selectOptions.preferredProvider).toBe('openai-api')
  })

  it('lets a project override win over the global preferred provider', () => {
    updateGlobalConfig({ preferredProvider: 'openai-api' })
    updateProjectConfig(tmpProject, { preferredProvider: 'llama-cpp' })

    const result = getRuntimeProviderConfig({
      projectPath: tmpProject,
      models: {
        spec: 'qwen/qwen3.5-122b-a10b',
        coordinator: 'qwen/qwen3.5-122b-a10b',
        worker: 'qwen/qwen3.5-122b-a10b',
        reviewer: 'qwen/qwen3.5-122b-a10b',
        gateChecker: 'qwen/qwen3.5-122b-a10b',
        contextIndexer: 'qwen/qwen3.5-122b-a10b',
      },
    })

    expect(result.preferredProvider).toBe('llama-cpp')
    expect(result.selectOptions.preferredProvider).toBe('llama-cpp')
  })

  it('builds consistent select options for forced-provider probes from the same credential shape', () => {
    const selectOptions = buildSelectApiClientOptions({
      providerOverride: 'openai-api',
      credentials: {
        openaiApiKey: 'nvapi-test',
        openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
      },
    })

    expect(selectOptions).toMatchObject({
      provider: 'openai-api',
      openaiApiKey: 'nvapi-test',
      openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    })
  })

  it('clamps reviewer fanout concurrency to the provider recommendation', () => {
    expect(
      resolveReviewerFanoutPolicy({
        provider: 'llama-cpp',
        requestedConcurrency: 3,
      }),
    ).toEqual({
      requestedConcurrency: 3,
      effectiveConcurrency: 1,
      recommendedConcurrency: 2,
      clamped: true,
    })

    expect(
      resolveReviewerFanoutPolicy({
        provider: 'openai-api',
        requestedConcurrency: 3,
      }),
    ).toEqual({
      requestedConcurrency: 3,
      effectiveConcurrency: 2,
      recommendedConcurrency: 10,
      clamped: true,
    })
  })

  it('auto-derives reviewer fanout concurrency from the provider when no override is set', () => {
    expect(
      resolveReviewerFanoutPolicy({
        provider: 'llama-cpp',
      }),
    ).toEqual({
      requestedConcurrency: 2,
      effectiveConcurrency: 1,
      recommendedConcurrency: 2,
      clamped: true,
    })

    expect(
      resolveReviewerFanoutPolicy({
        provider: 'openai-api',
      }),
    ).toEqual({
      requestedConcurrency: 10,
      effectiveConcurrency: 2,
      recommendedConcurrency: 10,
      clamped: true,
    })
  })

  it('lets a global reviewer fanout override apply when the project leaves it unset', () => {
    updateGlobalConfig({ reviewerFanoutConcurrency: 2 })

    expect(
      resolveLaneConcurrencyPlan({
        projectPath: tmpProject,
        provider: 'openai-api',
        dispatchCapacity: 4,
      }).reviewerFanout,
    ).toEqual({
      requestedConcurrency: 2,
      effectiveConcurrency: 2,
      recommendedConcurrency: 10,
      clamped: false,
    })
  })

  it('uses the provider-group max concurrency for OpenAI-compatible pools', () => {
    setProvider('openai-api', {
      apiKey: 'sk-test',
      baseUrl: 'https://example-openai-compatible.test/v1',
      maxConcurrency: 200,
    })

    expect(
      resolveOpenAiCompatibleConcurrency({
        provider: 'openai-api',
        baseUrl: 'https://example-openai-compatible.test/v1',
      }),
    ).toBe(200)
  })

  it('falls back to hosted and local provider-group defaults when max concurrency is unset', () => {
    setProvider('openai-api', {
      apiKey: 'sk-test',
      baseUrl: 'https://example-openai-compatible.test/v1',
    })

    expect(
      resolveOpenAiCompatibleConcurrency({
        provider: 'openai-api',
        baseUrl: 'https://example-openai-compatible.test/v1',
      }),
    ).toBe(10)

    expect(
      resolveOpenAiCompatibleConcurrency({
        provider: 'llama-cpp',
        baseUrl: 'http://127.0.0.1:1234/v1',
      }),
    ).toBe(2)
  })

  it('clamps provider-group max concurrency to the global provider ceiling', () => {
    updateGlobalConfig({ maxProviderConcurrency: 40 })
    setProvider('openai-api', {
      apiKey: 'sk-test',
      baseUrl: 'https://example-openai-compatible.test/v1',
      maxConcurrency: 200,
    })

    expect(
      resolveOpenAiCompatibleConcurrency({
        provider: 'openai-api',
        baseUrl: 'https://example-openai-compatible.test/v1',
      }),
    ).toBe(40)
  })

  it('builds a bounded lane concurrency plan from project config plus dispatch capacity', () => {
    updateProjectConfig(tmpProject, {
      specLaneConcurrency: 2,
      workerLaneConcurrency: 5,
      reviewLaneConcurrency: 3,
      coordinatorLaneConcurrency: 4,
      reviewerFanoutConcurrency: 6,
    })

    expect(
      resolveLaneConcurrencyPlan({
        projectPath: tmpProject,
        provider: 'llama-cpp',
        dispatchCapacity: 2,
      }),
    ).toEqual({
      spec: {
        requestedConcurrency: 2,
        effectiveConcurrency: 1,
        recommendedConcurrency: 1,
        clamped: true,
      },
      worker: {
        requestedConcurrency: 5,
        effectiveConcurrency: 2,
        recommendedConcurrency: 2,
        clamped: true,
      },
      review: {
        requestedConcurrency: 3,
        effectiveConcurrency: 1,
        recommendedConcurrency: 1,
        clamped: true,
      },
      coordinator: {
        requestedConcurrency: 4,
        effectiveConcurrency: 1,
        recommendedConcurrency: 1,
        clamped: true,
      },
      reviewerFanout: {
        requestedConcurrency: 6,
        effectiveConcurrency: 1,
        recommendedConcurrency: 2,
        clamped: true,
      },
    })
  })
})
