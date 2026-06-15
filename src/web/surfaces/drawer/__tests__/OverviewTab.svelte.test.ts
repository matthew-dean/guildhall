// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import OverviewTab from '../OverviewTab.svelte'
import type { Task } from '../../../lib/types.js'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-import-review',
    title: 'Import review flow',
    description: 'Review imported project material and shape the resulting work.',
    status: 'ready',
    domain: 'project',
    priority: 'normal',
    ...overrides,
  } as Task
}

describe('OverviewTab', () => {
  afterEach(() => cleanup())

  it('shows delivery steps as task detail instead of separate task links', () => {
    render(OverviewTab, {
      props: {
        task: task(),
        workProgress: {
          deliverySteps: [
            {
              id: 'task:runtime-proof',
              title: 'Runtime proof',
              kind: 'verify',
              status: 'blocked',
              required: true,
              blocksCompletion: true,
              sourceTaskId: 'runtime-proof',
            },
          ],
          rollup: {
            primaryState: 'blocked',
            visibleChildCount: 0,
            visibleChildDoneCount: 0,
            internalStepCount: 1,
            requiredStepCount: 1,
            doneStepCount: 0,
            blockedStepCount: 1,
          },
        },
      },
    })

    expect(screen.getByText('Delivery steps')).toBeInTheDocument()
    expect(screen.getByText('1 delivery step blocked')).toBeInTheDocument()
    expect(screen.getByText('Runtime proof')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
  })
})
