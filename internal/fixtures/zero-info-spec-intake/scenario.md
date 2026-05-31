# Zero-Information Spec Intake Scenario

This fixture is intentionally separate from Pantry Pulse. Pantry Pulse is the fixed-spec app completion proof. This scenario tests whether Guildhall can shape a useful initial spec and hierarchy when the directory itself contains no product information.

## Starting Point

Create an empty directory with no source files, no README, no `package.json`, no `guildhall.yaml`, and no meaningful project history.

Give Guildhall only this rough idea:

> I want to build a tiny pantry tracker app, but I have not chosen a stack or written anything down yet.

## Expected Behavior

- Guildhall orients the user that this is an empty directory without treating that as a failure.
- Guildhall proposes reasonable defaults when the owner has no preference.
- Guildhall asks only high-value questions about product intent, target user, platform or stack if genuinely needed, non-goals, and completion boundary.
- Guildhall creates an app-level containing work item and a first feature-level containing work item.
- Guildhall creates setup, implementation, and proof work underneath that hierarchy.
- Guildhall identifies the first safe runnable work item.
- The Thread explains what Guildhall inferred, what it still needs, and what it will do next in owner language.
- The Work list shows the blank-project idea as shaped work, not as a confusing special meta-intake state.

## Acceptance Criteria

- Starting from an empty directory, the user reaches a reviewed initial app spec and hierarchy without editing files manually.
- Every owner question is classified as necessary, avoidable, or non-delegable.
- No question asks the user to choose a Guildhall process path.
- The final shaped plan names the app goal, first feature, stack/tooling assumption or chosen default, non-goals, completion boundary, proof path, and first runnable work item.
- Any failure to infer reasonable defaults becomes a tracker follow-up.
