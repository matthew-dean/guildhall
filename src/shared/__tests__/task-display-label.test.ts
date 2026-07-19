import { describe, expect, it } from 'vitest'
import { effectiveTaskTitle, taskDisplayLabel, taskSourceQuestion } from '../task-display-label.js'

describe('taskDisplayLabel', () => {
  it('derives an action-shaped label for question-shaped smoke-test command work', () => {
    const task = {
      id: 'task-009',
      title: 'What commands should I run to smoke test this project without changing files?',
      description: 'What commands should I run to smoke test this project without changing files?',
    }

    expect(taskDisplayLabel(task)).toBe('Define safe smoke-test commands')
    expect(taskSourceQuestion(task)).toBe('What commands should I run to smoke test this project without changing files?')
  })

  it('recovers complete legacy clipped titles before deriving question-shaped work labels', () => {
    expect(taskDisplayLabel({
      id: 'task-smoke-test',
      title: 'What commands should I run to smoke test this project without changin...',
      description: 'What commands should I run to smoke test this project without changing files?',
    })).toBe('Define safe smoke-test commands')
  })

  it('recovers complete titles from source-prefixed imported descriptions', () => {
    const task = {
      id: 'task-import-1v8sume',
      title: 'Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the',
      description: 'looma/PROJECT_STATE.md: 3. Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the primitive normalization wave continues in Knit.',
    }

    expect(effectiveTaskTitle(task)).toBe('Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the primitive normalization wave continues in Knit.')
    expect(taskDisplayLabel(task)).toBe('Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the primitive normalization wave continues in Knit.')
  })

  it('recovers imported titles when the source line uses markdown inline code', () => {
    const task = {
      id: 'task-import-2h8fxk',
      title: 'Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lowe',
      description: 'looma/docs/component-roadmap.md: - Keep `ui-top-bar`, `ui-search-shell`, and `ui-search-result-row` as recipe-level primitives rather than forcing them into lower-level generic atoms',
    }

    expect(effectiveTaskTitle(task)).toBe('Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lower-level generic atoms')
  })
})
