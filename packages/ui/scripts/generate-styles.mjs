import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tokenDefinitions from '../src/token-definitions.js'
import textRoleDefinitions, { textRoleOrder } from '../src/text-role-definitions.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(__dirname, '..')
const srcStylesPath = resolve(packageRoot, 'src/styles.css')
const srcTokenDefinitionsPath = resolve(packageRoot, 'src/token-definitions.js')
const srcTextRoleDefinitionsPath = resolve(packageRoot, 'src/text-role-definitions.js')
const srcComponentsDir = resolve(packageRoot, 'src/components')
const distDir = resolve(packageRoot, 'dist')
const distStylesPath = resolve(distDir, 'styles.css')
const distTokenDefinitionsPath = resolve(distDir, 'token-definitions.js')
const distTextRoleDefinitionsPath = resolve(distDir, 'text-role-definitions.js')
const distComponentsDir = resolve(distDir, 'components')

function renderTextRoleClasses() {
  const blocks = []
  for (const role of textRoleOrder) {
    const tokens = textRoleDefinitions[role]
    blocks.push([
      `.gh-text-${role} {`,
      `  font-size: var(${tokens.size});`,
      `  font-weight: var(${tokens.weight});`,
      `  line-height: var(${tokens.lineHeight});`,
      `  color: var(${tokens.color});`,
      tokens.letterSpacing ? `  letter-spacing: ${tokens.letterSpacing};` : '  letter-spacing: 0;',
      tokens.textTransform ? `  text-transform: ${tokens.textTransform};` : null,
      '}',
    ].filter(Boolean).join('\n'))
  }
  return blocks.join('\n\n')
}

function renderStyles(tokens) {
  const darkDeclarations = []
  const lightDeclarations = []

  for (const token of tokens) {
    if (typeof token.value === 'string') {
      darkDeclarations.push(`  ${token.cssVariable}: ${token.value};`)
      continue
    }

    darkDeclarations.push(`  ${token.cssVariable}: ${token.value.dark};`)
    lightDeclarations.push(`  ${token.cssVariable}: ${token.value.light};`)
  }

  return [
    '/* Generated from src/token-definitions.js by scripts/generate-styles.mjs. */',
    ':root {',
    '  color-scheme: dark;',
    ...darkDeclarations,
    '}',
    '',
    ':root[data-gh-theme="light"],',
    '.gh-theme-light {',
    '  color-scheme: light;',
    ...lightDeclarations,
    '}',
    '',
    ':root[data-gh-theme="dark"],',
    '.gh-theme-dark {',
    '  color-scheme: dark;',
    '}',
    '',
    renderTextRoleClasses(),
    '',
  ].join('\n')
}

function writeIfChanged(path, content) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current !== content) {
    writeFileSync(path, content)
  }
}

function copySvelteComponents(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true })
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith('.svelte') && !entry.name.endsWith('.svelte.d.ts'))) {
      continue
    }
    copyFileSync(join(fromDir, entry.name), resolve(toDir, entry.name))
  }
}

const css = renderStyles(tokenDefinitions)
const checkOnly = process.argv.includes('--check')

if (checkOnly) {
  const current = existsSync(srcStylesPath) ? readFileSync(srcStylesPath, 'utf8') : null
  if (current !== css) {
    console.error('[guildhall/ui] src/styles.css is out of sync with src/token-definitions.js')
    process.exit(1)
  }
  process.exit(0)
}

writeIfChanged(srcStylesPath, css)
mkdirSync(distDir, { recursive: true })
writeIfChanged(distStylesPath, css)
copyFileSync(srcTokenDefinitionsPath, distTokenDefinitionsPath)
copyFileSync(srcTextRoleDefinitionsPath, distTextRoleDefinitionsPath)
copySvelteComponents(srcComponentsDir, distComponentsDir)
