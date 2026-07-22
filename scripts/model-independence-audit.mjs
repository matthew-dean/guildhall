#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const repoRoot = resolve(process.cwd())

// These names are the narrow set of values that commonly carry provider or
// model-authored text into Guildhall runtime code. A prose matcher here is
// almost always an attempt to make an operational decision from rhetoric.
const MODEL_TEXT_NAMES = [
  'rawOutput',
  'generatedText',
  'assistantReasoning',
  'modelOutput',
  'providerOutput',
  'last_assistant_reasoning',
  'last_assistant_text',
  'lastAssistantReasoning',
  'lastAssistantText',
  'assistantText',
  'assistantMessage',
  'modelMessage',
  'completionText',
  'responseText',
  'answerText',
  'narrativeText',
  'explanationText',
  'reasoningText',
  'modelReasoning',
  'modelNarrative',
]
const MODEL_TEXT_ENVELOPE_NAMES = new Set([
  'completion',
  'finalMessage',
  'message',
  'payload',
  'response',
  'result',
])
const MODEL_TEXT_TERMINAL_PROPERTIES = new Set([
  'content',
  'output_text',
  'reasoning',
  'reasoning_content',
  'text',
])
const MODEL_TEXT_NESTED_ENVELOPE_NAMES = new Set([
  'completion',
  'finalMessage',
  'message',
  'response',
])

const PROSE_MATCH_PATTERN = /(?:\.includes|\.match|\.test|\.startsWith|\.endsWith|\.toLowerCase|\.toUpperCase)\s*\(/u
const PROSE_METHOD_NAMES = new Set([
  'includes',
  'match',
  'test',
  'startsWith',
  'endsWith',
  'toLowerCase',
  'toUpperCase',
  // Test matchers are included so a model-output test cannot quietly encode
  // an exact phrase expectation while production code remains clean.
  'toContain',
  'toMatch',
  'toEqual',
  'toStrictEqual',
  'toBe',
])

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
}

function walkUnit(node, visitor) {
  const visit = (candidate) => {
    if (candidate !== node && isFunctionLike(candidate)) return
    visitor(candidate)
    ts.forEachChild(candidate, visit)
  }
  visit(node)
}

function hasTaintedIdentifier(node, taintedNames) {
  let tainted = false
  walkUnit(node, (candidate) => {
    if (!ts.isIdentifier(candidate) || !taintedNames.has(candidate.text)) return
    // `{ rawOutput: '' }` names a data field; it does not make the containing
    // object a provider-text value. Shorthand `{ rawOutput }` and property
    // access `packet.rawOutput` remain tainted because they carry the value.
    if (ts.isPropertyAssignment(candidate.parent) && candidate.parent.name === candidate) return
    tainted = true
  })
  return tainted
}

function hasModelTextEnvelopeIdentifier(node, nested = false) {
  let found = false
  walkUnit(node, (candidate) => {
    const names = nested ? MODEL_TEXT_NESTED_ENVELOPE_NAMES : MODEL_TEXT_ENVELOPE_NAMES
    if (ts.isIdentifier(candidate) && names.has(candidate.text)) {
      found = true
    }
  })
  return found
}

function valueCarriesModelText(node, taintedNames, modelTextFunctions = new Set()) {
  if (ts.isIdentifier(node)) return hasTaintedIdentifier(node, taintedNames)
  if (ts.isPropertyAccessExpression(node)) {
    // Tagged-union discriminants are protocol structure, not provider prose.
    // A typed `block.type === 'tool_use'` check is allowed even when the
    // containing block originated in a provider response.
    if (node.name.text === 'type') return false
    if (hasTaintedIdentifier(node, taintedNames)) return true
    // Provider responses are not uniform. OpenAI-compatible clients commonly
    // nest prose at `choices[0].message.content`, while other clients expose
    // `output_text` or `reasoning_content`. Treat only known terminal prose
    // properties on a known response envelope as tainted; ordinary metadata
    // such as `response.status` stays outside this boundary.
    if (!MODEL_TEXT_TERMINAL_PROPERTIES.has(node.name.text)) return false
    // `result.content` and `payload.content` are commonly tool-result or
    // persisted-event text, not provider response prose. Keep the broad
    // envelope check for direct `.text` compatibility, but require a
    // provider-shaped root for nested content/reasoning fields.
    const nested = node.name.text !== 'text' || !ts.isIdentifier(node.expression)
    return hasModelTextEnvelopeIdentifier(node.expression, nested)
  }
  if (ts.isElementAccessExpression(node)) {
    return hasTaintedIdentifier(node, taintedNames) || hasModelTextEnvelopeIdentifier(node, true)
  }
  if (ts.isParenthesizedExpression(node)) return valueCarriesModelText(node.expression, taintedNames, modelTextFunctions)
  if (ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return valueCarriesModelText(node.expression, taintedNames, modelTextFunctions)
  }
  if (ts.isCallExpression(node)) {
    // A parser/validator call consumes provider text and returns structured
    // data; it is not itself provider prose. A string method chain such as
    // `rawOutput.trim()` does carry the text, because its receiver is tainted.
    if (ts.isIdentifier(node.expression) && modelTextFunctions.has(node.expression.text)) {
      return node.arguments.some(argument => valueCarriesModelText(argument, taintedNames, modelTextFunctions))
    }
    return ts.isPropertyAccessExpression(node.expression) &&
      valueCarriesModelText(node.expression.expression, taintedNames, modelTextFunctions)
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some(property => {
      if (!ts.isPropertyAssignment(property)) return ts.isShorthandPropertyAssignment(property) && hasTaintedIdentifier(property.name, taintedNames)
      return valueCarriesModelText(property.initializer, taintedNames, modelTextFunctions)
    })
  }
  if (ts.isConditionalExpression(node)) {
    return valueCarriesModelText(node.whenTrue, taintedNames, modelTextFunctions) || valueCarriesModelText(node.whenFalse, taintedNames, modelTextFunctions)
  }
  if (ts.isBinaryExpression(node)) {
    return valueCarriesModelText(node.left, taintedNames, modelTextFunctions) || valueCarriesModelText(node.right, taintedNames, modelTextFunctions)
  }
  return false
}

function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text
  }
  return null
}

function functionParameters(node) {
  return node.parameters
    .flatMap(parameter => ts.isIdentifier(parameter.name) ? [parameter.name.text] : [])
}

function functionReturnsModelText(node, modelTextFunctions) {
  const taintedNames = new Set([...MODEL_TEXT_NAMES, ...functionParameters(node)])
  let carries = false
  walkUnit(node, (candidate) => {
    if (!ts.isReturnStatement(candidate) || !candidate.expression) return
    if (valueCarriesModelText(candidate.expression, taintedNames, modelTextFunctions)) carries = true
  })
  return carries
}

function addBindingNames(pattern, taintedNames) {
  if (ts.isIdentifier(pattern)) {
    taintedNames.add(pattern.text)
    return
  }
  if (ts.isObjectBindingPattern(pattern)) {
    for (const element of pattern.elements) {
      if (ts.isBindingElement(element)) addBindingNames(element.name, taintedNames)
    }
  }
}

function addDestructuredModelTextBindings(candidate, taintedNames) {
  if (!ts.isVariableDeclaration(candidate) || !candidate.initializer || !ts.isObjectBindingPattern(candidate.name)) return
  const initializer = candidate.initializer
  const isKnownEnvelope = ts.isIdentifier(initializer) && MODEL_TEXT_ENVELOPE_NAMES.has(initializer.text)
  if (!isKnownEnvelope) return
  for (const element of candidate.name.elements) {
    if (!ts.isBindingElement(element) || !element.propertyName) continue
    const propertyName = ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
      ? element.propertyName.text
      : null
    if (propertyName === 'text') addBindingNames(element.name, taintedNames)
  }
}

function typeScriptModelProseOffenders(file, source, root) {
  const scriptKind = file.endsWith('.svelte')
    ? ts.ScriptKind.TSX
    : /\.(?:js|mjs|cjs)$/u.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  const units = [sourceFile]
  const collectFunctions = (node) => {
    if (node !== sourceFile && isFunctionLike(node)) units.push(node)
    ts.forEachChild(node, collectFunctions)
  }
  collectFunctions(sourceFile)
  const offenders = []
  const modelTextFunctions = new Set()

  // Treat helpers that return one of their model-text parameters as tainted
  // too. Otherwise a prose matcher can evade the boundary by hiding behind a
  // neutral helper such as `normalize(value)`.
  let functionsChanged = true
  while (functionsChanged) {
    functionsChanged = false
    for (const candidate of units) {
      if (candidate === sourceFile) continue
      const name = functionName(candidate)
      if (!name || modelTextFunctions.has(name)) continue
      if (!functionReturnsModelText(candidate, modelTextFunctions)) continue
      modelTextFunctions.add(name)
      functionsChanged = true
    }
  }

  for (const unit of units) {
    const taintedNames = new Set(MODEL_TEXT_NAMES)
    let changed = true
    while (changed) {
      changed = false
      walkUnit(unit, (candidate) => {
        if (!ts.isVariableDeclaration(candidate) || !candidate.initializer) return
        addDestructuredModelTextBindings(candidate, taintedNames)
        if (!ts.isIdentifier(candidate.name) || !valueCarriesModelText(candidate.initializer, taintedNames, modelTextFunctions)) return
        if (!taintedNames.has(candidate.name.text)) {
          taintedNames.add(candidate.name.text)
          changed = true
        }
      })
    }

    walkUnit(unit, (candidate) => {
      if (ts.isBinaryExpression(candidate) && [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(candidate.operatorToken.kind)) {
        const leftTainted = valueCarriesModelText(candidate.left, taintedNames, modelTextFunctions)
        const rightTainted = valueCarriesModelText(candidate.right, taintedNames, modelTextFunctions)
        const leftLiteral = ts.isStringLiteral(candidate.left) || ts.isNoSubstitutionTemplateLiteral(candidate.left)
        const rightLiteral = ts.isStringLiteral(candidate.right) || ts.isNoSubstitutionTemplateLiteral(candidate.right)
        if ((leftTainted && rightLiteral) || (rightTainted && leftLiteral)) {
          const line = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile)).line + 1
          offenders.push(`${relative(root, file)}:${line}: direct prose comparison on model output`)
        }
      }
      if (ts.isSwitchStatement(candidate) && valueCarriesModelText(candidate.expression, taintedNames, modelTextFunctions)) {
        const hasLiteralCase = candidate.caseBlock.clauses.some(clause =>
          ts.isCaseClause(clause) && (ts.isStringLiteral(clause.expression) || ts.isNoSubstitutionTemplateLiteral(clause.expression)),
        )
        if (hasLiteralCase) {
          const line = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile)).line + 1
          offenders.push(`${relative(root, file)}:${line}: direct prose switch on model output`)
        }
      }
      if (ts.isNewExpression(candidate) && ts.isIdentifier(candidate.expression) && candidate.expression.text === 'RegExp' &&
        (candidate.arguments ?? []).some(argument => valueCarriesModelText(argument, taintedNames, modelTextFunctions))) {
        const line = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile)).line + 1
        offenders.push(`${relative(root, file)}:${line}: model output used as a regular expression`)
      }
      if (!ts.isCallExpression(candidate)) return
      const expression = candidate.expression
      const methodName = ts.isPropertyAccessExpression(expression) ? expression.name.text : null
      if (!methodName || !PROSE_METHOD_NAMES.has(methodName)) return
      const literalComparison = methodName === 'toEqual' || methodName === 'toStrictEqual' || methodName === 'toBe'
        ? candidate.arguments.some(argument => ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) || ts.isRegularExpressionLiteral(argument))
        : true
      if (!literalComparison) return
      const receiverIsTainted = ts.isPropertyAccessExpression(expression)
        ? valueCarriesModelText(expression.expression, taintedNames)
        : false
      const argumentIsTainted = candidate.arguments.some(argument => hasTaintedIdentifier(argument, taintedNames))
      if (!receiverIsTainted && !argumentIsTainted) return
      const line = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile)).line + 1
      offenders.push(`${relative(root, file)}:${line}: direct prose operation on model output`)
    })
  }
  return [...new Set(offenders)]
}

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(fullPath))
    else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs|svelte)$/.test(entry.name)) files.push(fullPath)
  }
  return files
}

/**
 * Find direct prose-matching operations against model-output variables.
 * Typed JSON extraction may inspect a raw transport envelope, but runtime
 * decisions must consume the resulting fields rather than words in it.
 */
export function findModelProseAuthority(input = {}) {
  const root = input.repoRoot ? resolve(input.repoRoot) : repoRoot
  const files = input.files ?? [
    join(root, 'src'),
    join(root, 'scripts'),
    join(root, 'packages'),
  ].filter(existsSync).flatMap(directory => sourceFiles(directory))
  const offenders = []

  for (const file of files) {
    const relativePath = relative(root, file)
    const source = readFileSync(file, 'utf8')
    if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs|svelte)$/u.test(file)) {
      offenders.push(...typeScriptModelProseOffenders(file, source, root))
      continue
    }
    const lines = source.split(/\r?\n/u)
    for (const [index, line] of lines.entries()) {
      if (!MODEL_TEXT_NAMES.some((name) => line.includes(name))) continue
      if (!PROSE_MATCH_PATTERN.test(line)) continue
      offenders.push(`${relativePath}:${index + 1}: direct prose operation on model output`)
    }
  }
  return offenders
}

const offenders = findModelProseAuthority()
if (offenders.length > 0) {
  console.error([
    'Model-independence audit failed.',
    'Provider/model prose may be retained for audit, but it cannot be matched or normalized to drive Guildhall state.',
    ...offenders.map((offender) => `- ${offender}`),
    'Replace the prose dependency with a typed field, stable ID, enum, numeric metric, or evidence reference.',
  ].join('\n'))
  process.exit(1)
}

console.log('Model-independence audit passed: no direct prose matcher found on model-output values.')
