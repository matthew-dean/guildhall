import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { analyzeDataLayerGuardrails } from './data-layer-guardrails.mjs'

describe('data-layer guardrails', () => {
  it('flags feature code that reads Guildhall managed data paths directly', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-reader.ts'), [
        "import fs from 'node:fs/promises'",
        "import { getProjectStateDir } from '@guildhall/sessions'",
        '',
        'export async function readBad(projectRoot: string) {',
        "  return fs.readFile(`${getProjectStateDir(projectRoot)}/bad.json`, 'utf8')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-reader.ts:5',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flags feature code that writes Guildhall managed data paths directly', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-feature.ts'), [
        "import fs from 'node:fs/promises'",
        "import { getProjectStateDir } from '@guildhall/sessions'",
        '',
        'export async function writeBad(projectRoot: string) {',
        "  await fs.writeFile(`${getProjectStateDir(projectRoot)}/bad.json`, '{}')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-feature.ts:5',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flags managed-wrapper writes when feature code constructs the Guildhall data path', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'runtime')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bad-managed-wrapper.ts'), [
        "import path from 'node:path'",
        "import { writeManagedTextFile } from '@guildhall/persistence'",
        '',
        'export async function writeBad(memoryDir: string) {',
        "  await writeManagedTextFile(path.join(memoryDir, 'TASKS.json'), '{}')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([
        'src/runtime/bad-managed-wrapper.ts:5',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows writes owned by the data layer', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-data-layer-guardrail-'))
    try {
      const dir = join(root, 'src', 'persistence')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'file-backed.ts'), [
        "import fs from 'node:fs/promises'",
        "import { getProjectLocalHistoryDir } from '@guildhall/sessions'",
        '',
        'export async function writeOwned(projectRoot: string) {',
        "  await fs.writeFile(`${getProjectLocalHistoryDir(projectRoot)}/record.json`, '{}')",
        '}',
        '',
      ].join('\n'))

      expect(analyzeDataLayerGuardrails({ repoRoot: root, roots: ['src'] })).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
