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

  it('positions itself on hover, stays on-screen, and hides when disabled', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(32)
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
    expect(tooltip).toHaveAttribute('style', expect.stringContaining('left: 148px; top: 199px;'))
    expect(tooltip).toHaveAttribute('style', expect.stringContaining('transform: none;'))

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

  it('clamps the bubble inside the viewport near the right edge', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(220)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(160)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(160)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 190,
      right: 214,
      top: 4,
      bottom: 28,
      width: 24,
      height: 24,
      x: 190,
      y: 4,
      toJSON: () => ({}),
    })

    render(Tooltip, {
      text: 'This tooltip should not leave the viewport',
      placement: 'right',
      children: buttonSnippet,
    })

    await userEvent.hover(screen.getByRole('button', { name: 'More' }))
    const tooltip = screen.getByRole('tooltip')
    const style = tooltip.getAttribute('style') ?? ''
    const left = Number(style.match(/left: (\d+)px/)?.[1])
    const top = Number(style.match(/top: (\d+)px/)?.[1])
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 160).toBeLessThanOrEqual(212)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + 40).toBeLessThanOrEqual(152)
  })
})
