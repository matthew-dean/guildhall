# Guildhall 0.9 Design Quality And Taste Proposal

## Purpose

Guildhall's 0.9 live app proof should not stop at "the generated app works."
For Pantry Pulse, and eventually every from-spec-to-completion benchmark, the
target is a product that feels deliberate enough to ship: clear interaction
patterns, attractive visual system, coherent palette, accessible states,
responsive layout, and proof that the result is more than functional scaffolding.

The goal is not to make every generated app look expensive in the same way. The
goal is for Guildhall to carry taste as an evolving, inspectable system: it
should know current UI patterns, choose a design direction suited to the product,
use or recommend a design system, apply enough design pressure to the spec, and
reject outputs that technically pass while feeling confusing, generic, or
unfinished.

## Product Thesis

Guildhall should optimize for good results, not merely completed tasks.

For UI work, that means:

- a task can fail review because the wrong control type was chosen, even if the
  click handler works;
- a task can fail review because the palette feels arbitrary, stale, overused,
  or mismatched to the product's emotional job;
- a task can fail review because the page lacks visual hierarchy, polish,
  responsive behavior, or app-store-level completeness;
- a task can pass only when its design choices are explicit enough that another
  agent, a future maintainer, and the owner can understand why the result looks
  and behaves the way it does.

## Current System

Guildhall already has useful bones:

- `Component Designer` covers component APIs, variants, slots, layering, and
  interactive component a11y props.
- `Visual Designer` covers spacing scale, type scale, hierarchy, rhythm,
  optical alignment, responsive layout, and motion purpose.
- `Color Theorist` covers semantic color roles, token naming, light/dark
  variants, perceptual duplicate checks, and OKLab distance.
- `Accessibility Specialist` and `Test Engineer` can inspect interactive
  behavior and browser evidence.
- Pressure-test intake now applies to every task, with the system choosing how
  much pressure to apply.
- The Pantry Pulse proof gives Guildhall a concrete live benchmark instead of a
  theoretical design-quality conversation.

The gap is that these pieces do not yet form a design-quality pipeline. They
inspect local correctness, but they do not reliably create an opinionated design
direction, keep current taste memory, choose suitable libraries/patterns, or
force an app-store-caliber visual proof before completion.

## External Signals

Guildhall should avoid chasing trend articles blindly, but it should still carry
fresh design awareness. The update loop should use durable, source-backed trend
signals rather than vibes.

Current signals worth encoding:

- Apple HIG emphasizes hierarchy, harmony, consistency, semantic color,
  light/dark/increased contrast variants, and not using the same color for
  different meanings. This matches the need for control semantics and
  app-store-quality platform fit.
- Material-style color systems push color roles and tonal palettes rather than
  raw hex choices. This matches Guildhall's existing semantic-token direction.
- Current SaaS/app trend commentary is converging on confidence, lower cognitive
  load, warmer minimalism, richer but controlled brand personality, bento-like
  grouping when it clarifies structure, and accessible dark/light modes.
- 2026 design commentary is also reacting against sterile AI-polished sameness:
  products need some humanity, texture, warmth, and identity.
- Fashion and interior color signals are useful only as weak inputs. They can
  suggest mood shifts, such as earthy warmth or toned-down saturation, but
  Guildhall should translate them into product-specific roles instead of copying
  seasonal colors.

Useful references:

- W3C Design Tokens Format Module:
  https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
- Style Dictionary design tokens:
  https://styledictionary.com/info/tokens/
- Storybook:
  https://storybook.js.org/
- Apple SwiftUI previews:
  https://developer.apple.com/documentation/swiftui/previews-in-xcode
- Apple Human Interface Guidelines, Color:
  https://developer.apple.com/design/human-interface-guidelines/foundations/color/
- Apple Human Interface Guidelines, overview:
  https://developer.apple.com/design/human-interface-guidelines/
- Material Design 3 color overview:
  https://m3.material.io/styles/color/overview
- Claude Design announcement:
  https://www.anthropic.com/news/claude-design-anthropic-labs
- Claude Design design-system setup:
  https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design
- Claude Design product prototyping guide:
  https://claude.com/resources/tutorials/using-claude-design-for-prototypes-and-ux
- SaaSUI 2026 SaaS UI trends:
  https://www.saasui.design/blog/7-saas-ui-design-trends-2026
- Creative Bloq 2026 design trend summary:
  https://www.creativebloq.com/design/graphic-design/texture-warmth-and-tactile-rebellion-the-big-graphic-design-trends-for-2026

## Proposal

### 1. Add A Living Design Taste System

Create a first-class design taste store that Guildhall can use during intake,
spec refinement, implementation, and review.

Recommended storage:

- global defaults in bundled Guildhall data;
- user-level overrides in `~/.guildhall/design-taste.yaml`;
- project-level overrides in `.guildhall/design-taste.yaml`;
- generated memory candidates when a project repeatedly accepts or rejects a
  design direction.

Implementation status: the first 0.9 slice now includes a schema-validated
effective taste packet with built-in defaults, user overrides, project
overrides, a compact summary, and a project API/UI readout. The project layer
wins on scalar choices, while array-style avoid/source lists accumulate so
Guildhall does not forget broader guidance when a project adds a local rule.

Core shape:

```yaml
version: 1
updatedAt: "2026-05-28T00:00:00Z"
sourceSet:
  - id: apple-hig-color
    url: https://developer.apple.com/design/human-interface-guidelines/foundations/color/
    kind: platform-guideline
    confidence: high
  - id: material-color-roles
    url: https://m3.material.io/styles/color/overview
    kind: design-system-guideline
    confidence: high
opinions:
  interactionSemantics:
    mutuallyExclusiveModes: segmented-control-or-tabs
    oneShotCommand: button
    independentBoolean: checkbox
    persistentBinaryState: switch
    navigation: link-or-tab
  paletteStrategy:
    defaultMode: semantic-oklch-roles
    saturationBudget: controlled
    avoid:
      - all-purple-gradient-app
      - beige-only-product
      - generic-dark-saas-slate
      - undifferentiated-neon
  visualDirection:
    default: warm-functional-polish
    avoid:
      - over-carded-layout
      - hero-marketing-shell-for-tool
      - stock-gradient-background
      - tiny-unexplained-controls
patternRecipes:
  filterModes:
    preferred: segmented-control
    notes: Mutually exclusive filters need persistent selected state and concise labels.
  pantryWellness:
    paletteMood: fresh, calm, trustworthy, food-adjacent without grocery-cart cliche
    hueHints: ["sage", "leaf", "citrus accent", "warm neutral"]
    avoid: ["medical blue", "neon green", "brown-only rustic"]
```

This is not a style guide frozen in amber. Every source and opinion should have
freshness metadata. Old trend opinions can expire or be downgraded, while core
platform and accessibility principles remain durable.

### 2. Add Design System Discovery And Recommendation

Before any UI task reaches implementation, Guildhall should answer:

- Does this project already have a design system?
- Does it have tokens, component primitives, Storybook, Figma exports, Tailwind
  config, shadcn/Radix/Mantine/Material/Chakra/etc., or custom components?
- Which components and patterns are trusted?
- Which patterns are forbidden or deprecated?
- If no design system exists, should Guildhall create a compact app foundation
  or recommend adopting a library?

The discovery result should become a design-system context packet:

```yaml
designSystemContext:
  status: discovered | absent | partial | conflicted
  sourceFiles:
    - src/components/ui
    - tailwind.config.ts
  trustedPrimitives:
    - Button
    - Tabs
    - Dialog
  trustedPatterns:
    - segmented filter controls
    - settings form rows
  recommendation:
    kind: use-existing | create-compact-foundation | adopt-library | ask-owner
    rationale: Existing app has Radix primitives but no token roles.
```

Adoption recommendations should be opinionated but scoped:

- Use existing project primitives when they are coherent.
- Use a proven headless primitive library when interaction correctness matters.
- Use a visual component library when speed matters and the project has no
  design taste of its own.
- Create a tiny local foundation when the app is small and adding a full library
  would create more overhead than value.

### 2.1. Make The Design System Interactable In Guildhall

For web apps, Guildhall should expose the project's design system as a live,
clickable in-app surface. This should feel closer to a focused Storybook/catalog
than a static design-token table.

Recommended surfaces:

- **Token explorer:** colors, typography, spacing, radii, shadows, motion, and
  semantic roles, shown on real backgrounds with contrast checks.
- **Component catalog:** each trusted component rendered with props/variants,
  slots, density, and state controls.
- **Pattern catalog:** higher-level recipes such as segmented filters,
  settings rows, empty states, checkout steps, dashboards, onboarding, and
  destructive confirmations.
- **State matrix:** default, hover, focus, active, disabled, selected, loading,
  empty, error, warning, success, destructive, and reduced-motion variants.
- **Viewport matrix:** mobile, tablet, desktop, and constrained/overflow cases.
- **Theme matrix:** light, dark, increased contrast, and any brand/theme modes.
- **Feedback mode:** the owner can pin comments to a rendered token, component,
  pattern, state, or viewport.

For an existing web app, Guildhall should prefer the app's real components. If a
project already has Storybook, Ladle, a docs app, or a component playground,
Guildhall should integrate with that rather than create a duplicate. If no
catalog exists, Guildhall can generate a small temporary catalog route inside
its runtime and mark it as a proof artifact.

#### Storybook-Compatible, Storybook-Optional

It is not insane to integrate Storybook. It is probably the right first known
integration, as long as Guildhall does not require every project to adopt it.

Recommended shape:

- **Detect first:** if a project already has Storybook config or stories, use it.
- **Embed inline:** run Storybook inside the project runtime and show the story
  canvas/docs in a Guildhall iframe with project/runtime status, proof actions,
  and feedback controls around it.
- **Read metadata:** use Storybook's story index, component titles, args, and
  story ids to build Guildhall's component catalog and proof matrix.
- **Capture proof:** use Playwright against the Storybook iframe/canvas route to
  screenshot component states and interactions.
- **Do not force install:** if Storybook is absent, Guildhall should not
  automatically add it just to preview a small app unless the owner approves a
  library adoption.
- **Render portable stories:** define a tiny Guildhall story manifest that can be
  rendered by Guildhall's own preview adapter when Storybook is absent.

The portable manifest should look conceptually like this:

```yaml
stories:
  - id: pantry-filter.default
    componentIntent: segmented-filter
    title: Pantry filter / Default
    viewport: mobile
    props:
      selected: all
      counts:
        all: 7
        expiringSoon: 3
    states:
      - default
      - focus
      - selected
```

For Storybook projects, Guildhall maps Storybook stories into this contract. For
non-Storybook projects, Guildhall renders the contract itself through a lightweight
preview route.

Pros of leaning into Storybook:

- proven component workshop pattern;
- familiar to many frontend teams;
- good iframe/canvas embedding story;
- existing story metadata, args, controls, docs, and interaction-test ecosystem;
- easy screenshot/proof integration through Playwright;
- encourages reusable components instead of one-off page code.

Cons and risks:

- adds heavy dependency/runtime overhead if forced into small projects;
- can become a second app to maintain;
- not all projects use React/Vue/Svelte in a Storybook-friendly way;
- Storybook stories can drift from production behavior if they mock too much;
- native apps still need a different proof path;
- exposing full Storybook chrome inside Guildhall could add cognitive overhead.

Best 0.9 stance:

1. Treat Storybook as the preferred adapter when present.
2. Offer guided setup only when the project is UI-heavy enough to benefit.
3. Keep a built-in lightweight story renderer for small apps and non-Storybook
   projects.
4. Normalize both paths into the same design proof packet, so reviewers and MCP
   do not care which renderer produced the evidence.

Implementation status: Guildhall now exposes a normalized design-system catalog
packet for web projects. Storybook story files become catalog entries with
iframe-style preview URLs; Guildhall portable stories become catalog entries
with stable preview ids. Settings shows the detected catalog adapter, item
count, and whether an interactable preview surface is available.

#### Looma As A Candidate Blessed Foundation

Guildhall should be able to recommend a known-good UI foundation when a project
does not already have one. Looma is a strong candidate because it is
stack-agnostic, token-first, web-standards-oriented, and already has tokens,
components, framework adapters, docs, and Storybook. But Guildhall should not
hard-depend on Looma for every project. The right shape is best of both worlds:
Looma-aware when Looma is present or intentionally adopted, library-agnostic
when a project already has another credible design system.

Before Guildhall can recommend Looma for user projects, Looma needs its own
distribution and trust story:

- **Public home:** move or mirror Looma to a public GitHub repository with the
  Looma name, not the old Granola remote identity.
- **License:** publish under MIT if the goal is broad adoption by generated
  apps, commercial projects, examples, and third-party users without awkward
  legal review.
- **Package story:** publish stable package names for tokens, components, and
  framework adapters, with clear install guidance and versioning.
- **Design contract:** document Looma's token pyramid, including global taste
  levers, semantic roles, primitive defaults, component variants, and local
  overrides.
- **Proof surface:** keep Storybook and docs as first-class verification
  surfaces so Guildhall can embed Looma examples and capture UI proof.
- **Adoption boundary:** Guildhall may suggest Looma during design-system
  discovery, but adopting Looma into a project should remain an explicit
  decision unless the project spec already requested it.

The token pyramid should give users and agents semantic levers, not raw pixel
knobs. For example, border radius should be adjustable through a global
personality/density lever such as `sharp`, `soft`, or `round`, which maps into
primitive radius tokens. Individual primitives can refine that mapping, and
specific controls can still expose intentional local overrides when the design
system allows it.

Conceptual hierarchy:

1. Taste presets: compact, calm, editorial, playful, enterprise, mobile-first.
2. Global levers: radius, density, contrast, motion, type personality, palette
   mood, and saturation budget.
3. Semantic tokens: surface, text, border, accent, status, focus, and elevation.
4. Primitive defaults: button, input, card, dialog, menu, tabs, toast, sheet.
5. Component variants: solid, ghost, outline, subtle, strong, compact, roomy.
6. Instance overrides: local escape hatches that are explicit, reviewable, and
   preferably rare.

Guildhall should compare Looma against other token-driven systems during
design-system discovery. The goal is not to prove Looma is always best; the goal
is to make Guildhall capable of choosing or recommending a foundation with
evidence. If Looma is chosen, Guildhall gets a first-party system it can reason
about deeply. If another library is already better for the project, Guildhall
should map that system into the same design proof contract.

#### Design Feedback Routing

Design review findings should not disappear into a single app's task history
when they reveal a reusable gap in a design system, component library, or
domain capability. They should be classified, retained, and then either kept as
project-local design decisions or routed through the same project graph and
domain/capability exchange that Guildhall uses for other provider-owned work.
Looma is one possible provider project, not a special dev mode.

The loop should work like this:

1. Guildhall builds or reviews a real project UI.
2. Reviewers and owner feedback capture design issues against visible proof:
   screenshots, component stories, DOM selectors, viewports, states, and
   interaction notes.
3. Guildhall classifies each issue as one of:
   - **Project-specific:** the current product needs a local design decision.
   - **Reusable pattern:** the issue belongs in a shared recipe or component.
   - **Token-system gap:** the issue needs a new or better semantic lever.
   - **Taste guidance gap:** the issue needs better guidance, rubric language,
     examples, or palettes.
   - **Design-system defect:** the responsible design system already claims to
     handle this but does not.
4. Project-specific findings become project design decisions.
5. Reusable findings become design-system candidate improvements with evidence.
6. If another project owns the relevant capability, Guildhall creates or
   updates the project graph request to that provider coordinator and tracks the
   provider plan/delivery/consumer verification receipts.
7. Accepted design-system improvements update the provider project's tokens,
   primitives, recipes, catalogs, docs, or rubrics.
8. Future Guildhall runs start from the improved foundation.

That makes the improvement path explicit: Guildhall improves apps, and repeated
app evidence improves the systems that future apps inherit.

Implementation objects:

- **DesignFinding:** a structured record from reviewer, owner, automated visual
  check, or simulated-owner review. It includes source artifact, viewport,
  component/selector when known, severity, design dimension, and suggested
  classification.
- **DesignDecision:** a project-owned decision that workers and reviewers must
  honor for the current app.
- **DesignSystemCandidate:** a reusable improvement proposal that can target
  any detected or graph-owned design system.
- **DesignSystemImprovement:** a reusable candidate with target package
  (`tokens`, `core`, `layout`, adapter, docs, Storybook/rubric), evidence
  links, expected API/token shape, and verification expectations. It remains a
  portable record until a project graph edge routes it to the provider project.

Classification should happen after every design proof pass, not as a manual
extra step. Guildhall can ask the owner when the scope is ambiguous, but the
default behavior should be automatic triage:

- A palette miss for Pantry Pulse's food/domestic mood is likely a project
  design decision.
- A segmented filter whose selected state is repeatedly unclear is likely a
  recipe or primitive improvement in the responsible design system.
- A radius complaint across several generated apps is likely a token-lever gap.
- A confusing toggle/button choice is likely a component interaction semantics
  rubric and pattern-catalog improvement.
- A documented component state that fails in the provider project's catalog is
  likely a design-system defect.

Guildhall should expose this gently. The owner does not need a big new dashboard
for every design-system thought. In normal project work, they should see:

- the local design decision that affects the current app;
- a compact note when a reusable provider-owned follow-up was filed;
- a link from the design proof packet to the reusable finding;
- project graph status when the finding has been handed to another coordinator.

For 0.9, the minimum viable version is the schema, persistence,
classification, UI/API visibility, and a recorded Pantry Pulse proof where at
least one reusable design finding is separated from local project decisions.
For 0.10, provider-owned reusable design feedback should travel through the
project graph exchange rather than through a machine-local development hook:
domain assignment, provider request, delivery plan, delivery receipt, and
consumer verification/return evidence.

There should be no design-feedback `designSystemDevelopment` local checkout
config, no design-feedback `LOOMA_PATH`-style override, and no design-feedback
API field that reports inactive local development targets. If a real
Looma/Knit/Guildhall workspace is registered, it should be represented as
first-class projects and graph edges, the same way any other shared design
system or capability provider would be.

Project-level config should stay separate:

```yaml
# <project>/.guildhall/config.yaml or a future design packet
designSystem:
  preferred: looma
  adoption: suggested
```

That project-level setting means "this project may use Looma." It does not mean
"this machine has a Looma checkout that Guildhall can edit." Keeping those apart
prevents generated or third-party projects from inheriting Matthew's local dev
paths or failing because Looma is not present.

### 2.2. Use A Portable Contract, Not A Cross-Platform UI Library

Guildhall should not force teams into React Native, Flutter, Ionic, or any other
cross-platform UI layer just to make design review easier. The portable layer
should be the design-system contract, not the rendering framework.

The contract should describe:

- tokens, preferably compatible with the W3C Design Tokens format;
- semantic roles, such as `surface.primary`, `text.muted`, `action.primary`,
  `status.warning`, and `focus.ring`;
- component intents, such as button, segmented control, tab bar, card, list row,
  sheet, alert, and toolbar;
- interaction semantics, such as action, navigation, mutually exclusive mode,
  independent boolean, persistent binary state, disclosure, and selection;
- state matrix requirements;
- platform notes and intentional deviations.

Then each platform gets an adapter:

| Platform | Preferred preview | Production implementation |
| --- | --- | --- |
| Web | Real component catalog or generated preview route | Existing web stack/components |
| iOS SwiftUI | SwiftUI preview/snapshot adapter when Xcode is available; browser surrogate otherwise | Native SwiftUI/UIKit components |
| macOS SwiftUI/AppKit | SwiftUI/AppKit preview/snapshot adapter when available; browser surrogate otherwise | Native macOS components |
| Android | Compose preview/snapshot adapter when available; browser surrogate otherwise | Native Compose/View components |
| Unknown/native unavailable | Browser surrogate labeled as approximate | Project's native stack |

The browser surrogate is valuable because it lets Guildhall and the owner reason
about hierarchy, palette, spacing, state coverage, and interaction semantics
without pretending the pixels are native-final. It should be clearly labeled:

> Preview approximation: this rendering proves design intent and state coverage.
> Native platform proof still needs simulator/device screenshots before release.

Implementation status: Guildhall now exposes a design-intent surrogate packet.
Web projects with an interactable catalog are marked as real web preview. iOS,
macOS, Android, and unknown native projects are marked as browser-surrogate,
approximate, and native-proof-required. Settings shows the preview mode and the
native proof requirement so approximations cannot be mistaken for release proof.

For iOS specifically, Guildhall should use a two-lane model:

- **Intent preview:** browser-rendered token/pattern/component surrogate for fast
  owner feedback, alternative directions, and automated visual checks.
- **Native proof:** SwiftUI preview, Xcode build, simulator screenshot, or
  device screenshot when the local runtime has the required tooling.

That keeps feedback fast while respecting the native app's real platform
behavior.

### 2.5. Make Human Feedback Visual And Structured

Human feedback should be gathered where the design is visible, not as a vague
late-stage comment thread. Guildhall should make it easy for the owner to react
to real renderings, while still preserving the system's responsibility to
pressure-test and improve the work.

Recommended Guildhall surfaces:

- **Design preview board:** show one to three rendered directions for a UI task
  or app spec. Each direction includes a short rationale, palette roles,
  component/pattern choices, and known tradeoffs.
- **Design-system catalog:** expose the current project's tokens, components,
  patterns, states, and themes as live in-app previews.
- **Responsive preview:** render the same direction at mobile, tablet, and
  desktop sizes, with screenshots saved as proof artifacts.
- **Component state gallery:** for changed components, show default, hover,
  focus, disabled, selected, loading, empty, error, and destructive states where
  relevant.
- **Live component sandbox:** mount the actual component or generated app route
  inside Guildhall so the owner and reviewer can click it, type into it, resize
  it, and trigger state changes.
- **Inline feedback pins:** let the owner click a rendered element and leave
  feedback tied to a DOM selector, component name, screenshot coordinate, and
  viewport.
- **A/B preference capture:** let the owner choose between directions, but also
  ask "why" in structured terms: warmer, calmer, denser, more premium, more
  playful, less generic, clearer hierarchy, better controls, stronger brand.
- **Design decision ledger:** convert accepted feedback into project design
  decisions and memory candidates instead of burying it in the chat transcript.
- **Review replay:** after implementation, replay the accepted feedback as a
  checklist so reviewers can verify that the build honored the chosen direction.

The owner should be able to say "B is closer, but use A's cards and make it less
yellow." Guildhall should translate that into durable constraints:

```yaml
designFeedback:
  target: pantry-pulse
  selectedDirection: B
  acceptedTraits:
    - calm
    - fresh
    - clearer hierarchy
  rejectedTraits:
    - too yellow
    - generic grocery app
  elementFeedback:
    - selector: "[data-ui='expiry-filter']"
      viewport: mobile
      comment: "This should read like a filter mode, not two action buttons."
      convertedDecision: Use segmented control for all/expiring-soon mode.
  memoryCandidates:
    - Project prefers warm neutrals with green accents for household wellness UI.
```

Human feedback should not replace expert review. It should sharpen it. If the
owner likes an inaccessible contrast pair or a confusing control, Guildhall
should explain the risk and propose a nearby alternative that preserves the
intent.

### 2.5.1. Surface Design Quality Without Creating UI Overhead

Design quality should appear in the product as confidence, proof, and the next
useful action, not as a new maze of tabs. The owner should be able to ignore the
machinery when things are going well, and open it only when they want to steer
or inspect the result.

Recommended IA:

- **Project Overview:** show one compact "Design quality" row only when the
  project has UI work, a design-system decision, or a design proof artifact.
  The row should summarize the current state: "Using project components",
  "Needs design direction", "2 directions ready for feedback", or "Design proof
  passed".
- **Work list cards:** show a small design-quality chip for UI work, not a full
  section. Examples: `Design needed`, `Preview ready`, `Design proof passed`,
  `Palette risk`, `Control mismatch`.
- **Task drawer Overview:** show the selected design-system source, accepted
  direction, and one-line proof status. Avoid dumping all rubric text.
- **Task drawer Proof tab or Proof section:** group screenshots, responsive
  viewports, component-state matrix, and reviewer verdicts behind a single
  "Design proof" heading.
- **Thread:** show only actionable design feedback requests: "Choose between
  these two Pantry Pulse directions" or "Comment on this preview." Do not stream
  every internal design-system extraction step as chat noise.
- **Settings / Project Design:** provide a low-traffic place to inspect and
  edit the durable project design system, taste memory, palette roles, and
  component catalog.
- **Needs You:** surface design work only when the owner can make a real
  judgment call. If Guildhall can fix the issue itself, keep it out of the
  owner's queue.

Default visibility should be progressive:

1. **Tiny signal:** chip or row on the card/project.
2. **Useful summary:** selected design source, direction, current blocker, next
   action.
3. **Proof detail:** screenshots, states, palette roles, reviewer notes.
4. **Raw machinery:** source extraction, full rubrics, trend/taste ledger, and
   design-system contract.

If the design-quality system adds cognitive load, scale back the surface first,
not the pressure. The pressure can run in the background; the UI should show the
owner only what helps them decide, trust, or continue.

### 2.6. Inspiration From Claude Design

Claude Design has several ideas Guildhall should learn from, without copying its
whole product shape.

Worth borrowing:

- **Visual-first iteration:** start with something visible, then refine it in
  context. Guildhall should show design work in the same project surface where
  tasks, proof, and handoff live.
- **Design system onboarding:** Claude Design can derive a UI kit from code,
  screenshots, decks, or brand assets. Guildhall should similarly extract
  reusable components, colors, typography, and layout patterns from a real
  project before generating new UI.
- **Multiple explorations:** generate a few directions when taste is uncertain,
  not one arbitrary answer.
- **Fine-grained feedback:** inline comments, direct edits, spacing/color/layout
  knobs, and apply-across-design commands are useful patterns for owner feedback.
- **Handoff bundle:** design intent should travel into implementation as a
  structured packet, not as a screenshot and vibes.
- **Prototype before PR:** realistic prototypes can gather feedback before code
  review, which is exactly what Guildhall needs for broad UI work.

What Guildhall should do differently:

- **Do not treat prototypes as completion.** Guildhall's job is production
  finishability: tests, gates, persistence, runtime proof, docs, handoff, and
  review.
- **Do not hide the codebase.** Guildhall should ground design choices in the
  actual repository, existing components, and implementation constraints.
- **Do not make design taste ephemeral.** Feedback and successful choices should
  become project memory, design-system updates, and future reviewer context.
- **Do not overfit to visual polish.** A pretty screen with the wrong state
  model, inaccessible contrast, or misleading control semantics is still a
  failure.
- **Do not require a separate design product.** Guildhall can expose renderings,
  live component tests, and feedback capture inside the project workflow.

For 0.9, the Guildhall version of the best Claude Design ideas should be:

1. render design directions for Pantry Pulse inside Guildhall;
2. collect owner feedback on specific elements and alternatives;
3. convert feedback into a design decision packet;
4. build the app from that packet;
5. replay the packet during review and visual proof;
6. store accepted taste as memory for future UI work.

### 3. Pressure-Test Design Tasks

Every UI-affecting task should get a design-quality pressure section. Small
tasks can receive an automatic short version. Broad feature/app tasks should get
the full version.

Required domains:

- **Audience and emotional job:** Who is using this, and what should the app
  make them feel: calm, confident, fast, playful, premium, safe, expert?
- **Design-system decision:** Existing system, adopted library, compact
  foundation, or explicit exception.
- **Interaction semantics:** For each control, is it an action, navigation,
  mutually exclusive mode, independent boolean, persistent binary state,
  disclosure, selection, or destructive action?
- **Pattern references:** Which trusted pattern recipe applies? If none, why is
  a custom pattern justified?
- **Palette direction:** Semantic roles, hue family, saturation budget, accent
  usage, light/dark behavior, cultural/status meanings.
- **Visual hierarchy:** Primary/secondary/tertiary elements, density, whitespace,
  typography scale, grouping, and scanning path.
- **State design:** Empty, loading, error, disabled, selected, focused, success,
  warning, destructive, and offline states when relevant.
- **Motion and feedback:** Only motion that confirms, reveals, or helps
  orientation. No decorative motion without purpose.
- **Proof requirement:** Screenshots, browser walkthrough, responsive sizes,
  accessibility checks, and visual review artifacts.
- **Human feedback plan:** If taste is uncertain or the work is broad, define
  what the owner will see, how they can react, and how Guildhall will turn their
  feedback into constraints.

The owner should not choose whether this happens. Guildhall chooses the depth.

### 4. Teach Agents To Trust Patterns, Not Invent Controls

Agents should receive a pattern decision table in their context. For example:

| User need | Preferred control | Review failure if |
| --- | --- | --- |
| Switch between all and expiring pantry items | Segmented control or tabs | Implemented as ambiguous action buttons |
| Mark an item used | Button or checkbox depending persistence model | Label does not say what changes |
| Select multiple dietary filters | Checkbox group | Implemented as mutually exclusive tabs |
| Turn reminders on/off | Switch | Implemented as a one-shot button |
| Navigate sections | Tabs/nav links | Implemented as buttons with hidden routing |

The Component Designer rubric should explicitly inspect interaction semantics:

> Does each interactive element use the right control type for its job: button
> for one-shot command, link/tab for navigation, segmented control/radio/tabs
> for mutually exclusive modes, checkbox for independent booleans, switch for
> persistent binary state, disclosure for show/hide?

The reviewer should be allowed to fail otherwise functional work on this basis.

### 5. Make Palette Choice Opinionated

Guildhall should not merely ask "what colors?" It should infer a palette
strategy from product category, audience, emotional job, platform, and current
taste memory.

Palette requirements:

- Every color is a semantic role before it is a value.
- Palettes are generated in OKLCH or another perceptual color space.
- Saturation is budgeted by role. Most UI surfaces stay calm; accents carry
  energy.
- Status colors are reserved for status. Brand accent should not also mean
  success, warning, or danger.
- Light, dark, and increased-contrast variants are part of the design system.
- The palette must not collapse into one hue family unless the product
  explicitly wants a monochrome/tonal identity.
- Trend colors can influence mood, but product meaning wins.

For Pantry Pulse, a reasonable default design direction is:

- **Mood:** fresh, calm, household-friendly, confident, lightly warm.
- **Base:** warm off-white or soft neutral, not beige-only.
- **Primary:** sage/leaf green with enough chroma to feel fresh but not neon.
- **Accent:** citrus/yellow-green or tomato/coral used sparingly for urgency.
- **Status:** expiring-soon should be warning-coded with text/icon/shape, not
  color alone.
- **Avoid:** medical blue, generic dark SaaS, grocery-cart green overload,
  rustic brown-only pantry tropes, all-purple gradients.

### 6. Add Design Trend Updating

Guildhall should carry design opinions that update over time through a small
curation loop.

Inputs:

- platform guidelines, weighted high and slow-changing;
- design-system docs, weighted high for implementation patterns;
- curated app/UI reference sources, weighted medium;
- trend reports and industry commentary, weighted low-to-medium and
  time-limited;
- project owner approvals/rejections, weighted high within that project;
- reviewer misses, weighted high as failure evidence.

Mechanism:

- Add a `design-taste refresh` command or scheduled internal task that updates a
  bundled trend ledger.
- Store source snapshots with dates, confidence, and expiration.
- Convert sources into small, testable opinions rather than giant prose blobs.
- Let owners approve project-level taste memory when Guildhall learns a
  preference.
- Add a consolidated MCP design context so agents and external tools can inspect
  current taste without multiplying near-duplicate resources. Implemented as
  `guildhall://project/design`, covering the project design system, effective
  taste, catalog/preview status, and design feedback/decision counts. Broader
  accepted feedback and worker decision packets remain available through
  `guildhall://project/feedback`.

### 7. Upgrade Pantry Pulse As The Release Benchmark

The fixed Pantry Pulse spec should grow a release-grade design boundary. It
should remain small, but the expected outcome should be app-store-caliber.

Completion should require:

- a polished responsive app, not just a plain list;
- an explicit compact design foundation;
- at least two rendered design directions when running the design-quality proof
  lane, unless a project design system already dictates the direction;
- structured owner or simulated-owner feedback captured against the rendered
  directions in fully automated runs;
- a design decision packet that the worker and reviewers can consume;
- semantic palette roles with documented rationale;
- a correct filter control pattern;
- item cards or rows with clear hierarchy and expiry affordance;
- empty state and all-used state;
- keyboard and screen-reader-friendly controls;
- browser proof at mobile and desktop sizes;
- screenshot artifacts kept with the run report;
- design reviewer approval that names why the result is visually ready.

The benchmark should fail if:

- controls are semantically wrong;
- the palette is arbitrary or inaccessible;
- the app looks like default browser styles;
- the design is a generic one-note palette;
- the app only proves a happy-path click sequence;
- the final handoff cannot explain why the app looks the way it does.
- the implementation ignores accepted design feedback or cannot show how the
  feedback was translated into UI constraints.

## Implementation Plan

### Milestone A: Design Taste Store

- Add schema and loader for global/user/project design taste.
- Add freshness, source, confidence, and expiry fields.
- Add project override merge rules.
- Add tests for merge order and stale trend downgrading.

### Milestone B: Design-System Discovery Packet

- Detect design tokens, component directories, Storybook config, Tailwind config,
  common UI libraries, and existing pattern docs.
- Persist a design-system context summary.
- If a web component catalog already exists, register it as the preferred
  interactable preview surface.
- If no catalog exists for a web app, generate a temporary Guildhall preview
  surface from the discovered tokens/components/patterns.
- For native apps, generate a browser design-intent surrogate and record whether
  native preview/snapshot tooling is available.
- Inject it into spec, worker, and reviewer context.
- Add tests for existing-system, absent-system, and conflicted-system cases.

### Milestone C: UI Pressure-Test Domains

- Extend request intake and pressure-test summaries with UI design-quality
  domains.
- Make small UI tasks receive automatic design pressure.
- Make broad app/feature tasks produce a design-quality section in the spec.
- Add tests proving UI tasks cannot skip design pressure.

### Milestone D: Pattern Semantics Rubric

- Add interaction semantics to Component Designer spec contribution, principles,
  and rubric.
- Add pattern decision recipes to reviewer context.
- Add regression tests for filter-mode tasks selecting Component Designer and
  exposing the control semantics rubric.

### Milestone E: Palette Opinion Engine

- Extend Color Theorist spec contribution and rubric beyond token hygiene into
  palette intent, saturation budget, and product fit.
- Add OKLCH palette recipe helpers.
- Add palette anti-pattern checks for one-note, over-saturated, low-contrast,
  and role-confused palettes.
- Add tests for Pantry Pulse palette recommendations.

### Milestone F: Visual Proof And Review

- Save desktop and mobile screenshots for live app proof runs.
- Add rendered direction artifacts before implementation for broad UI/app work.
- Add an interactable design-system catalog surface for web projects.
- Add a portable design-system contract that can render through web surrogate
  adapters and, when available, native preview/snapshot adapters.
- Add a feedback capture API that can attach comments to screenshots, DOM
  selectors, component names, and viewport sizes.
- Add a design decision packet renderer so accepted feedback is visible to
  worker, reviewer, MCP, and the owner.
- Implementation status: owner design feedback now persists typed targets for
  artifacts, rendered directions, screenshots, selectors, components, viewports,
  and coordinates. Accepted feedback can be compiled into a design decision
  packet, shown in the owner UI, returned by the project API, and exposed to
  agents through the general `guildhall://project/feedback` MCP resource.
- Add a visual proof packet that includes screenshots, viewport list, palette
  roles, control-pattern decisions, and reviewer findings.
- Add optional image-review/LLM review lane when available, but keep deterministic
  checks for color, contrast, DOM semantics, and screenshot existence.

### Milestone G: Pantry Pulse App-Store-Caliber Benchmark

- Update the fixed Pantry Pulse spec and completion boundary.
- Add a design exploration phase with rendered alternatives.
- Add automated simulated-owner feedback for CI and a manual owner-feedback path
  for local interactive runs.
- Update the live test to require design foundation evidence and screenshot
  artifacts.
- Implementation status: the deterministic Pantry Pulse completion boundary now
  requires design foundation evidence, desktop and mobile screenshots, control
  semantics rationale, palette rationale, design reviewer approval, a design
  decision packet, reusable-vs-local design finding classification, and an
  actual token audit before a run can be called complete. The token audit is
  format-agnostic: CSS custom properties, Sass/Less variables,
  JavaScript/TypeScript token objects, JSON/YAML tokens, and similar project
  token sources all count. Generic cool-blue or medical-blue primary/accent
  choices fail the Pantry Pulse benchmark unless an accepted design decision
  packet gives a product-specific reason reviewers accept.
- Let the live agent complete the same lifecycle, but fail the benchmark if the
  result is only functional.
- Record the run report with design rationale, proof paths, and reviewer
  decisions.

## Acceptance Criteria

- UI tasks include design-quality pressure without requiring the owner to choose
  a special process.
- Agents can discover or recommend a design system before implementing UI.
- Broad UI work can show renderings or live component previews inside Guildhall
  before implementation is treated as settled.
- Owner feedback can be captured against a visible artifact and converted into a
  durable design decision packet.
- Reviewer context includes interaction semantics and can reject wrong control
  types.
- Color Theorist guidance includes product-fit palette direction, not only token
  hygiene.
- Pantry Pulse has a fixed design-quality completion boundary.
- A live Pantry Pulse run can complete with screenshots and a reviewer-approved
  design proof packet.
- MCP can expose the design system, design taste, design decisions, and design
  proof for the current project.

## Open Questions

- Should design taste refresh happen only during release planning, or can it run
  as an optional periodic local update?
- Should Guildhall ship a default small-app visual foundation, or should it
  always generate one from taste memory and project category?
- How much image-based review should be required before 0.9 if local vision
  model availability is inconsistent?
- Should project owners approve learned design taste memories one by one, or can
  repeated accepted review outcomes become project defaults automatically?

## Recommendation

For 0.9, implement the pipeline in this order:

1. Interaction semantics rubric and design pressure for UI tasks.
2. Pantry Pulse design-quality boundary and screenshot proof.
3. Design System Profile.
4. Palette opinion engine for small app specs.
5. Design taste store and MCP resources.
6. Trend refresh loop after the first Pantry Pulse proof exposes what opinions
   were actually useful.

This gives Guildhall immediate leverage on the current failure mode while
building toward the larger story: the system improves its taste, records what it
learns, and uses that taste to produce better software over time.
