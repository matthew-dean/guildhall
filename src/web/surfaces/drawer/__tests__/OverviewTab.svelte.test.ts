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

  it('shows shaping blockers from the task context packet', () => {
    render(OverviewTab, {
      props: {
        task: task({
          id: 'task-import-brief',
          title: 'Recover source-backed contract surface',
          status: 'import_draft',
        }),
        deliverySpine: {
          contextPacket: {
            whyThisNow: 'This task can continue after Guildhall repairs the source-backed brief.',
            executionOrder: {
              runnableNow: false,
              shapingBlockers: [
                {
                  code: 'imported_brief_shaping',
                  summary: 'Imported current work needs a real brief before Guildhall can build unattended.',
                },
                {
                  code: 'source_recovery',
                  summary: 'Needs concrete contract names before worker handoff.',
                },
              ],
            },
          },
        } as any,
      },
    })

    expect(screen.getByText('Not runnable yet')).toBeInTheDocument()
    expect(screen.getByText('Imported Brief Shaping')).toBeInTheDocument()
    expect(screen.getByText('Source Recovery')).toBeInTheDocument()
    expect(screen.getByText('Imported current work needs a real brief before Guildhall can build unattended.')).toBeInTheDocument()
    expect(screen.getByText('Needs concrete contract names before worker handoff.')).toBeInTheDocument()
  })
})
