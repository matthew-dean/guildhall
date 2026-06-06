#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const CONTRACT_PATH_RULES = [
  { pattern: /^src\/core\//, types: ['persisted_state', 'agent_contract'] },
  { pattern: /^src\/config\/schemas\.ts$/, types: ['persisted_state'] },
  { pattern: /^src\/levers\/schema\.ts$/, types: ['persisted_state'] },
  { pattern: /^src\/hooks\/schemas\.ts$/, types: ['agent_contract'] },
  { pattern: /^src\/protocol\/rich-artifacts\.ts$/, types: ['agent_contract', 'mcp_tooling'] },
  { pattern: /^src\/memory-core\//, types: ['persisted_state', 'agent_contract'] },
  { pattern: /^src\/runtime\/.*(state|store|migration|delivery-spine|contract).*\.ts$/, types: ['persisted_state', 'release_runtime'] },
  { pattern: /^src\/runtime\/migrations\.ts$/, types: ['persisted_state', 'release_runtime'] },
  { pattern: /^src\/tools\/task-queue\.ts$/, types: ['agent_contract', 'persisted_state'] },
  { pattern: /^src\/mcp-server\//, types: ['mcp_tooling', 'agent_contract'] },
  { pattern: /^src\/web\/surfaces\//, types: ['ui_component', 'documentation_help'] },
  { pattern: /^docs\/(guide|reference|web-ui|releases)\//, types: ['documentation_help'] },
  { pattern: /^internal\/specs\//, types: ['agent_contract', 'persisted_state'] },
]

export function analyzeContractTouches(input) {
  const changedFiles = input.changedFiles ?? []
  const documents = input.documents ?? new Map()
  const touched = changedFiles
    .map(file => ({ file, likelyContractTypes: likelyContractTypes(file) }))
    .filter(item => item.likelyContractTypes.length > 0)
  const hasContractDecision = hasBlock(documents, 'Contract Touch Decision')
  const hasSchemaDecision = hasBlock(documents, 'Schema Migration Decision')
  const hasMigrationDefinition = changedFiles.some(file =>
    file === 'src/runtime/migrations.ts' || file.startsWith('scripts/migrations/'))
  const schemaTouched = touched.some(item =>
    item.likelyContractTypes.includes('persisted_state') ||
    item.likelyContractTypes.includes('agent_contract'))
  const missing = touched.filter(item => {
    if (!hasContractDecision && !hasSchemaDecision && !hasMigrationDefinition) return true
    if (schemaTouched && !hasSchemaDecision && !hasMigrationDefinition) return true
    return false
  })
  return {
    advisory: true,
    valid: missing.length === 0,
    touched,
    missing,
    decisions: {
      contractTouchDecision: hasContractDecision,
      schemaMigrationDecision: hasSchemaDecision,
      migrationDefinitionChanged: hasMigrationDefinition,
    },
  }
}

function likelyContractTypes(file) {
  return [...new Set(CONTRACT_PATH_RULES.flatMap(rule => rule.pattern.test(file) ? rule.types : []))]
}

function hasBlock(documents, title) {
  for (const content of documents.values()) {
    if (new RegExp(`^#{1,3}\\s+${escapeRegExp(title)}\\b`, 'im').test(content)) return true
  }
  return false
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function changedFilesFromGit() {
  const output = execSync('git diff --name-only --cached && git diff --name-only', { encoding: 'utf8' })
  return [...new Set(output.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
}

function documentsFor(files) {
  const documents = new Map()
  for (const file of files) {
    if (!/\.(md|mdx)$/.test(file)) continue
    try {
      documents.set(file, readFileSync(file, 'utf8'))
    } catch {
      // Missing files are still reported through the changed-file path.
    }
  }
  return documents
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changedFiles = process.argv.slice(2).length > 0 ? process.argv.slice(2) : changedFilesFromGit()
  const result = analyzeContractTouches({ changedFiles, documents: documentsFor(changedFiles) })
  if (result.valid) {
    console.log('Contract touch detector advisory: all touched contract paths have decision evidence.')
  } else {
    console.log('Contract touch detector advisory: missing contract decision evidence.')
    for (const item of result.missing) {
      console.log(`- ${item.file}: ${item.likelyContractTypes.join(', ')}`)
    }
  }
  process.exitCode = result.valid ? 0 : 1
}
