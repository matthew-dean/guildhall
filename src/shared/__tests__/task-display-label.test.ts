import { describe, expect, it } from 'vitest'
import { taskDisplayLabel, taskSourceQuestion } from '../task-display-label.js'

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
})
