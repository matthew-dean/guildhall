# Stage: `parent`

The task has been split. This record is the parent container, and the runnable
work now lives in linked child tasks.

## What "good" looks like

- **Do not dispatch the parent.** The parent keeps the original ask, spec, and
  hierarchy readable; workers should pick up child tasks instead.
- **Keep the child tasks linked.** Each child should share the parent goal and
  preserve dependency order when one child must happen before another.
- **Use the parent for orientation.** The parent is where a reviewer can see why
  the work was split, what tasks were created, and how they fit together.

## How this stage is evaluated

- The parent is healthy when its child tasks exist, are inspectable, and cover
  the promised work without turning back into one oversized task.

## Handoff

- Coordinators and workers move through the child tasks. The parent closes only
  when the linked work has landed or when the plan is deliberately retired.
