---
title: UX review calibration source notes
---

# UX review calibration source notes

Date: 2026-05-25

These notes support
`internal/design-notes/ux-review-calibration-and-work-review-integration.md`
and `internal/plans/2026-05-25-review-calibration-and-failure-corpus.md`.

The goal is not to import someone else's UX methodology wholesale. The goal is
to ground Guildhall's review-calibration corpus in failure modes that show up
across many products, not just in Guildhall.

## Source: Nielsen Norman Group usability heuristics

Reference:
<https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1_Letter-compressed.pdf>

Useful takeaways:

- Usability review should include system-status visibility: can the user tell
  what is happening now?
- Review should test whether the UI uses the user's language instead of
  internal jargon.
- Users need a way out of accidental or unwanted states.
- Consistency matters: different words/actions should not appear to mean the
  same thing unless they do.
- Error prevention is preferable to late error messaging.
- Recognition beats recall: controls, options, and needed context should be
  visible instead of requiring memory.
- Minimalism is not just visual taste. Extra information competes with the
  information the user needs.
- Error messages need plain language, precise diagnosis, and a constructive
  recovery path.

How this maps to calibration cases:

| Heuristic family | Corpus category | Example review test |
| --- | --- | --- |
| System status | Feedback and system status | Can the reviewer notice that the user cannot tell whether work is queued, running, failed, or complete? |
| Match with real world | Comprehension / language | Can the reviewer identify internal terms that a target user would not know? |
| User control | Recovery / escape hatch | Can the reviewer catch a flow that traps users in a state without a clear cancel, undo, or back path? |
| Consistency | Cross-surface consistency | Can the reviewer catch two screens using different labels for the same state? |
| Error prevention | Error and recovery | Can the reviewer prefer preventing the bad submission over explaining the failure after the fact? |
| Recognition over recall | Task path / memory burden | Can the reviewer catch a flow that requires remembering prior context or hidden rules? |
| Aesthetic/minimalist | Information hierarchy | Can the reviewer catch a screen where correct details crowd out the main action? |
| Error recovery | Error and recovery | Can the reviewer catch errors without a user-recoverable next step? |

Corpus seed ideas:

- A settings page labels one option `defer` and another `put aside`, but both
  appear to pause work.
- A task card says `Blocked` while the action says `Continue`, without saying
  what will happen.
- A form rejects a submission after upload even though it could have explained
  requirements before capture.
- A diagnostic panel leads with raw implementation identifiers before explaining
  the user-level problem.

## Source: Nielsen Norman Group usability-testing framing

Reference:
<https://media.nngroup.com/media/articles/attachments/UsabilityTesting101_Letter_Size.pdf>

Useful takeaways:

- Qualitative usability testing is for uncovering problems and opportunities,
  not proving perfection.
- Realistic users and realistic tasks matter.
- The moderator should avoid over-explaining the interface while testing; the
  point is to discover what the interface communicates by itself.
- Five to eight participants is a common qualitative range, but Guildhall's
  agent-based calibration should treat that as inspiration, not as a substitute
  for human testing.

How this maps to calibration cases:

- The reviewer-under-test should receive a small user/task intro, not the hidden
  expected finding.
- The review prompt should ask what the reviewer can infer from the surface,
  where they are guessing, and what a real user would likely misunderstand.
- A single missed finding is useful evidence. Calibration is iterative: add the
  case, adjust one variable, rerun, and compare.

Corpus seed ideas:

- Give an agent only a screenshot and a one-sentence user goal.
- Give another run the same screenshot plus product context.
- Compare whether extra context improves detection or causes the agent to
  rationalize the flawed UI.

## Source: Baymard checkout and form UX research

References:

- <https://baymard.com/blog/current-state-of-checkout-ux>
- <https://baymard.com/learn/audit-checkout-flow-hidden-friction>
- <https://baymard.com/research/checkout-usability>
- <https://baymard.com/blog/mobile-ecommerce-checkout-forms>

Useful takeaways:

- Checkout is a good corpus domain because it is a high-stakes, cross-industry
  task flow with clear user goals and many known failure modes.
- Baymard frames many problems as invisible friction: analytics may show where
  users drop, but not why the UI made completion feel risky or effortful.
- The audit guide emphasizes structured review, specific behavior notes, and
  desktop plus mobile testing rather than vague impressions.
- Common friction areas include hidden or delayed total costs, buried guest
  checkout, account creation too early, excessive visible fields, poor progress
  orientation, form-field friction, and checkout interruptions.
- Baymard's research pages are useful not only for checkout. They provide
  reusable patterns for any workflow with cost clarity, account friction,
  forms, progress, confirmation, and recovery.

How this maps to calibration cases:

| Baymard pattern | Generalized corpus category | Non-commerce analogue |
| --- | --- | --- |
| Hidden/delayed total cost | Trust and state honesty | A cloud deploy flow reveals quota/cost only after configuration. |
| Guest checkout hard to find | Task path / obstruction | A docs site hides "read without signup" under a login panel. |
| Account creation too early | Friction and interruption | An app asks for workspace setup before letting the user inspect imported results. |
| Too many visible fields | Cognitive load / information hierarchy | A settings wizard shows every advanced toggle before the user chooses the basic mode. |
| Missing progress orientation | Feedback and system status | A migration flow runs multiple steps but does not say which step is active. |
| Form-field ambiguity | Recognition vs recall | A CLI prompt asks for an unscoped `name` when it needs `project display name`. |
| Weak confirmation closure | Trust | A task runner says "done" without showing what changed or what remains. |

Corpus seed ideas:

- A checkout-like flow where the primary task is technically possible, but the
  safest path is hidden below a more prominent account/login path.
- A form where labels only make sense with offscreen section headers.
- A multi-step flow with a progress indicator that does not match the real
  remaining work.
- A completion screen that confirms success without enough evidence for the
  user to trust it.

## Source: Deceptive Design taxonomy

Reference:
<https://www.deceptive.design/types>

Useful takeaways:

- Deceptive patterns are useful calibration cases because they make reviewers
  distinguish "effective conversion design" from user-hostile design.
- The taxonomy includes comparison prevention, confirmshaming, disguised ads,
  fake scarcity, fake social proof, fake urgency, forced action, hard to cancel,
  hidden costs, hidden subscription, nagging, obstruction, preselection,
  sneaking, trick wording, and visual interference.
- The corpus should include ethical UX failures, not just accidental usability
  failures.

How this maps to calibration cases:

| Deceptive pattern | Review test |
| --- | --- |
| Hidden costs | Can the reviewer notice material cost/commitment appears too late? |
| Hard to cancel | Can the reviewer compare signup effort with cancellation effort? |
| Obstruction | Can the reviewer identify barriers added to the user's desired path? |
| Preselection | Can the reviewer identify defaults that steer a decision? |
| Trick wording | Can the reviewer catch misleading negation or ambiguous button copy? |
| Visual interference | Can the reviewer notice an important choice is visually suppressed? |
| Forced action | Can the reviewer catch required unrelated behavior before task completion? |
| Nagging | Can the reviewer identify repeated interruptions that work against the user's goal? |

Corpus seed ideas:

- A notification permission dialog where the safe choice is styled as a weak
  text link and the invasive choice is primary.
- A cancellation flow that makes "keep subscription" one click but "cancel" a
  multi-page maze.
- A privacy form with preselected sharing options and vague descriptions.
- A comparison table that hides the plan dimension users need to compare.

## Source: FTC dark-pattern report summary

Reference:
<https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers>

Useful takeaways:

- Regulatory framing matters for high-stakes UX review. Some design failures
  are not just frustrating; they can manipulate payment, cancellation, privacy,
  or consent.
- The FTC calls out disguised ads, difficult cancellation, buried terms or junk
  fees, and data-sharing tricks as common tactics.
- It also names hard-to-read disclosures, pre-checked boxes, confusing
  cancellation policies, and designs that obscure or impair consumer choice.

How this maps to calibration cases:

- Add a `legal_or_ethics_risk` flag to calibration cases.
- Require a stricter review recipe for subscriptions, payments, privacy,
  consent, ads, children, financial products, and health-related flows.
- Score whether the reviewer identifies harm to user autonomy, not only
  conversion or task completion.

Corpus seed ideas:

- A loan or pricing flow where the headline promises no fees but mandatory fees
  are hidden behind tooltip/detail UI.
- A privacy prompt where "accept all" is primary and "reject" requires more
  steps.
- A cancellation page where promotions interrupt the path and links send users
  away from cancellation.

## Source-backed corpus rules

1. **Each case needs a user goal.**
   A screenshot without a goal turns review into aesthetic critique.

2. **Each case needs hidden expected findings.**
   The reviewer under test must not see the answer key.

3. **Each finding needs user impact.**
   "This label is weird" is too weak. The finding should say what the user
   cannot understand, cannot do, may do by mistake, or cannot recover from.

4. **Each case should map to one or more generalized categories.**
   This is what prevents overfitting to a specific product.

5. **Each case should include false-positive traps.**
   A calibrated reviewer should not complain about every dense screen if the
   density is appropriate for the user's task and expertise.

6. **Each case should identify what evidence was necessary.**
   Some failures require a screenshot, some require click-through, some require
   copy only, and some require cross-surface state.

7. **Ethical/deceptive failures deserve their own lane.**
   They can look like "business optimization" unless the reviewer is explicitly
   asked to evaluate user autonomy and consent.

8. **Calibration should record misses, not hide them.**
   If the reviewer misses the expected finding, that result is the point of the
   test. The Coordinator should use it to compare context/model/settings/prompt
   changes.

## Source-backed initial case list

These are suggested seed cases to build first:

1. **Ambiguous system status**
   A multi-step process shows "working" but gives no current step, time
   expectation, or recovery path.

2. **Internal jargon in a user decision**
   A screen asks the user to choose using internal status names or implementation
   terms.

3. **Hidden safe path**
   The user's desired low-commitment path exists but is visually de-emphasized
   under a more business-preferred path.

4. **Late material disclosure**
   Cost, risk, permission scope, or commitment appears after the user has
   invested effort.

5. **Error without recovery**
   The error names a failure but does not say what the user can do next.

6. **Form label depends on missing context**
   A field label makes sense only if the user remembers an offscreen section
   heading.

7. **Primary action mismatch**
   A button label promises navigation or review, but the next surface actually
   requires a decision or commitment.

8. **Visual interference**
   The recommended or protective option is present but visually hidden,
   obscured, or dominated by another action.

9. **Cancellation asymmetry**
   Sign-up is one screen; cancellation is hidden, multi-step, or interrupted.

10. **Confirmation without trust evidence**
    A flow says "done" but does not show what changed, what was saved, or where
    the user can verify it.

