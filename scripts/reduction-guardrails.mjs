#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()

const forbiddenRuntimeWords = [
  /\bLooma\b/,
  /\bKnit\b/,
  /\bAlertDialog\b/,
]

const allowedWordPaths = [
  /^internal\//,
  /^examples\//,
  /^src\/runtime\/(?:.*\/)?__tests__\//,
]

const forbiddenTaskShapes = [
  {
    path: /^src\/core\/task\.ts$/,
    pattern: /['"]parent['"]/,
    message: 'TaskStatus must not contain parent. Use task.hierarchy links and readiness.',
  },
  {
    path: /^src\/runtime\/work-hierarchy\.ts$/,
    pattern: /legacyParentTaskId|parentGoalId/,
    message: 'Runtime hierarchy must not infer containment from parentGoalId after migration.',
  },
  {
    path: /^src\/web\/lib\/work-hierarchy\.ts$/,
    pattern: /legacyParentTaskId|parentGoalId/,
    message: 'Web hierarchy must not infer containment from parentGoalId after migration.',
  },
  {
    path: /^src\/runtime\/thread\.ts$/,
    pattern: /function boundedChatTurns[\s\S]*?kind:\s*['"]pressure_test_question['"]/,
    message: 'Bounded chat sessions must project as bounded_chat/owner_input turns, not pressure_test_question.',
  },
  {
    path: /^src\/runtime\/inbox\.ts$/,
    pattern: /\b(project_check_in|pressure_test_pending|agent_question_pending|brief_approval|spec_approval|open_escalation)\b/,
    message: 'InboxItem must stay alert-owned. Route conversations, approvals, and escalations through Thread/owner-input.',
  },
  {
    path: /^src\/web\/lib\/inbox-item-key\.ts$/,
    pattern: /\b(project_check_in|pressure_test_pending|agent_question_pending|brief_approval|spec_approval|open_escalation)\b/,
    message: 'Web InboxItemKind must stay alert-owned. Do not reintroduce conversation-owned inbox rows.',
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|svelte|js|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const failures = []
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  if (rel.startsWith('src/runtime/') && !allowedWordPaths.some(pattern => pattern.test(rel))) {
    for (const pattern of forbiddenRuntimeWords) {
      if (pattern.test(text)) failures.push(`${rel}: generic runtime contains ${pattern}`)
    }
  }
  for (const rule of forbiddenTaskShapes) {
    if (rule.path.test(rel) && rule.pattern.test(text)) failures.push(`${rel}: ${rule.message}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
