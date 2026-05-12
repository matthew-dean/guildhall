# Guildhall UI style guide

Guildhall should feel guided, calm, and intentionally structured. When adding
or changing UI, do not improvise the visual or content hierarchy card by card.
Start from these rules.

## Core promise

- Every screen should help the user understand where they are, what Guildhall
  found, and what the next good action is.
- Every card should ask one clear question or present one clear state.
- Guildhall should do most of the synthesis work before asking the human to
  confirm or correct it.

## System over bespoke

LLMs will happily style every screen like a fresh invention unless the product
pushes back hard. Guildhall must push back hard.

When changing UI, do not start from "what should this one card look like?"
Start from:

- what existing primitive should carry this?
- what heading level should this be?
- what label type is this: status, step, metric, or metadata?
- what semantic color role does it belong to?
- what card anatomy is already standard for this kind of decision?

If two agents could reasonably ship two different-looking versions of the same
screen, the system is under-specified.

The goal is not just consistency after review. The goal is making the wrong
kind of bespoke output hard to produce in the first place.

## Heading hierarchy

- Use exactly one page `<h1>` when a page truly has a top-level title.
- Use `<h2>` for major page sections only.
- Use `<h3>` inside cards and section blocks.
- Use `<h4>` only for compact subsections inside larger cards.
- Do not use heading size as a styling shortcut. Structure via tags, then style
  with tokens.

## Card anatomy

Most interactive cards should follow this order:

1. Structural label
   - small overline or chip such as `Step 2 of 5`, `Needs review`, `Current`
2. Main heading
   - one sentence, concrete, user-facing
3. Supporting copy
   - one short paragraph explaining the decision or state
4. Evidence or summary rows
   - chips, counts, previews, short lists
5. Primary action row
   - one obvious main action, with quieter secondary actions

Do not open with a wall of prose. Do not bury the main question in the middle
of a large block.

## Labels and chips

Use labels deliberately. Each label type has a job.

- Status chips
  - lifecycle or urgency: `Needs review`, `Blocked`, `Running`, `Reference`
- Step chips
  - wizard progress: `Step 3 of 5`
- Metric chips
  - counts and compact summaries: `12 tasks`, `4 sources`
- Tone chips
  - `ok` for confirmed/healthy/task-bearing
  - `warn` for mixed or cautionary
  - `danger` for failure or required intervention
  - `accent` for current-step emphasis
  - `neutral` for passive metadata

When numbers are shown, prefer chips or clearly grouped compact labels over
burying counts in long sentences.

## Color roles

Guildhall should use one coherent palette, and it should be applied
semantically.

This is not just a styling concern. It is a collaboration between:

- color theory
- UI hierarchy
- accessibility

If a new surface introduces a new-looking blue, green, yellow, or red without
going through the shared tokens, that is a product-system failure.

Guildhall already has a semantic palette. Use the tokens, not ad hoc color
choices.

- `--accent`
  - current step, primary action, guided emphasis
- `--accent-2`
  - healthy/running/confirmed task-bearing states
- `--warn`
  - mixed, caution, partial confidence
- `--danger`
  - hard failure, blocked, dangerous/destructive actions
- `--text-muted`
  - secondary explanation, metadata, helper labels

Color should reinforce meaning, not carry it alone. Pair color with a label,
shape, or icon.

Additional rules:

- Each semantic role should have one token family, not many near-matches.
- Similar surfaces should use the same token family, not "close enough"
  handcrafted variants.
- Accent colors should create a clear hierarchy:
  - primary accent for guided/action emphasis
  - success accent for healthy/confirmed/task-bearing states
  - warning accent for caution/partial confidence
  - danger accent for failure/destructive states
- Neutral surfaces should stay warm and quiet so semantic colors stand out on
  purpose.
- Chips, banners, cards, and status markers should all draw from the same
  semantic token families.
- Accessibility is part of the definition of a valid palette choice:
  if a token pairing is hard to distinguish, it is not a valid semantic role.

## Copy density

- One sentence is better than three when the meaning stays clear.
- Supporting copy should explain the current decision, not the whole system.
- If the user needs to inspect deeper detail, collapse it behind a deliberate
  reveal.
- Avoid giant combined summaries that mix:
  - source evidence
  - proposed structure
  - final tasks
  - approval language

Those are different abstraction levels and should be shown separately.

## Journey screens

Wizard-style flows should feel like a guided journey:

- orient the user
- narrow scope
- inspect evidence
- review candidates
- confirm the result

Each step should have:

- one level of abstraction
- one obvious primary action
- detail available, but secondary

If a screen asks the user to evaluate multiple hidden decisions at once, split
the flow.

## Shared primitives first

Reach for shared building blocks before inventing bespoke styling:

- `AppShell` for outer page structure and inset
- `Card` for bounded surfaces
- `Stack` / `Row` for layout rhythm
- `Button` for actions
- `Chip` for state, steps, and numbers

If a new visual pattern keeps recurring, extract a shared component instead of
restyling each screen by hand.

## Preflight questions for agents

Before touching a Guildhall screen, answer these first:

- Which shared layout owns the outer spacing?
- Which existing component should own the surface?
- What heading level belongs here structurally?
- Which numbers deserve chips instead of sentence prose?
- Which semantic color role is being used, and why?
- Is this a known pattern we should extract instead of styling inline again?

If those questions are unanswered, do not move straight to bespoke CSS.

## Review questions

Before shipping a UI change, ask:

- Can a cold user explain what this screen is asking in one sentence?
- Is there one obvious primary action?
- Are numbers compact and scanable?
- Is the heading hierarchy clear?
- Are colors consistent with the semantic palette?
- Would a color-theory steward, a UI steward, and an accessibility steward all
  agree on why each visible color is there?
- Is any crucial detail hidden until needed, but still inspectable?
- Did we use shared primitives, or did we style a one-off box again?
