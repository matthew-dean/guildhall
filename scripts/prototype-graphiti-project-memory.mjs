#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const graphitiPrototypeDefaults = {
  pythonVersion: '3.12',
  graphitiRequirement: 'graphiti-core[kuzu]',
  kuzuRequirement: 'kuzu',
  probeScript: path.join(repoRoot, 'scripts', 'prototype_graphiti_project_memory.py'),
  providerStore: path.join(os.homedir(), '.guildhall', 'providers.yaml'),
  globalConfigStore: path.join(os.homedir(), '.guildhall', 'config.yaml'),
  modelRole: 'contextIndexer',
  defaultEmbeddingModel: 'BAAI/bge-m3',
  db: 'artifacts/memory-context-eval/graphiti-prototype/graphiti.kuzu',
  out: 'artifacts/memory-context-eval/graphiti-prototype/report.json',
}

export const prototypeFixtures = [
  {
    id: 'fair-labor-license',
    projectRoot: '/Users/matthew/git/oss/fair-labor-license',
    label: 'Fair Labor License task-state bloat',
  },
  {
    id: 'looma-knit',
    projectRoot: '/Users/matthew/git/oss/looma-knit',
    label: 'Looma + Knit progress bloat',
  },
]

function argValue(args, flag, fallback) {
  const index = args.indexOf(flag)
  if (index < 0) return fallback
  return args[index + 1] ?? fallback
}

export function buildGraphitiPrototypeCommand(options = {}) {
  const out = options.out ?? graphitiPrototypeDefaults.out
  const db = options.db ?? graphitiPrototypeDefaults.db
  const args = [
    'run',
    '--managed-python',
    '--python',
    options.pythonVersion ?? graphitiPrototypeDefaults.pythonVersion,
    '--with',
    options.graphitiRequirement ?? graphitiPrototypeDefaults.graphitiRequirement,
    '--with',
    options.kuzuRequirement ?? graphitiPrototypeDefaults.kuzuRequirement,
    graphitiPrototypeDefaults.probeScript,
    '--out',
    out,
    '--db',
    db,
  ]

  for (const fixture of options.fixtures ?? prototypeFixtures) {
    args.push('--fixture', `${fixture.id}=${fixture.projectRoot}`)
  }
  if (options.skipQuality) args.push('--skip-quality')
  if (options.reuseDb) args.push('--reuse-db')
  return { bin: 'uv', args }
}

export function loadGraphitiProviderEnv(options = {}) {
  const providerStore = options.providerStore ?? graphitiPrototypeDefaults.providerStore
  const globalConfigStore = options.globalConfigStore ?? graphitiPrototypeDefaults.globalConfigStore
  const modelRole = options.modelRole ?? graphitiPrototypeDefaults.modelRole
  if (!existsSync(providerStore)) return {}

  const parsed = parseYaml(readFileSync(providerStore, 'utf8')) ?? {}
  const providers = typeof parsed === 'object' && parsed !== null ? parsed.providers ?? {} : {}
  const openai = providers['openai-api']
  if (typeof openai !== 'object' || openai === null || typeof openai.apiKey !== 'string' || openai.apiKey.length === 0) {
    return {}
  }

  const env = { OPENAI_API_KEY: openai.apiKey }
  if (typeof openai.baseUrl === 'string' && openai.baseUrl.length > 0) {
    env.OPENAI_BASE_URL = openai.baseUrl
  }
  if (existsSync(globalConfigStore)) {
    const config = parseYaml(readFileSync(globalConfigStore, 'utf8')) ?? {}
    const models = typeof config === 'object' && config !== null ? config.models?.['openai-api'] : undefined
    const model = models?.[modelRole] ?? models?.worker ?? models?.all ?? models?.workhorse
    if (typeof model === 'string' && model.length > 0) {
      env.GUILDHALL_GRAPHITI_MODEL = model
    }
  }
  env.GUILDHALL_GRAPHITI_EMBEDDING_MODEL = process.env.GUILDHALL_GRAPHITI_EMBEDDING_MODEL ?? graphitiPrototypeDefaults.defaultEmbeddingModel
  return env
}

function main() {
  const args = process.argv.slice(2)
  const out = argValue(args, '--out', graphitiPrototypeDefaults.out)
  const db = argValue(args, '--db', graphitiPrototypeDefaults.db)
  const skipQuality = args.includes('--skip-quality')
  const command = buildGraphitiPrototypeCommand({ out, db, skipQuality })
  const providerEnv = loadGraphitiProviderEnv()
  const result = spawnSync(command.bin, command.args, {
    cwd: repoRoot,
    env: { ...process.env, ...providerEnv },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
