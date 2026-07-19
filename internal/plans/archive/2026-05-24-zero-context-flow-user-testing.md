---
title: Zero-context flow user testing
help_topic: web.zero_context_user_testing
help_summary: |
  Script for testing whether a fresh user can understand Guildhall Thread cards,
  task states, and human-input requests without prior chat context.
---

# Zero-context flow user testing

This is the product-surface test for Guildhall task cards and Thread flows. It
exists because a UI can have working buttons and still fail if a user cannot
tell what Guildhall wants, who owns the next move, how hard the next action is,
or whether clicking is required or merely optional.

The goal is not to prove that a clever tester can infer the right path. The
goal is to find the easiest, clearest path a real user could follow while
holding a product idea, project constraint, or release decision in their head.

## Pass/fail rule

A screen fails if the tester has to infer the product meaning from Guildhall
internals, prior conversation, raw task JSON, agent vocabulary, or lucky
guessing. "I think maybe..." is not a pass.

Score the screen `0/10` when any of these are true:

- The tester cannot say what the card means in plain language.
- The tester cannot tell whether there is anything for them to do.
- The tester cannot tell who owns the next step: them, Guildhall, or nobody
  right now.
- The tester thinks a disabled, queued, or informational card is actionable
  because it has a primary-looking button.
- The tester clicks through and the next surface repeats the same vague ask
  instead of explaining the decision, context, and next action.
- The tester sees internal labels such as gate names, acceptance-criteria IDs,
  task-state jargon, or agent handoff language before they understand the user
  job.
- The tester can technically identify an action but says the screen feels too
  busy, too text-heavy, or too indirect to act confidently.
- The action is visible only after reading unrelated detail or scrolling past a
  large card.

Score the screen no higher than `6/10` when any of these are true:

- The tester understands the state but cannot say why this is the easiest way
  to provide the needed information.
- The tester understands the button but cannot tell whether clicking is
  required now or optional exploration.
- The tester needs to read more than one dense paragraph before knowing the next
  move.
- The tester identifies copy that is correct but not natural human language.
- The tester says a badge, chip, color, or card treatment feels noisy,
  redundant, or visually misleading.

## Minimal app intro

Give the tester only this:

> Guildhall turns project notes and requests into work for local agents. The
> Thread page shows current project work, questions, blockers, and tasks that
> may need attention.

Do not explain the specific project, task history, implementation details, or
what the correct answer is supposed to be.

## First-card questions

Show one card or screenshot. Ask these before any click:

1. What do you think this card is saying?
2. Is there anything for you to do here?
3. Who do you think owns the next step: you, Guildhall, or no one right now?
4. What do you think the badges mean?
5. Does anything look disabled, greyed out, queued, or not ready? Why?
6. Which button would you click, if any?
7. What do you expect that button to do?
8. What information would you need before you could act with confidence?
9. Is this the easiest and most intuitive way to give Guildhall that
   information?
10. What, if anything, feels overwhelming, busy, duplicated, or too subtle?
11. How much text do you feel you have to read before knowing the next step?
12. Are the line lengths comfortable to scan, or does any text feel wall-like?
13. Which controls look required, and which look optional?
14. Do any buttons look too strong for what they do, or too weak for what they
   ask from you?
15. What would you remove, collapse, rename, or move higher on the card?

If the card uses a specific label, ask directly:

- What do you think "`Guildhall next`" means?
- What do you think "`Needs recovery`" means?
- What do you think "`Needs task brief`" means?
- What do you think "`Review checklist`" or "`Open checklist`" will open?

## Click-through questions

After the tester clicks the button they chose:

1. Did the result match what you expected?
2. What is Guildhall asking for now?
3. What decision, if any, are you supposed to make?
4. How would you give Guildhall that answer?
5. Are you more confident, less confident, or equally confused after the click?
6. Did the click reduce the amount you had to figure out, or did it add another
   layer of interpretation?
7. Does the new surface ask for one thing, or does it ask you to inspect a
   packet of context and decide what matters?
8. Is the primary action now obvious without hunting?

The click-through fails if the new screen only says the task "needs" something
without explaining what decision is needed, why it matters, and what action
will satisfy it.

## Cognitive-overhead checks

Every task card or human-input request must pass these checks:

- One job: the card asks the user to do one understandable thing.
- Plain language: the card says what happened and what is needed without agent
  or verification-system jargon.
- Ownership: the card makes clear whether the next move belongs to the user or
  Guildhall.
- Button truth: primary buttons perform the main action; secondary buttons
  navigate or reveal detail.
- Progressive disclosure: details help the decision, but the default card does
  not require reading a technical packet.
- State consistency: badges, status text, checklist labels, visual treatment,
  and buttons describe the same state.
- Visual affordance: a dimmed or greyed card does not look accidentally
  disabled unless it truly cannot be acted on.
- Completion path: after reading the card, the tester can explain how to move
  the task forward.
- Minimum reading: the next required action is clear from the headline,
  state copy, and first visible control. Details can help, but they cannot be
  required just to orient.
- Text load: the default card keeps paragraphs short, avoids repeated labels,
  and keeps line lengths comfortable enough to scan on desktop and mobile.
- Required vs optional: required actions use direct labels and clear placement;
  optional links, notes, provenance, history, diagnostics, and source detail are
  visibly secondary.
- Information scent: button labels say the object and outcome, not just the
  destination. Prefer `Answer question`, `Open checklist`, `Resume Guildhall`,
  or `Reframe task...` over vague `Open`, `Review`, or `Continue`.
- Friction check: if a user must leave the card, the next surface must preserve
  context and put the requested input/action in view.
- Silence check: if no user action is required, the card must say that plainly
  and avoid primary-looking buttons.

## Scoring rubric

Use this rubric in addition to the pass/fail rules:

- `9-10`: The user can state the meaning, owner, required action, and expected
  click outcome within a few seconds. The card feels calm and obvious.
- `7-8`: The path is clear, but one label, layout choice, or secondary detail
  adds mild friction.
- `5-6`: The user can infer the path but has to guess, scroll, or read too much.
- `3-4`: The state is partly understandable, but action ownership or button
  semantics are muddy.
- `1-2`: The user can identify topic words but cannot safely act.
- `0`: The card asks the user to reverse-engineer Guildhall.

## Required regression cases

These cases must be included in future flow audits:

- A pressure-test question generated from a saved project check-in. The prompt
  must read like a complete question, not a title pasted into a sentence.
- A ready task with an incomplete task brief checklist. It must not render as
  `Guildhall next`, must not look runnable, and must explain that Guildhall
  needs a success target plus acceptance criteria before it can build.
- A recovery/blocker card. It must explain what decision is needed, who should
  make it, and exactly how to provide the answer.
- A queued/running task. It must not present navigation as a giant primary
  action, and it must not imply the user needs to intervene when Guildhall owns
  the next move.

## Zero-context agent protocol

When using another agent as the tester, give it only the app intro and a
screenshot or browser state. Tell it to answer as an ordinary first-time user,
not as an engineer reconstructing internals. Ask it to avoid charitable
interpretation: if a label or button requires guessing, it should say so and
mark the screen failed.

## Low-context expert protocol

For low-context reviews, give the agent this plan and one product lens:

- Cognitive-load reviewer: focus on reading burden, line length, number of
  simultaneous concepts, and whether the user must remember hidden context.
- Interaction-design reviewer: focus on affordances, button hierarchy,
  optional-vs-required actions, progressive disclosure, and click outcomes.
- Product-operator reviewer: focus on whether a busy project owner can decide
  what to do next without understanding Guildhall internals.
- Accessibility reviewer: focus on scan order, visible labels, mobile/hoverless
  comprehension, contrast, density, and whether icon/chip-only meaning is
  exposed without tooltips.

These reviewers may know Guildhall exists, but they should not use local
conversation history as evidence that a screen is clear.

## Audit loop

1. Pick 3-5 representative flows: first project check-in, incomplete task
   brief, recovery/blocker, queued runnable task, and global Needs You.
2. Capture the first visible screen before scrolling.
3. Run at least one no-context comprehension pass and one low-context expert
   pass per risky flow.
4. Convert every score below `7/10` into a concrete issue. Scores below `5/10`
   are release-blocking for that flow.
5. Fix the highest-impact issues first, then rerun the same screenshot or flow.
6. Do not mark a flow cleared until the user job, next owner, required action,
   optional actions, and visible button hierarchy are all legible without
   hidden context.
