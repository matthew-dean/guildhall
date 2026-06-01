---
title: Research-backed design
---

# Research-backed design

Guildhall borrows from research and practice, but it does not pretend a paper
can make product decisions for you. The research helps explain why the product
is shaped the way it is: smaller tasks, bounded questions, visible uncertainty,
review loops, and an audit trail you can actually read.

This page is the backing shelf. It is not a manifesto, and it is not a claim
that Guildhall has solved the hard parts of AI-assisted software work. It is a
plain map from useful ideas to product choices.

## Cognitive load

**Source:** John Sweller's work on cognitive load theory, including
[*Cognitive Load During Problem Solving: Effects on Learning*](https://doi.org/10.1207/s15516709cog1202_4),
and the wider human-factors tradition around limited working memory, including
George Miller's
[*The Magical Number Seven, Plus or Minus Two*](https://doi.org/10.1037/h0043158).

**Accessible explainer:** The Interaction Design Foundation's
[*What is Cognitive Load?*](https://www.interaction-design.org/literature/topics/cognitive-load)
connects cognitive load to interface design: high mental effort makes products
harder to understand, remember, and use.

**What Guildhall takes from it:** a giant wall of context is a bad way to ask
for a decision. The app tries to show the smallest useful question, the reason
it matters, and the evidence behind it.

**Where it shows up:**

- one-question-at-a-time Pressure-Test Intake;
- compact task cards with deeper drawers nearby;
- Journey before raw Transcript on completed tasks;
- summary-plus-evidence references instead of dumping every receipt into the
  first screen;
- task sizing, so a worker and reviewer can hold the unit of work in their
  heads.

## Goal setting

**Source:** Edwin Locke and Gary Latham's
[*Building a Practically Useful Theory of Goal Setting and Task Motivation*](https://doi.org/10.1037/0003-066X.57.9.705).

**Accessible explainer:** MindTools has a plain-language overview of
[*Locke's Goal-Setting Theory*](https://www.mindtools.com/azazlu3/lockes-goal-setting-theory/)
that frames useful goals as clear, challenging, committed-to, feedback-rich,
and realistic enough to act on.

**What Guildhall takes from it:** clear goals change behavior. Vague "do your
best" prompts make it easier for an agent to sound busy while drifting away
from what you needed.

**Where it shows up:**

- task blueprints with goals, non-goals, acceptance criteria, and checks;
- request-shape detection before a New Request becomes work;
- separate learning/exploration from implementation when the goal is still
  uncertain;
- review against the accepted plan, not against how confident the transcript
  sounded.

## Flow and work in progress

**Source:** The Kanban method's emphasis on visualizing work, limiting work in
progress, and managing flow; see the
[Official Guide to the Kanban Method](https://kanban.university/kanban-guide/).

**Accessible explainer:** The official guide explains Kanban in practical
terms: make work visible, limit work in progress, manage flow, and improve the
system over time.

**What Guildhall takes from it:** more active work is not automatically more
progress. Too many open lanes make blockers easier to ignore and handoffs
harder to trust.

**Where it shows up:**

- finishing active implementation, review, and gate work before grabbing more;
- visible statuses instead of a vague "running" blob;
- task sizing and split recommendations;
- blocked work that stays visible instead of silently sinking under newer
  requests;
- review budgets, so inspection depth can scale without inviting every possible
  reviewer every time.

## Human-AI interaction

**Source:** Saleema Amershi and colleagues'
[*Guidelines for Human-AI Interaction*](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/),
validated through CHI 2019 design-practitioner studies and collected by
Microsoft Research.

**Accessible explainer:** Microsoft's
[*Eighteen best practices for human-centered AI design*](https://www.microsoft.com/en-us/research/articles/guidelines-for-human-ai-interaction-eighteen-best-practices-for-human-centered-ai-design/)
turns the research paper into product guidance about timing, uncertainty,
correction, explanation, and recovery.

**What Guildhall takes from it:** AI systems need to make their abilities,
uncertainty, mistakes, and recovery paths visible. When a system guesses, the
user needs a way to inspect, correct, and continue.

**Where it shows up:**

- clear routing for New Request before work starts;
- explicit uncertainty and clarifying questions;
- reframe before implementation, change orders after implementation starts;
- reviewer findings, gate output, changed files, and context evidence attached
  to tasks;
- Settings -> Memory suggestions that stay inspectable and reversible.

## Specs as design documents

**Sources:** Atlassian's
[*Software design document* guide](https://www.atlassian.com/work-management/knowledge-sharing/documentation/software-design-document),
Google's
[*Documentation best practices*](https://google.github.io/styleguide/docguide/best_practices.html),
and the broader RFC / engineering-design-doc tradition around problem framing,
proposed design, tradeoffs, and reviewable implementation intent.

**Plain-language frame:** a good technical spec is not just metadata about the
task. It should explain what the thing is, why it exists, what it is trying to
achieve, how the design works, what has been intentionally excluded, and how
someone will know the work is actually done. Different tasks need different
supporting sections. A UI-heavy spec may need behavior and interaction notes.
A backend spec may need contract, schema, rollout, or reliability details
instead.

**What Guildhall takes from it:** specs should behave like compact design docs.
Guildhall now leans toward a core spec shape with optional sections layered in
only when the task really needs them.

**Core sections Guildhall expects:**

- what this is
- problem / context
- goals
- non-goals
- proposed design
- key decisions
- acceptance criteria
- verification
- completion boundary

**Optional sections Guildhall may add when relevant:**

- user-facing behavior
- visual / interaction notes
- component / API shape
- data model / schema changes
- migration / rollout
- performance / reliability / security considerations
- risks / open questions
- handoff sequence

**Why this matters:** these sections are easier to validate deterministically
than a blob of prose, and they give reviewers a clearer frame for semantic
judgment. The validator can check that the design doc is structurally complete.
The reviewer can then ask a more interesting question: does the content in each
section actually support the task's goal, match what was asked for, and cover
the real user cases that came out of intake?

## UX review calibration

**Sources:** Nielsen Norman Group's
[*Ten Usability Heuristics*](https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1_Letter-compressed.pdf)
and
[*Usability Testing 101*](https://media.nngroup.com/media/articles/attachments/UsabilityTesting101_Letter_Size.pdf),
Baymard Institute's
[*Checkout UX 2025: 10 Pitfalls and Best Practices*](https://baymard.com/blog/current-state-of-checkout-ux),
the [Deceptive Patterns taxonomy](https://www.deceptive.design/types), and the
FTC's
[*Bringing Dark Patterns to Light* summary](https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers).

**Plain-language frame:** The heuristics give Guildhall a broad checklist for
legibility, control, consistency, recovery, and memory burden. Baymard gives it
concrete examples of flow friction in high-stakes forms and checkout-like
workflows. Deceptive Patterns and the FTC report give it names for the sharper
edge cases: designs that hide, steer, delay, obstruct, or trap.

**What Guildhall takes from it:** UX review works better when it is calibrated
against real failure cases. Guildhall checks for missing system status, internal
jargon, weak recovery paths, hidden safe options, late-disclosed cost or risk,
visual interference, and flows that make the reader's preferred path harder
than the product's preferred path.

**Where it shows up:**

- review calibration cases with hidden expected findings;
- UX, accessibility, copy, trust, and deceptive-design review lanes;
- screenshot, DOM, flow, and task-goal evidence requirements;
- negative controls, so reviewers are not rewarded for finding imaginary
  problems;
- review-plan budgeting, so high-risk flows get deeper review without making
  every task run every reviewer.

## What this does not mean

Research does not decide your product taste. It does not know your release
risk, your users, your codebase, or when a weird exception is worth it.

Guildhall uses these ideas as guardrails:

- keep decisions small enough to answer;
- keep work small enough to review;
- keep uncertainty visible;
- keep evidence attached;
- keep recovery paths honest.

When those guardrails make the app feel too cautious or too loose, that is a
product tuning problem, not a moral law from the literature.
