// @vitest-environment happy-dom
import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Icon from '../Icon.svelte'

describe('Icon', () => {
  it.each(['refresh-cw', 'list-todo'])('renders the shared %s icon token', name => {
    const { container } = render(Icon, { name: name as never })

    expect(container.querySelector('svg')).toBeTruthy()
  })
})
