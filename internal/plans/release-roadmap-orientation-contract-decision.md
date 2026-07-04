# Release Roadmap Orientation Contract Decision

## Contract Touch Decision

- Work id: `release-roadmap-orientation`
- Touched contracts: project map UI component contract, project overview UI component contract, project orientation spine API shape.
- Contracts considered but not touched: task queue schema shape, workspace-import draft schema shape, selected-release start semantics.
- Required follow-up: keep `selectedRelease` as the execution boundary while exposing `releases` as the owner-visible roadmap. Later release membership must not make later work runnable.
- Proof required: focused workspace-import/orientation tests, production build, contract detector, installed-app API proof for Narrative Harness and Looma/Knit.
- Proof provided: focused tests and build are recorded in the implementation turn; installed-app API proof is required before committing.
- Waivers: broad Vitest suite currently has unrelated failures outside this change; focused touched tests must pass.
- Owner-review items: verify that Project map communicates release sequence and selected scope without implying the whole project or headless MVP is complete.
- Apply/revert behavior: revert importer release tagging, `ProjectOrientationSpine.releases`, and the Project map/Overview roadmap presentations together if the release roadmap creates misleading execution scope.
