# Ready State And Decomposition Model

## Problem

`ready` currently means too many things. In the work view it can mean "visible in the work queue," "roughly understood," "approved enough to continue," or "a worker can start now." Those are not interchangeable. If a task still needs decomposition, scope tightening, acceptance criteria cleanup, proof-path selection, or child task materialization, it is not worker-ready.

The Narrative Harness work queue exposed this directly: broad top-level tasks had no child tasks, no stored decomposition proposal, and many acceptance criteria, but still displayed as `Ready`. That made the interface imply a worker could safely start, even though the next useful action was to review and create a breakdown.

## State Semantics

Use `ready` only for runnable leaf work:

- The task has one deliverable.
- The scope can be assigned to one worker without hidden sub-decisions.
- The acceptance criteria belong to that one deliverable.
- The proof path is local to that deliverable.
- Required context and constraints are attached.
- There is no pending decomposition proposal or unresolved shaping gate.

Use a separate shaping/decomposition state when the task is not runnable yet:

- `needs_breakdown`: Guildhall believes the work would benefit from child tasks, but no proposal exists yet.
- `breakdown_review`: Guildhall has a proposed child-task set and needs review before materializing it.
- `parent`: The task governs child tasks and aggregates their state; it is not itself runnable worker work.
- `spec_review`: The scope/spec needs approval or correction before either decomposition or execution.

`ready` should not be a parent-level status. A parent can be healthy, unblocked, and actively progressing, but its status should be derived from children rather than pretending the parent itself is a leaf task ready to run.

## UI Rules

- In work views, show the next action, not only the stored raw status.
- If a task is broad, flat, and lacks a decomposition proposal, surface `Review breakdown` or `Needs breakdown` instead of presenting it as simply `Ready`.
- Do not render proposed children in the main Work tree unless they are actual tasks.
- If a proposed decomposition exists, show it in a separate review surface with clear create/edit/reject actions.
- If no proposal exists, the child column should say that honestly.
- Titles must only be truncated at display time; persisted titles stay untouched.

## Runtime Rules

- Intake and task shaping should produce structured decomposition records, not child titles from examples or keyword-triggered templates.
- Decomposition should be semantic and deliverable-based: each proposed child should have one outcome, local requirements, local proof, and clear dependencies.
- Materializing a decomposition should create actual task records, link them through `hierarchy.parentId` and `hierarchy.childIds`, and move the parent to an aggregate/governing state.
- Parent completion is derived from child completion and review gates.
- A task can become `ready` only after decomposition gates, spec gates, and proof-path gates are satisfied for that leaf.

## Regression Coverage

- Broad flat work with many structured requirements and no children is not displayed as runnable `Ready` in Columns view.
- Actual child tasks appear in the Work tree; proposed children do not appear there until materialized.
- Materializing children updates parent/child hierarchy links.
- Child status changes roll up to parent state.
- Grandchild status changes roll up through every ancestor.
- Rejecting a decomposition keeps the task out of runnable `ready` until it is reshaped or explicitly approved as a leaf.
