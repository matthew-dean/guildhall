// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { createRawSnippet } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Tooltip from '../Tooltip.svelte'

const buttonSnippet = createRawSnippet(() => ({
  render: () => '<button type="button">More</button>',
}))

describe('Tooltip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('positions itself on hover and hides when disabled', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 140,
      top: 200,
      bottom: 230,
      width: 40,
      height: 30,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    })

    const rendered = render(Tooltip, {
      text: 'Open project actions',
      placement: 'left',
      children: buttonSnippet,
    })

    await userEvent.hover(screen.getByRole('button', { name: 'More' }))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Open project actions')
    expect(tooltip).toHaveAttribute(
      'style',
      expect.stringContaining('right: 908px; top: 215px; transform: translateY(-50%);'),
    )

    await userEvent.unhover(screen.getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    rendered.rerender({
      text: 'Open project actions',
      placement: 'right',
      disabled: true,
      children: buttonSnippet,
    })

    await userEvent.hover(screen.getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
