---
title: HTML artifacts and agent UI protocol
---

# HTML artifacts and agent UI protocol

**Status:** `0.7.0` guardrail seed, `0.8.0` feature candidate

**Release scope:** use
`internal/plans/archive/2026-05-24-guildhall-0-8-mvp-tracker.md` as the historical 0.8.0
MVP source of truth. Only the smallest already-tested artifact proof belongs in
0.8.0; the richer generated UI protocol is deferred to 0.9.0 or later.

This note explores whether Guildhall should move beyond Markdown for agent
communication and planning artifacts. It is inspired by Claire Vo's ChatPRD
interview with Thariq Shihipar about using HTML with Claude Code, plus a local
review of Guildhall's current markdown renderer and Thread/task surfaces.

## External Idea

The strongest version of the idea is not "HTML is prettier Markdown." It is:

- long agent plans become unreadable when they stay as walls of text;
- humans stay more engaged when plans are visual, navigable, and editable;
- disposable micro-interfaces can be generated for one planning/editing job;
- a design system can travel as a rendered, inspectable artifact rather than
  only as prose;
- the human role shifts toward deciding where compute is worth spending, so the
  interface for reviewing plans matters.

The ChatPRD recap emphasizes three workflows: HTML brainstorming/planning,
custom micro-apps for editing plan sections, and living design-system HTML
artifacts. Apple Podcasts' episode notes add the useful framing that complexity
has to earn its keep and that HTML is valuable when it keeps the human in the
loop without over-constraining the model.

I was able to retrieve the YouTube auto-generated transcript locally with the
`youtube-transcript` package. YouTube's direct timed-text endpoint returned an
empty body, and Podwise's public transcript API returned `500`, but the package
returned 1,069 caption items / about 38k characters. The transcript confirms
the main themes from the recap: markdown plans get too long to read, plans/specs
still matter, HTML is used to make plans more engaging, and editable HTML
micro-tools let the human refine a specific part of a plan before feeding the
result back into the agent workflow.

## Current Guildhall Reality

Guildhall does not currently use Markdown as a full UI protocol. It uses
Markdown for small-to-medium text fields inside an already-structured Svelte UI.

Markdown currently appears in:

- task titles in a few inline contexts;
- task descriptions and imported source excerpts;
- product brief fields;
- spec previews;
- acceptance criteria text;
- coordinator questions and choices;
- reviewer reasoning and escalation details;
- transcript entries and durable task notes;
- source-note previews;
- progress summaries.

Thread, Current task, Work, Settings, Inbox, and the drawer already use typed
Svelte components for the important interactive surfaces: cards, chips,
question choices, staged answers, source-note buttons, checklists, task
actions, modals, tabs, and route-aware navigation. That is a good thing.
Replacing those with arbitrary agent HTML would make the product less
deterministic, harder to test, and harder to keep visually coherent.

The local review also found a separate hardening issue: our Markdown comment
said `marked` escaped raw HTML, but the installed `marked` version preserves
raw HTML. That means rich HTML must not be treated as "already solved" by the
current renderer. Plain Markdown needs sanitization, and rich agent HTML needs
a stricter, separate path.

## Recommendation

Do not make "agents talk to Guildhall in HTML" the default.

Do introduce a rich artifact lane for `0.8.0`:

> Agents may produce a validated, versioned UI artifact when the work benefits
> from layout, visualization, interactivity, diagrams, or a temporary editor.
> Ordinary task copy and conversation stay as Markdown or structured JSON.

The product bet is not HTML everywhere. The bet is a **Guildhall agent UI
protocol**:

- Markdown remains the cheap, readable format for prose.
- Structured JSON remains the contract for state transitions and deterministic
  actions.
- Rich artifacts become optional, inspected assets for plans, reviews, design
  systems, diagrams, and high-complexity decisions.

## Where HTML Is Worth It

HTML or HTML-like artifacts are likely worth it for:

- **Blueprint views:** project plan, release map, dependency map, active
  tranche, and change-order impact.
- **Review dashboards:** visual evidence grouped by severity, area, persona,
  source file, and proposed action.
- **Design-system artifacts:** tokens, component states, spacing rules, and
  examples that agents and humans can inspect.
- **Source-note explanation views:** a rendered source note with anchored
  excerpts, inferred tasks, confidence, and next-step options.
- **Disposable plan editors:** custom one-off UIs for narrowing migrations,
  taxonomy rules, release sequencing, or task-splitting decisions.
- **Diagrams:** safe SVG or declarative diagrams where a table or list is too
  weak.

HTML is probably not worth it for:

- short task titles;
- small descriptions;
- ordinary coordinator questions;
- acceptance criteria;
- status messages;
- simple transcript turns;
- logs, checkpoints, and audit history.

In those places, HTML would add token cost and attack surface without adding
much user value.

## Pros

- **Better human engagement:** complex plans become something the user can scan,
  filter, and manipulate instead of avoiding.
- **More precise review:** an agent can show hierarchy, grouping, risk, and
  dependencies visually.
- **Fewer chat ping-pongs:** a micro-editor can turn an ambiguous back-and-forth
  into a bounded interaction with copy-out structured output.
- **Reusable project knowledge:** design-system and blueprint artifacts can
  become durable project context.
- **Better "factory floor" views:** rich artifacts fit the zoom-in/zoom-out
  project-state idea better than a linear Thread.

## Cons

- **Security:** raw HTML, event handlers, scripts, style injection, external
  URLs, SVG, and custom elements are all riskier than Markdown.
- **Visual drift:** agents can generate UI that clashes with Guildhall's design
  system unless components are constrained.
- **Testing complexity:** arbitrary render trees are harder to cover than typed
  Svelte components.
- **Token cost:** HTML is verbose; using it for everything would spend output
  tokens on markup instead of thinking.
- **State ambiguity:** interactive HTML can create hidden local state unless it
  emits explicit, auditable events back to Guildhall.
- **Accessibility:** custom generated layouts may fail keyboard, screen reader,
  and focus expectations unless rendered through known components.

## Proposed 0.8.0 Shape

### 0. 0.7.0 Minimum Seed

For `0.7.0`, Guildhall should only establish the contract and guardrail:

- keep ordinary Markdown sanitized and prose-only;
- add a `guildhall-html-v1` schema for rich artifacts;
- require `title`, `fallbackMarkdown`, `createdBy`, and `schemaVersion`;
- validate a strict allowlist of structural tags and safe attributes;
- recognize only these component request tags:
  - `gh-checklist`
  - `gh-step`
  - `gh-decision`
  - `gh-option`
- compile the accepted artifact into a typed render-tree summary;
- reject scripts, inline event handlers, inline styles, iframes, unknown
  `gh-*` tags, and unsafe URL schemes.

This is intentionally not a user-visible renderer yet. It gives tests and
agent contract work a real target while preventing "rich content" from slipping
through the Markdown path.

### 1. Harden Plain Markdown

Plain Markdown should remain allowed, but rendered output must be sanitized.
The Markdown renderer should allow normal prose tags and safe links only.
Anything richer belongs in the artifact lane.

### 2. Define `guildhall-html-v1`

Create a content type for rich artifacts:

```json
{
  "contentType": "guildhall-html-v1",
  "artifactKind": "blueprint | review | design-system | micro-editor | diagram",
  "title": "Release plan",
  "html": "...",
  "fallbackMarkdown": "...",
  "createdBy": "coordinator-agent",
  "schemaVersion": 1
}
```

### 3. Use a Strict Allowlist

Allow a small HTML subset:

- text structure: `section`, `article`, `header`, `h1`-`h4`, `p`, `ul`, `ol`,
  `li`, `blockquote`, `code`, `pre`, `table`, `thead`, `tbody`, `tr`, `th`,
  `td`, `details`, `summary`;
- formatting: `strong`, `em`, `small`, `span`;
- safe links through Guildhall's link component;
- safe SVG only in a diagram sandbox or after strict SVG sanitization;
- no scripts, inline event handlers, arbitrary styles, iframes, forms, or
  external network loads.

### 4. Prefer Custom Elements as Component Requests

Do not let agents invent arbitrary UI behavior. Let them request known
Guildhall components:

```html
<gh-checklist title="Spec readiness">
  <gh-step status="done">Title is specific</gh-step>
  <gh-step status="needs-human">Success signal is unclear</gh-step>
</gh-checklist>

<gh-decision id="migration-scope" mode="single">
  <gh-option value="next-batch" recommended="true">Next batch only</gh-option>
  <gh-option value="all">All remaining surfaces</gh-option>
</gh-decision>
```

Internally, Guildhall should parse these tags into a typed render tree and map
them to Svelte components. The agent writes an interface-shaped artifact; the
app still owns rendering, behavior, focus, design tokens, and emitted events.

### 5. Make Interactions Auditable

Every interactive rich artifact must emit deterministic events:

- `artifact.answer_staged`
- `artifact.answer_submitted`
- `artifact.section_expanded`
- `artifact.copy_out`
- `artifact.change_order_requested`

No hidden "micro-app state" should become project truth until Guildhall records
the event in task/project state.

### 6. Store Dual Representations

Rich artifacts should persist:

- original agent artifact source;
- sanitized/compiled render tree;
- markdown fallback;
- extracted text summary for search and model context;
- validation errors/warnings;
- artifact hash and creator.

This keeps artifacts inspectable, diffable, and recoverable if the renderer
changes.

## 0.8.0 Candidate Slices

Earlier sketch, preserved from the first planning note:

1. **Markdown hardening:** sanitize current renderer and document the plain
   Markdown contract.
2. **Artifact model:** add a persisted `ARTIFACTS.json` or per-task artifact
   folder with content type, fallback, and provenance.
3. **Read-only rich artifacts:** render sanitized `guildhall-html-v1` in a
   drawer tab with no interactivity.
4. **Component-tag renderer:** support a tiny set of `gh-*` tags mapped to
   existing Svelte components.
5. **Interactive artifact events:** allow `gh-decision` and `gh-checklist` to
   submit deterministic answers.
6. **First real use case:** generate a project blueprint / release map artifact
   for Looma + Knit, where Thread is currently too crowded.

Updated implementation slices:

1. **Artifact persistence:** add a project/task artifact store with original
   source, compiled render tree, fallback Markdown, validation result,
   provenance, and hash.
2. **Read-only renderer:** map the typed render tree to Svelte components in a
   drawer tab. Do not render arbitrary HTML strings.
3. **Thread affordance:** show a compact artifact preview on the relevant task
   card with one clear "Open artifact" action.
4. **Component-tag expansion:** add tested render support for `gh-checklist`,
   `gh-decision`, `gh-table`, and a simple diagram primitive.
5. **Interactive artifact events:** allow `gh-decision` and checklist actions
   to emit auditable task/project events.
6. **Agent prompt contract:** teach coordinator/spec/reviewer agents when to
   produce Markdown, JSON state, or a rich artifact.
7. **First real use case:** generate a project blueprint / release map artifact
   for Looma + Knit, where Thread is currently too crowded.
8. **Browser proof:** cover artifact open, fallback rendering, keyboard focus,
   and event submission with Playwright.

## Required Tests Before User-Visible Rich Artifacts

- Schema tests for required metadata and allowed artifact kinds.
- Validator tests for rejected tags, unsafe attributes, unknown `gh-*` tags,
  unsafe URLs, scripts, styles, iframes, forms, and SVG unless explicitly
  sandboxed.
- Compiler tests showing known `gh-*` tags become typed render-tree nodes.
- Persistence tests showing source, compiled tree, fallback, provenance, hash,
  and validation errors survive a service restart.
- Renderer tests showing Svelte components render the typed tree without using
  raw `{@html}` for interactive content.
- Event tests proving artifact interactions emit deterministic events rather
  than hidden local state.
- Agent fixture tests with representative coordinator/spec/reviewer outputs:
  one valid blueprint, one valid review dashboard, and several invalid
  artifacts with useful errors.
- Browser tests for opening an artifact from Thread/drawer, fallback behavior,
  keyboard navigation, and no visual collision with surrounding task cards.

## Open Questions

- Should rich artifacts live in project memory, task history, or both?
- Should agents produce HTML directly, or should they produce a JSON render tree
  that can be serialized as HTML for readability?
- How much SVG should be allowed, and should SVG always be isolated?
- Can the same component-tag protocol power public docs examples and in-app
  Thread artifacts?
- Should rich artifacts be reviewed by a UI/design persona before becoming
  visible to the user?
- What is the token budget threshold where Guildhall should ask for a rich
  artifact instead of Markdown?

## Current Bias

HTML is probably more than Guildhall needs for ordinary Thread copy. But the
underlying idea is very relevant: some agent work should produce an interface,
not a paragraph.

The right `0.8.0` direction is not "replace Markdown with HTML." It is:

> Keep Markdown for prose, keep JSON for state, and add a constrained rich
> artifact protocol for plans, diagrams, design systems, and bounded
> decision/editing surfaces.
