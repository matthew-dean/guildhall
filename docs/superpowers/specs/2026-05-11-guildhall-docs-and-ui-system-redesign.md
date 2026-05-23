# Guildhall Docs and UI System Redesign

## Goal

Redesign Guildhall's public docs site so it feels like the actual product:

- more alive
- more branded
- plainer about what it does
- more visually tied to the product shell
- more honest about how it earns trust

At the same time, create a reusable Svelte UI system as a distinct package in
the Guildhall monorepo so the docs redesign and the product UI can share one
structural language instead of drifting apart.

The resulting system should support both:

- **display mode** for big, bold, branded docs surfaces
- **operator mode** for dense in-product views inside Guildhall

## Problem

The current docs site has three distinct weaknesses.

### 1. The voice is too generic

The current site often sounds like default docs software:

- competent but bloodless
- descriptive but not memorable
- technically correct but emotionally flat

That is a poor fit for Guildhall.

Guildhall is not just another "agent framework" or "AI coding harness." It is
an opinionated product for people who are tired of babysitting a pile of hidden
state and trying to remember too many things at once.

The docs should sound like that point of view.

### 2. The visual system is too template-shaped

The current VitePress site still reads as:

- VitePress defaults
- feature-grid docs marketing
- isolated copy blocks
- diagrams that explain mechanics but do not build identity

This undersells Guildhall's strongest product qualities:

- the project shell
- the visible queue
- the reviewer + gate model
- the sense that distinct personalities are participating in the work

### 3. The design language is not reusable

Right now, docs styling and product UI styling are too separate, and the
product UI itself is haphazard in places:

- strong raw ideas, especially in shell structure and product shape
- inconsistent hierarchy
- inconsistent card anatomy
- inconsistent section framing
- ad hoc spacing and type rhythm

If the docs redesign is built as docs-only polish, it will create a prettier
site but not a stronger product.

We want the opposite:

- one design system
- one structural language
- one reusable set of primitives
- two different habitats

## Product Direction

### Core promise

The docs should lead with this product claim:

> Guildhall is as unattended as you want, and as auditable as you need.

The product lets the user hand work to a guild and step back, but it earns that
trust through:

- explicit levers
- reviewer personas
- deterministic gates
- readable transcripts
- visible queue state
- persistent project shells

This is not a "just trust the agent" product story.

It is a:

- "let the guild carry the work"
- "keep the receipts"
- "step in when it matters"

story.

### Brand voice

The approved tone is:

- **battle-tested mischief**
- balancing **dryly irreverent** with **competent-but-swaggering**

The humor should target:

- the absurdity of software work
- the number of things operators are expected to remember
- process theater
- invisible state
- the ritual overhead of other harnesses

It should not target:

- the user
- software quality
- correctness
- projects with real stakes

Guildhall should sound like it has a point of view, not like it is trying to
win a joke contest.

### Explicit origin note

The site may mention once, explicitly, that Guildhall was built by an ADHD
engineer who got overwhelmed by AI harnesses that demanded too much attention
just to stay upright.

This should appear:

- once
- plainly
- as an origin-story explanation for the product's obsession with visible state
  and reduced cognitive load

It should not become:

- a mascot
- a recurring slogan
- a substitute for product explanation

### Visual personality

The docs site should feel:

- dark but not gloomy
- sharp but not severe
- playful but not cute
- branded but not theatrical

The design should borrow from guild/company imagery without turning into a
theme park:

- heraldic marks
- banners
- stars
- keys
- towers
- map-room diagrams
- isomorphic "company at work" illustrations

It should avoid:

- emojis
- generic illustration blobs
- random SaaS gradients
- fantasy-roleplay copy that makes the product sound unserious

## Homepage Direction

### Hero

The recommended hero pairing is:

- **Headline:** `Let the guild carry the work.`
- **Subhead:** `As unattended as you want. As auditable as you need.`

This achieves both goals:

- the first line carries the brand
- the second line explains the product promise plainly

The hero should also include one short explanatory paragraph that says, in
plain language:

- Guildhall is a local service over projects
- the user works from a project shell
- the guild can keep moving without constant babysitting
- the results remain inspectable

### Hero media

The homepage should show a real or reconstructed product surface early.

Do **not** lead with decorative abstraction.

The public docs site should prove the product has an interface worth using by
showing:

- Projects page
- project shell
- Thread / Work / Release signal
- or an annotated product shell composition

The product UI is the power. The docs should behave like that is true.

### Information sequence

Recommended homepage order:

1. Hero: brand line + product promise
2. Real product surface: screenshot or reconstructed shell
3. One origin note: the ADHD/cognitive-load sentence
4. Why it works: reviewers, guardrails, transcripts, levers
5. Guild layer: how personalities participate
6. Honest limits: what Guildhall is strongest at today

This sequence is important.

It leads with:

- product
- trust model
- evidence

before asking the user to care about internals.

## What the Docs Should Emphasize

The docs site should foreground:

- the product shell
- the set-it-and-forget-it promise
- the reviewer/gates/auditability system
- the guild/personality system
- the visible-state story

It should demote:

- giant early lists of subsystem nouns
- generic architecture-first framing
- VitePress-default feature-grid pacing
- over-neat "AI product" copy

The docs should be plainer about what Guildhall actually does:

- it helps you remember less
- it reduces babysitting
- it keeps the work visible
- it lets you choose how unattended the process becomes

## Shared UI System

### Package decision

Create a distinct package in the Guildhall monorepo:

- recommended package name: `@guildhall/ui`

This package should be the reusable design-system and component-system package
for Guildhall.

The monorepo work is part of this redesign effort, not a separate future
cleanup.

### Why a separate package

The package boundary matters because we want:

- a reusable Svelte component system
- one structural language shared between docs and app
- an asset that can evolve independently of individual product screens
- a publishable internal/external package namespace under `@guildhall/*`

The current repo is still physically flat today. This redesign should treat the
monorepo/package split as an explicit change, not as an assumption.

### Scope of `@guildhall/ui`

`@guildhall/ui` should contain:

- design tokens
- semantic CSS variables or token maps
- layout primitives
- shell primitives
- display primitives
- operator primitives
- status and annotation primitives
- icon wrappers or icon conventions
- screenshot framing primitives
- diagram/block primitives that can be used in docs or app

It should be purpose-built for both:

- **showpiece mode** for docs and branded surfaces
- **condensed operator mode** for Guildhall's product shell

### Not a Vue component library

The reusable library should be Svelte, not Vue.

The docs site may remain inside VitePress/Vue as the wrapper, but the shared
system should be authored in Svelte and should drive the visual language for the
product itself.

That means the docs site should:

- visually imitate or consume the same tokens
- showcase the same shell ideas
- use screenshots, diagrams, and assets from the Svelte system

but should **not** force the shared design system to become a docs-only Vue
artifact.

## UI System Architecture

### Layer 1: Tokens

Start with structural tokens, not final polish.

The first token set should define:

- type roles
- density scale
- radius scale
- surface roles
- emphasis levels
- icon sizing
- motion rules
- annotation roles

This effort should not begin as a color-only or spacing-only refresh.

### Layer 2: Primitives

Build a small, reusable primitive set that can operate in both display and
operator contexts.

Examples:

- buttons
- chips
- cards
- notice bands
- section headers
- stacks
- split panes
- rails
- drawers
- stat blocks
- screenshot frames
- diagram panels

Each primitive should be configurable by structural role, not just by paint:

- `display` vs `operator`
- `comfortable` vs `dense`
- `quiet` vs `assertive`

### Layer 3: Shell patterns

Build reusable shell-level patterns for the actual product:

- projects home shell
- project shell
- thread/feed shell
- drawer shell
- release/settings inspection shell

This is where Guildhall's strongest current ideas can become real reusable
system pieces instead of bespoke screen implementations.

### Layer 4: Docs/brand compositions

Use the same structural language to build:

- hero bands
- guild diagrams
- annotated screenshot blocks
- comparison rows
- how-it-works sequences

These should feel like elaborations of the same system, not a separate visual
universe.

## Guildhall Product Audit

### Audit purpose

The current Guildhall UI should be audited for:

- structure
- configurability
- role clarity
- reuse value

It should **not** primarily be audited for:

- final spacing quality
- final color quality
- final typography polish

Those areas matter, but the user explicitly wants this audit grounded in:

- information shape
- component responsibility
- what can survive into a shared system

### Audit questions

For each current component or surface, ask:

- what information job does this actually do?
- is it a reusable pattern or a bespoke one-off?
- does it already encode a strong structural idea?
- can it work in both display and operator contexts with configuration?
- should it become a primitive, a shell pattern, or remain a composed surface?

### Expected strong raw material

Likely structural strengths to preserve or learn from:

- app/project shells
- rail/nav structures
- task drawer structure
- status chips and status language
- Thread as a command surface
- Release as an inspectable verdict surface

### Expected weak spots

Likely weaknesses to address:

- heading hierarchy
- section framing consistency
- card anatomy consistency
- typography rhythm
- areas where a "component" is really a whole bespoke screen chunk

### Audit outputs

The audit should produce:

- screenshots of current key surfaces
- a component inventory by structural role
- a list of components worth preserving
- a list of one-off surfaces to split or retire
- a proposed primitive-to-surface mapping for `@guildhall/ui`

## Screenshot and Visual Plan

The redesign should capture and use real Guildhall visuals.

Recommended screenshot set:

- Projects page with multiple projects and `Attach project`
- project shell with left rail and Start/Stop
- Thread showing live or pending work
- Work showing grouped queues
- Release showing auditable readiness
- Settings showing structured system control
- task drawer showing details/provenance anatomy

These screenshots should be used:

- as design references
- as docs assets
- as evidence for the structural audit

The redesign should also create:

- guild/company diagrams
- reviewer/gates flow diagrams
- "set it in motion / inspect when needed" diagrams

These should explain product ideas, not just decorate empty space.

## Docs Pages to Prioritize

The first pages to redesign should be:

- `docs/index.md`
- `docs/guide/quick-start.md`
- `docs/guide/dashboard.md`
- `docs/web-ui/dashboard.md`
- `docs/web-ui/project-view.md`

These pages define the first impression and the user-facing product story.

After that:

- supporting guide pages can be harmonized
- deeper subsystem/reference pages can adopt the new visual language more
  gradually

## Honest Product Framing

The redesign must not oversell Guildhall's autonomy.

The docs should clearly state that Guildhall is strongest today on narrower,
well-bounded software work.

That honesty is part of the product's credibility.

The swagger should come from:

- clarity
- receipts
- real UX
- explicit guardrails

not from pretending the product is already omnipotent.

## Implementation Approach

Recommended order of execution:

1. audit current Guildhall UI
2. capture screenshots of key product surfaces
3. define the shared Svelte component system and package boundary
4. redesign homepage and first-visit docs pages using that system
5. port the strongest structural ideas back into Guildhall product surfaces

This order matters because it keeps the redesign grounded in the real product
instead of drifting into docs-only branding theater.

## Success Criteria

This effort is successful when:

- the docs site no longer feels like default VitePress with stronger copy
- the homepage clearly communicates the real product promise
- the site feels branded, opinionated, and alive without becoming snarky
- the docs visually foreground the actual product shell
- the ADHD/cognitive-load origin note appears once and usefully
- a distinct `@guildhall/ui` package exists in the monorepo plan
- the shared UI system is clearly designed for both display and operator modes
- the Guildhall audit identifies reusable structural strengths instead of just
  aesthetic complaints
- the redesign creates assets and primitives that can improve the app itself,
  not only the docs site
