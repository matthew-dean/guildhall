// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import OverviewTaskRow from '../OverviewTaskRow.svelte'

describe('OverviewTaskRow', () => {
  afterEach(() => cleanup())

  it('keeps full task titles in the DOM and relies on CSS for the three-line clamp', () => {
    const title = 'Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the remaining migration cards stay reviewable'

    render(OverviewTaskRow, {
      title,
      detail: 'Looma',
      chipLabel: 'Paused',
      chipTone: 'warn',
    })

    expect(screen.getByText(title)).toBeInTheDocument()

    const source = readFileSync('src/web/lib/OverviewTaskRow.svelte', 'utf8')
    const titleBlock = source.match(/\.row-head strong\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(source).not.toMatch(/title\.slice|title\.substring|title\.substr/)
    expect(titleBlock).toContain('display: -webkit-box')
    expect(titleBlock).toContain('line-clamp: 3')
    expect(titleBlock).toContain('-webkit-line-clamp: 3')
    expect(titleBlock).toContain('-webkit-box-orient: vertical')
    expect(titleBlock).toContain('overflow: hidden')
  })
})
