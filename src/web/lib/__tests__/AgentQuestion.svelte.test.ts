// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentQuestion from '../AgentQuestion.svelte'
import type { AgentQuestion as AgentQuestionModel } from '../types.js'

function question(overrides: Partial<AgentQuestionModel> = {}): AgentQuestionModel {
  return {
    id: 'question-link-editor',
    taskId: 'task-link-editor',
    agentId: 'coordinator',
    kind: 'choice',
    prompt: 'Which controls belong in the link editor?',
    choices: [
      'URL input + Display text input',
      'URL input + Display text + Open in new tab',
      'URL input only (minimal)',
    ],
    ...overrides,
  }
}

describe('AgentQuestion', () => {
  it('answers single-choice questions from the inline thread card', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()

    render(AgentQuestion, {
      question: question(),
      onAnswer,
    })

    expect(screen.getByText('From the coordinator:')).toBeInTheDocument()
    expect(screen.getByText('Choose one')).toBeInTheDocument()
    expect(screen.getByText('Which controls belong in the link editor?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'URL input only (minimal)' }))

    expect(onAnswer).toHaveBeenCalledWith('URL input only (minimal)')
  })

  it('renders choice rows with a visible mark and label inside the thread card', () => {
    render(AgentQuestion, {
      question: question({
        choices: ['URL input + Display text + Preview + Remove link'],
      }),
      onAnswer: vi.fn(),
    })

    const row = screen.getByRole('button', { name: 'URL input + Display text + Preview + Remove link' })
    const mark = row.querySelector('.choice-mark')

    expect(mark).toBeInstanceOf(HTMLElement)
    expect(within(row).getByText('URL input + Display text + Preview + Remove link')).toBeInTheDocument()
  })

  it('supports multiple-choice questions without leaving the thread context', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()

    render(AgentQuestion, {
      question: question({
        prompt: 'Which of these should become real tasks? Choose all that apply.',
        selectionMode: 'multiple',
      }),
      onAnswer,
    })

    const first = screen.getByRole('button', { name: 'URL input + Display text input' })
    const second = screen.getByRole('button', { name: 'URL input + Display text + Open in new tab' })

    await user.click(first)
    await user.click(second)
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onAnswer).toHaveBeenCalledWith(
      'URL input + Display text input, URL input + Display text + Open in new tab',
    )
  })

  it('infers multi-select behavior from the prompt and can unselect a staged option', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()

    render(AgentQuestion, {
      question: question({
        prompt: 'Pick all that apply for the release checklist.',
      }),
      onAnswer,
    })

    const first = screen.getByRole('button', { name: 'URL input + Display text input' })
    const second = screen.getByRole('button', { name: 'URL input + Display text + Open in new tab' })
    await user.click(first)
    await user.click(second)
    await user.click(first)
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onAnswer).toHaveBeenCalledWith('URL input + Display text + Open in new tab')
  })

  it('opens the free-text reply path for Other without requiring the details pane', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()

    render(AgentQuestion, {
      question: question(),
      onAnswer,
    })

    await user.click(screen.getByRole('button', { name: 'Other...' }))
    const box = screen.getByRole('textbox')
    await user.type(box, 'Use existing link-popover controls')
    await user.click(within(document.body).getByRole('button', { name: 'Send' }))

    expect(onAnswer).toHaveBeenCalledWith('Use existing link-popover controls')
  })

  it('handles confirm, yes/no, and text questions with deterministic answers', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(AgentQuestion, {
      question: {
        kind: 'confirm',
        id: 'confirm',
        askedBy: 'coordinator',
        askedAt: '2026-05-19T15:00:00.000Z',
        restatement: 'Guildhall should build the link editor.',
      },
      onAnswer: onConfirm,
    })
    await user.click(screen.getByRole('button', { name: /looks right/i }))
    expect(onConfirm).toHaveBeenCalledWith('Yes, that’s right.')
    cleanup()

    const onYesNo = vi.fn()
    render(AgentQuestion, {
      question: {
        kind: 'yesno',
        id: 'yesno',
        askedBy: 'coordinator',
        askedAt: '2026-05-19T15:00:00.000Z',
        prompt: 'Should drag handles be in scope?',
      },
      onAnswer: onYesNo,
    })
    await user.click(screen.getByRole('button', { name: /^no$/i }))
    expect(onYesNo).toHaveBeenCalledWith('No')
    cleanup()

    const onText = vi.fn()
    render(AgentQuestion, {
      question: {
        kind: 'text',
        id: 'text',
        askedBy: 'coordinator',
        askedAt: '2026-05-19T15:00:00.000Z',
        prompt: 'What should the task focus on?',
      },
      onAnswer: onText,
    })
    await user.type(screen.getByRole('textbox'), 'Keep this to link editing only.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    expect(onText).toHaveBeenCalledWith('Keep this to link editing only.')
  })

  it('supports free-text corrections for confirm and yes/no questions', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(AgentQuestion, {
      question: {
        kind: 'confirm',
        id: 'confirm-correction',
        askedBy: 'coordinator',
        askedAt: '2026-05-19T15:00:00.000Z',
        restatement: 'Guildhall should migrate every surface in one pass.',
      },
      onAnswer: onConfirm,
    })
    await user.click(screen.getByRole('button', { name: /reply/i }))
    await user.type(screen.getByRole('textbox'), 'No, only the next documented batch.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    expect(onConfirm).toHaveBeenCalledWith('No, only the next documented batch.')
    cleanup()

    const onYesNo = vi.fn()
    render(AgentQuestion, {
      question: {
        kind: 'yesno',
        id: 'yesno-correction',
        askedBy: 'coordinator',
        askedAt: '2026-05-19T15:00:00.000Z',
        prompt: 'Should this include drag handles?',
      },
      onAnswer: onYesNo,
    })
    await user.click(screen.getByRole('button', { name: /reply/i }))
    await user.type(screen.getByRole('textbox'), 'Only if the existing roadmap says so.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    expect(onYesNo).toHaveBeenCalledWith('Only if the existing roadmap says so.')
  })

  it('renders inferred project maps as confirmation instead of ordinary choice chips', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()

    render(AgentQuestion, {
      question: question({
        prompt: 'Confirm coordinator domains, project areas, and review lanes.',
        choices: [
          'looma - component library',
          'knit - product app',
          'spec-agent',
        ],
      }),
      onAnswer,
    })

    expect(screen.getByText('Confirm only if needed')).toBeInTheDocument()
    expect(screen.getByText('Guildhall inferred this structure from the repo. Confirm it only if it looks materially wrong.')).toBeInTheDocument()
    expect(screen.getByText('looma')).toBeInTheDocument()
    expect(screen.getByText('component library')).toBeInTheDocument()
    expect(screen.getByText('Spec author')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /looks right/i }))
    expect(onAnswer).toHaveBeenCalledWith('looma - component library, knit - product app, spec-agent')
  })

  it('lets users correct inferred project maps and rewrites importer prompts into plain language', async () => {
    const user = userEvent.setup()
    const onProjectMap = vi.fn()
    render(AgentQuestion, {
      question: question({
        prompt: 'Confirm coordinator domains, project areas, and review lanes.',
        choices: ['docs/editor-roadmap - editor plan'],
      }),
      onAnswer: onProjectMap,
    })

    await user.click(screen.getByRole('button', { name: /correct it/i }))
    await user.type(screen.getByRole('textbox'), 'Looma owns editor primitives; Knit consumes them.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    expect(onProjectMap).toHaveBeenCalledWith('Looma owns editor primitives; Knit consumes them.')
    cleanup()

    render(AgentQuestion, {
      question: question({
        prompt: 'Workspace importer scanned the repo and found importable tasks.',
        choices: ['Mentions', 'Toolbar taxonomy'],
      }),
      onAnswer: vi.fn(),
    })

    expect(screen.getByText('Guildhall found planning notes across several project documents. Which of these should become real tasks? Choose all that apply.')).toBeInTheDocument()
    expect(screen.getByText('Choose any')).toBeInTheDocument()
  })
})
