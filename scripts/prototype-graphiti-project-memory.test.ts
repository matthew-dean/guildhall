import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildGraphitiPrototypeCommand,
  graphitiPrototypeDefaults,
  loadGraphitiProviderEnv,
  prototypeFixtures,
} from './prototype-graphiti-project-memory.mjs'

describe('Graphiti project-memory prototype wrapper', () => {
  it('uses uv with a managed Python request and pinned Graphiti/Kuzu dependencies', () => {
    const command = buildGraphitiPrototypeCommand({
      out: 'artifacts/memory-context-eval/graphiti-prototype/report.json',
    })

    expect(command.bin).toBe('uv')
    expect(command.args).toContain('run')
    expect(command.args).toContain('--managed-python')
    expect(command.args).toContain('--python')
    expect(command.args).toContain(graphitiPrototypeDefaults.pythonVersion)
    expect(command.args).toContain('--with')
    expect(command.args).toContain(graphitiPrototypeDefaults.graphitiRequirement)
    expect(command.args).toContain(graphitiPrototypeDefaults.kuzuRequirement)
  })

  it('passes live fixtures and ignored artifact output to the Python probe', () => {
    const command = buildGraphitiPrototypeCommand({
      out: 'artifacts/memory-context-eval/graphiti-prototype/report.json',
    })
    const joined = command.args.join('\n')

    for (const fixture of prototypeFixtures) {
      expect(joined).toContain(fixture.projectRoot)
      expect(joined).toContain(fixture.id)
    }
    expect(joined).toContain('artifacts/memory-context-eval/graphiti-prototype/report.json')
  })

  it('can disable provider quality run while still checking dependency/backend setup', () => {
    const command = buildGraphitiPrototypeCommand({
      out: 'artifacts/memory-context-eval/graphiti-prototype/report.json',
      skipQuality: true,
    })

    expect(command.args).toContain('--skip-quality')
  })

  it('resets the generated Kuzu database by default unless reuse is requested', () => {
    const fresh = buildGraphitiPrototypeCommand()
    const reused = buildGraphitiPrototypeCommand({ reuseDb: true })

    expect(fresh.args).not.toContain('--reuse-db')
    expect(reused.args).toContain('--reuse-db')
  })

  it('loads OpenAI-compatible provider credentials from Guildhall global storage without command-line leakage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guildhall-graphiti-provider-'))
    const providerStore = join(dir, 'providers.yaml')
    const globalConfigStore = join(dir, 'config.yaml')
    writeFileSync(providerStore, [
      'version: 1',
      'providers:',
      '  openai-api:',
      '    apiKey: "sk-test-secret"',
      '    baseUrl: "https://example.invalid/v1"',
      '',
    ].join('\n'))
    writeFileSync(globalConfigStore, [
      'preferredProvider: openai-api',
      'models:',
      '  openai-api:',
      '    contextIndexer: "example/context-model"',
      '',
    ].join('\n'))

    const providerEnv = loadGraphitiProviderEnv({ providerStore, globalConfigStore })
    const command = buildGraphitiPrototypeCommand()

    expect(providerEnv.OPENAI_API_KEY).toBe('sk-test-secret')
    expect(providerEnv.OPENAI_BASE_URL).toBe('https://example.invalid/v1')
    expect(providerEnv.GUILDHALL_GRAPHITI_MODEL).toBe('example/context-model')
    expect(providerEnv.GUILDHALL_GRAPHITI_EMBEDDING_MODEL).toBe(graphitiPrototypeDefaults.defaultEmbeddingModel)
    expect(command.args.join(' ')).not.toContain('sk-test-secret')
  })
})
