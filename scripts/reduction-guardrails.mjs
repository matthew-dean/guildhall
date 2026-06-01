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
    path: /^src\/core\/task\.ts$/,
    pattern: /\bopenQuestions\s*:\s*z\.array/,
    message: 'The normal Task schema must not include openQuestions. Use OwnerInputRequest plus bounded-chat.',
  },
  {
    path: /^src\/runtime\/request-intake\.ts$/,
    pattern: /\bopenQuestion\b/,
    message: 'Request intake must return owner-input descriptors, not embedded task-local openQuestion state.',
  },
  {
    path: /^src\/runtime\/structural-map\.ts$/,
    pattern: /^\s*ownerQuestions\s*:/m,
    message: 'Structural maps must store ownerInputRequestIds, not durable ownerQuestions arrays.',
  },
  {
    path: /^src\/runtime\/intake\.ts$/,
    pattern: /\bopenQuestionsOverride\b|\.openQuestions\s*=/,
    message: 'Intake must create owner-input requests instead of writing task.openQuestions.',
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
  {
    path: /^src\/web\/surfaces\/TaskDrawer\.svelte$/,
    pattern: /answer-questions|onAnswerQuestion|function\s+answerQuestion/,
    message: 'TaskDrawer must not answer owner-input locally. Link task questions to the Thread surface.',
  },
  {
    path: /^src\/web\/surfaces\/drawer\/CurrentTab\.svelte$/,
    pattern: /AgentQuestion|onAnswerQuestion|onAnswer=|answer-questions/,
    message: 'CurrentTab must not render local answer cards. Link task questions to the Thread surface.',
  },
  {
    path: /^src\/web\/surfaces\/project\/ProjectOverviewTab\.svelte$/,
    pattern: /defer_decision|<strong>Questions<\/strong>/,
    message: 'ProjectOverviewTab must not render source-specific owner-question actions. Link owner input to Thread.',
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
