# Guildhall Structure Surface: User-Facing Feature Spec

**Status:** Proposed redesign spec  
**Scope:** Project Structure tab, project graph presentation, work-area assignment, contracts, and cross-project handoffs  
**Example fixture:** Narrative Harness, used as one validation case only  

## Product Thesis

The Structure page should help a project owner understand the shape of a
project. It should not expose the project graph API, structural-domain records,
local project registry, or contract-surface storage model as raw UI concepts.

The current page fails because it is API-shaped. It presents internal objects
such as domains, searchable project index, contract surfaces, and dependency
edges as if those terms are self-explanatory. They are not. A user arriving on
Structure is not asking "what records are in the project graph response?" They
are asking:

- What is this project made of?
- What does Guildhall think each part means?
- What work belongs here?
- What work could or should move to another project?
- What contracts or handoffs cross project boundaries?
- What can I do next?

The redesigned Structure feature should answer those questions directly.

## Core User Needs

### 1. See the project's shape visually

User need: "I want to see a graphical chart of my structure."

The first meaningful surface should be a visual structure chart, not a stack of
cards. The chart should make the project shape legible at a glance:

- current project as the central node;
- user-facing work areas around it;
- contracts as explicit contract nodes only when tracked;
- external projects only when actually connected;
- handoff edges only when there is a real provider/consumer request;
- no local registry projects shown as graph nodes unless they are connected.

For Narrative Harness, the center should be "Narrative Harness." Around it,
Guildhall may show areas such as story coherence, writing workflow, specs and
planning, product direction, and harness/runtime work. Those labels must be
written for users. Internal labels such as `Coherence`, `Meta`, or `Specs` can
exist as quiet metadata, not as the primary name.

Acceptance criteria:

- The Structure page has an actual chart or graph in the first viewport.
- The chart is understandable without reading API terms elsewhere on the page.
- Unconnected registered projects do not appear in the chart.
- Empty contracts and empty handoffs do not create meaningless chart clutter.

### 2. Understand what each work area means

User need: "Do not show me internal names like Coherence and expect me to know
what they mean."

Work areas need a display model separate from internal graph identifiers. A
work area should have:

- user-facing title;
- one-sentence explanation;
- internal id or coordinator label as quiet metadata;
- ownership summary;
- assignment availability only when there is a real action.

Example:

| Field | Value |
| --- | --- |
| User-facing title | Story coherence and reviewer quality |
| Explanation | Checks whether writing changes preserve voice, continuity, character behavior, and scene logic. |
| Internal metadata | domain:coherence, routed by coherence-lenses |
| Local ownership | Narrative Harness owns fiction-specific quality criteria and author taste. |
| Reusable capability | Reviewer tooling could be assigned to another project. |

The UI should never lead with `Coherence` as the main label unless the user has
chosen an expert/internal view.

Acceptance criteria:

- Every work area has a user-facing title and explanation.
- Internal identifiers are demoted to metadata.
- Bare internal domain labels do not appear as standalone primary UI.

### 3. Know what belongs inside this project

User need: "What work stays here?"

Structure should make local ownership explicit. For each work area, the page
should say what the current project owns and why. This is especially important
for fiction-first projects such as Narrative Harness, where reusable tooling
may live elsewhere but taste, quality criteria, source-of-truth context, and
acceptance criteria remain local.

The UI should group local ownership in one of two ways:

- in the visual chart, via local nodes inside the project boundary;
- in a flat Work Areas table, via an "Owned here" column.

Example copy:

"Narrative Harness owns story-specific acceptance criteria, author voice
expectations, continuity rules, and source-backed fiction context."

Acceptance criteria:

- The page clearly distinguishes local project responsibilities from reusable
  provider capabilities.
- "Owned here" is readable as an explanation, not a status chip.
- Local ownership is visible before assignment controls.

### 4. Assign reusable work to another project

User need: "I want to assign my design-system development to another project."

This needs to be an obvious workflow. It should not be hidden behind a row that
looks selectable or a passive pseudo-chip such as "Available to assign."

Primary action:

`Assign reusable work`

This action can appear:

- as a main action in the "Boundaries and assignments" section;
- as a row action next to a specific reusable capability;
- as an action in the chart when selecting an assignable capability node.

The assignment flow should be guided:

1. Choose the reusable capability.
2. Choose the provider project.
3. Confirm what moves to the provider.
4. Confirm what remains local in the current project.
5. Create or update the provider/consumer relationship.

The local project registry belongs inside this flow. It should not be a
top-level section called "Searchable project index." A user does not need to
care that projects are searchable. They need to choose a provider when they are
assigning work.

Example assignment flow:

- Capability: "Design-system component development"
- Provider project: "Guildhall"
- Moves: "Reusable UI primitives, component contracts, token decisions"
- Stays in Narrative Harness: "Fiction workflow requirements and acceptance
  criteria"
- Result: "Narrative Harness depends on Guildhall for design-system component
  development"

Acceptance criteria:

- Assignment uses real buttons with verb labels.
- "Available to assign" does not appear as a fake chip or pseudo-button.
- Searchable project index is hidden inside the assignment modal or picker.
- The user can tell what will move and what will stay before confirming.

### 5. See contracts and create or discover them

User need: "If I have no contract surfaces, can I do anything about that?"

An empty "Contract surfaces" section with no action is dead UI. The Contracts
section should explain what a contract is and offer useful actions.

Contracts are durable boundaries Guildhall should preserve across work:

- API contracts;
- schema contracts;
- component contracts;
- design-system contracts;
- review-packet contracts;
- source-backed context contracts.

Empty state copy:

"No contracts are tracked yet. Contracts are the APIs, schemas, components, or
review expectations Guildhall should preserve across work."

Actions:

- `Scan for contracts`
- `Declare contract`

`Scan for contracts` asks Guildhall to inspect the project and propose likely
contracts. `Declare contract` lets the user or coordinator define one
explicitly.

Acceptance criteria:

- Empty contracts state has explanatory copy and at least one useful action.
- Contract actions use verbs.
- Contract creation does not require the user to know the phrase "contract
  surface."

### 6. See handoffs with other projects

User need: "What is waiting on another project? Is another project waiting on
this one?"

Dependency requests should be presented as project handoffs, not graph jargon.
A handoff is a relationship between this project and another project:

- outgoing: this project needs a provider delivery;
- incoming: another project needs this project to provide something;
- returned: provider delivered something, but consumer verification failed;
- accepted: consumer accepted the delivery.

Example copy:

"Narrative Harness is waiting on Guildhall for design-system components."

"No active handoffs. Narrative Harness is not waiting on another project, and
no other project is waiting on Narrative Harness."

Acceptance criteria:

- The section is called "Project handoffs" or similar user-facing language.
- Handoffs use provider/consumer terms only after explaining what they mean.
- Empty handoffs state explains that nothing is needed.

### 7. Know what action is possible

User need: "What can I do here?"

Every section should have one of three outcomes:

1. It shows a real action.
2. It explains why no action is needed.
3. It is hidden because it is not relevant.

No section should show inert internal facts and leave the user to guess why
they matter.

Examples:

- Work area row with reusable provider capability: `Assign`
- Contracts empty state: `Scan for contracts`, `Declare contract`
- Handoffs empty state: no button, clear "No active handoffs" explanation
- Project registry: hidden until assignment flow

Acceptance criteria:

- No pseudo-action statuses such as "Available to assign."
- No clickable container whose only behavior is selecting a row and revealing
  another card.
- If something looks clickable, it performs a clear user-facing action.

## Proposed Information Architecture

### Page header

Title: `Structure`

Description:

"What Guildhall understands about Narrative Harness: its work areas, project
boundaries, contracts, and handoffs."

The header should not include dumped navigation buttons. If intra-page
navigation is needed later, it should be secondary, quiet, and only after the
page has enough length to justify it.

### Primary visual: Project structure chart

This is the anchor of the page.

Required chart elements:

- current project boundary;
- work-area nodes;
- optional contract nodes;
- optional connected project nodes;
- optional handoff edges;
- legend explaining node and edge types.

The chart should be pleasant and readable:

- no dark dense graph hairball;
- no arbitrary force layout for small graphs;
- stable deterministic layout;
- central project with radial or grouped surrounding areas;
- clear labels, not raw ids;
- empty states drawn gracefully.

For Narrative Harness with no external handoffs, the chart should still be
useful. It can show the current project boundary and work areas, while clearly
stating that no external projects are connected.

### Work areas

Flat list or table. Not cards inside cards. Not selectable mega-cards.

Columns:

- Area
- What it means
- Owned here
- Reusable capability
- Action

Rows should be calm and dense enough to scan. Row actions should be explicit.
If there is no action, the action cell says "No action needed" or remains empty
with accessible text.

### Boundaries and assignments

Purpose: show what stays inside the project and what can cross the boundary.

Content:

- "Owned by Narrative Harness"
- "Can be assigned"
- "Already assigned"
- "Connected projects"

This section should not show the searchable local project index. It may show
connected projects only when a relationship exists.

Primary action:

`Assign reusable work`

### Contracts

Purpose: show durable boundaries Guildhall should preserve.

States:

- Empty: explain contracts and offer scan/declare actions.
- Non-empty: list contracts with kind, owner, related work area, last updated,
  and action to review/edit.

Actions:

- `Scan for contracts`
- `Declare contract`
- `Review contract`

### Project handoffs

Purpose: show incoming/outgoing provider-consumer work.

States:

- Empty: "No active handoffs."
- Active: list handoffs with direction, other project, what is needed, waiting
  on whom, and next action.

Actions:

- `Review handoff`
- `Accept delivery`
- `Return delivery`
- `Open provider plan`

## Visual And Interaction Principles

### Make the page feel like a map

Structure should have one strong visual anchor. The chart gives the user a
mental model before asking them to inspect details.

### Keep sections flat

Avoid card-within-card layouts. Use:

- one chart region;
- flat tables/lists;
- separators;
- quiet metadata;
- actions in consistent locations.

Cards may frame major sections, but individual rows inside a card should not
look like separate clickable cards unless the row action is genuinely the
primary interaction.

### Use chips only for status

Chips and pills are not actions. They should communicate stable status such as
"accepted", "waiting on provider", or "assigned." They should not communicate
"Available to assign" because that reads like something the user should click.

If the user can do something, use a button.

### Use human labels before internal labels

Internal labels are metadata. The main label should be understandable:

- Good: "Story coherence and reviewer quality"
- Metadata: `coherence-lenses`
- Bad: "Coherence"

### Explain terms where the user encounters them

Use inline help for:

- work areas;
- contracts;
- project handoffs;
- provider;
- consumer;
- assignment.

Help should be short and contextual. A circled question icon is appropriate
when it opens a small explanatory modal or popover. It should not be the only
way to understand the page.

## Data Requirements

The existing project graph data is not enough as-is because it lacks
user-facing presentation fields. Add or derive a presentation model:

```ts
type StructureView = {
  project: {
    id: string
    name: string
    path?: string
  }
  chart: StructureChart
  workAreas: StructureWorkArea[]
  boundaries: StructureBoundarySummary
  contracts: StructureContractSummary[]
  handoffs: StructureHandoffSummary[]
  actions: StructureAction[]
}

type StructureWorkArea = {
  id: string
  title: string
  internalLabel?: string
  description: string
  ownedHere: string
  reusableCapability?: {
    id: string
    title: string
    description: string
    assignedToProjectId?: string
    assignedToProjectName?: string
    canAssign: boolean
  }
}
```

The view builder should live in shared runtime/API code, not in the Svelte
component. The UI should render the presentation model.

## Implementation Direction

1. Build a `StructureView` API model from project graph data.
2. Add user-facing label and description derivation for work areas.
3. Build the chart as the first section.
4. Replace domain cards with a flat Work Areas list.
5. Move project index search into assignment flow.
6. Add assignment flow copy that explains what moves and what stays local.
7. Add contract empty-state actions.
8. Rename dependency requests to project handoffs in user-facing UI.
9. Add tests that reject API-shaped labels and dead actions.

## Multi-Project Validation Matrix

The redesign must not be over-fit to Narrative Harness. Narrative Harness is a
useful fixture because it exposes the current API-shaped failure clearly, but
Structure is a general Guildhall feature. The implementation should be tested
against several project shapes before it is treated as complete.

### Required Fixtures

Use at least these project types during implementation and browser review:

| Fixture | Why it matters | Structure should prove |
| --- | --- | --- |
| Narrative Harness | Docs/spec-heavy, fiction-first project with no connected projects yet. | Structure remains useful without contracts or handoffs; work areas get human labels; unconnected projects stay out of the chart. |
| Guildhall | Product/runtime-heavy project with UI, runtime, design-system, and project-graph boundaries. | Structure can surface code/product/runtime areas, probable contracts, and meaningful internal boundaries without becoming a raw API graph. |
| Jess | Codebase/compiler-heavy project where packages, parser/evaluator phases, fixtures, and tests matter more than docs domains. | Structure can reflect real code/module/test shape, not only docs folders or coordinator labels. |
| LinkCore / Booklinker | App/product workflow with marketplace, matching, integration, and external-service boundaries. | Structure can show product workflows, external service contracts, and assignment/handoff candidates clearly. |
| Fair Labor License | Commerce/legal/payment project with Stripe and license-policy boundaries. | Structure can show legal/commercial/payment contracts without pretending they are ordinary code modules. |

### Cross-Fixture Questions

For every fixture, review the same questions:

- Does the first viewport explain what the project is made of?
- Does the chart reveal real project shape rather than internal storage shape?
- Are work areas named in user-facing language?
- Are internal labels demoted to metadata?
- Does the page show the right source of structural truth for the project:
  docs, code modules, packages, tasks, contracts, or handoffs?
- Are connected projects shown only when actually connected?
- Are empty contracts and handoffs still useful?
- Are assignment actions obvious when reusable work exists?
- Is the page useful when there are zero contracts or zero handoffs?
- Is the page useful for code-heavy projects, not only docs-heavy projects?

### Validation Requirement

Implementation is not complete until at least three fixture classes pass live
browser review:

1. one docs/spec-heavy project;
2. one code/module-heavy project;
3. one product/integration or commerce/external-service project.

The review notes should record what the page surfaced, what it hid, which
actions were available, and whether any internal/API-shaped labels leaked into
the primary UI.

## Tests And Review Gates

Regression tests should assert:

- no "Searchable project index" top-level heading;
- no bare internal area names as primary row labels for known fixtures;
- no "Available to assign" pseudo-chip;
- no selectable domain row that reveals another domain card;
- no top-level local registry list unless a project is connected;
- empty contracts section has `Scan for contracts` and `Declare contract`;
- no unconnected local projects in the chart;
- chart exists on Structure;
- assign flow can assign a reusable capability to another project;
- every visible button has a real action and user-facing verb.

Browser review should verify:

- first viewport shows a clear chart;
- page can be understood without clicking anything;
- actions are visually obvious;
- empty states are useful;
- no card-within-card density in normal states;
- no ambiguous chips or pseudo-buttons.
- at least three project shapes from the validation matrix pass browser review.

## Non-Goals

- Do not expose the local project registry as a top-level section.
- Do not require the user to understand project graph internals.
- Do not show external projects unless they are actually connected.
- Do not use selectable rows to reveal duplicate cards.
- Do not make contracts a dead empty state.
- Do not add visual polish before defining user actions.

## Product Summary

Structure should be a map and boundary manager.

It should show:

- the project shape;
- what each work area means;
- what belongs here;
- what can move;
- what contracts exist or can be discovered;
- what project handoffs are active;
- what action the user can take.

Everything else is internal plumbing and should remain hidden until a real
workflow needs it.
