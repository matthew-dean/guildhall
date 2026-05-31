# Guildhall 0.10 Bounded Chat Feature Spec

## Goal

Move selected Guildhall user interactions from persistent open-ended Thread
transcripts into bounded chats: short, objective-driven conversations that end
when the objective is fulfilled and persist only distilled system memory,
project changes, task changes, setting changes, and evidence.

The first 0.10 targets are:

- project intake and project check-in interviews;
- async-style Thread-based deep intake questions;
- New request classification and shaping;
- simple direct actions that can be completed inside the same chat, such as
  changing a setting;
- follow-up questions that must feel conversational without becoming a permanent
  transcript the system later treats as truth.

The user experience should feel like talking to Guildhall, not filling out a
form. The runtime behavior should be deterministic enough that Guildhall knows
which objective is active, what remains unanswered, what was recorded, and why
the chat ended.

## Product Thesis

Thread remains the command surface, but not every command needs to become a
long-lived conversation. Some interactions are better modeled as purposeful
sessions:

- "Learn enough about this project to configure Guildhall."
- "Turn this rough request into runnable work."
- "Clarify this one project fork."
- "Update this setting and confirm it."

Bounded chat gives Guildhall a more natural owner-facing interface while
protecting the system from transcript drift. The chat may be warm and flexible,
but the state machine underneath is explicit: an objective starts, the
coordinator decides what would fulfill it, the conversation asks only useful
questions, durable facts are recorded as structured data, and the chat closes.

This should replace the current async Thread question pattern for deep intake.
Instead of scattering multiple long-lived question cards through Thread, Inbox,
Overview, and task detail, Guildhall should show one notification that it has
questions. Activating that notification opens the bounded chat for the active
objective. The questions happen inside that focused chat surface, then the chat
closes and leaves a receipt.

## Non-Goals

- Do not replace all of Thread. Long-running task activity, evidence, recovery,
  review, and status should still appear in the main project surface.
- Do not keep raw bounded-chat transcripts as durable project memory.
- Do not make every bounded chat an intake wizard. A New request may become a
  task, a setting update, a question, a recovery action, or a refusal.
- Do not make the user choose internal Guildhall process paths.
- Do not let the conversational agent write durable memory, settings, or tasks
  directly.
- Do not keep rendering deep-intake questions as separate async Thread cards
  once a bounded-chat session exists for the objective.

## Replacement Map

Bounded chat should become the standard pattern for owner input that needs
flexible back-and-forth before Guildhall can safely proceed. The triggering
condition is not only "Guildhall has a question." It is broader:

> Guildhall needs more information, permission, judgment, prioritization, or
> human help to resolve an active objective.

Use bounded chat for:

- **Deep intake questions:** replace separate async Thread question cards with
  one bounded-chat notification and session.
- **Pressure-test intake follow-ups:** keep follow-ups inside the active
  objective instead of creating more pending cards.
- **Project check-ins:** ask project-level direction questions inside a bounded
  chat and persist only accepted facts or decisions.
- **New request:** open the bounded-chat surface directly from the button.
- **Task shaping:** clarify rough, underspecified, or ambiguous work before
  creating or approving a task draft.
- **Simple setting changes:** complete low-risk setting updates in chat with a
  receipt, and confirm high-risk setting changes inside the same chat.
- **Capability and credential decisions:** ask for approval, denial, fallback,
  or credential/setup direction when the system needs owner-controlled access.
- **Recovery and blocker resolution:** use bounded chat when a task is blocked
  and the right path may require discussion, such as retrying, changing scope,
  supplying setup information, shelving the work, choosing a fallback, or
  turning the blocker into a new task.
- **Complex owner decisions:** use bounded chat when Guildhall knows the
  decision area but not yet the best option set, and a short interaction will
  produce a safer next action.
- **Multi-action resolution panels:** replace clusters of competing resolution
  buttons when the options need explanation, sequencing, or tradeoff judgment.

Do not use bounded chat for durable inspection surfaces:

- task execution evidence;
- review and gate proof;
- spec review documents;
- project activity history;
- task detail state;
- project Overview as the durable orientation surface.

Rule of thumb: bounded chat is for objective-bound conversation that should
close. Durable surfaces are for state, proof, artifacts, and history.

## Recommended Architecture

Use two collaborating roles plus a deterministic bounded-chat runtime.

### Conversation Agent

The conversation agent owns user-facing language. It should sound like a clear,
helpful Guildhall assistant. It receives a narrow packet:

- the active bounded-chat objective;
- the current question or action prompt;
- the current sub-objective history, such as the initial question and its
  follow-ups;
- a compact accepted-facts packet from prior sub-objectives;
- any coordinator-provided clarification text;
- allowed tool calls for the current turn.

The conversation agent may:

- ask the current question in natural language;
- rephrase a clarification supplied by the coordinator;
- explain why Guildhall needs an answer;
- submit the user's response for coordinator judgment;
- present a final sign-off when the coordinator closes the session.

The conversation agent may not:

- decide that a durable fact is true;
- update levers or settings;
- create, split, archive, or start tasks;
- decide that the objective is fulfilled;
- keep private transcript memory across bounded-chat sessions.

### Coordinator Agent

The coordinator agent owns project reasoning and objective fulfillment. It
receives project state, relevant artifacts, current tasks, settings, capability
state, and a structured record of the bounded chat.

The coordinator may:

- create the initial objective plan;
- classify user responses as answer, partial answer, confusion, correction,
  refusal, new request, or non-answer;
- decide whether a follow-up is valuable;
- record accepted facts, decisions, discarded answers, memory updates, task
  mutations, setting updates, and evidence;
- return clarifying text when the user asks a question instead of answering;
- decide that the chat objective is fulfilled;
- decide that the chat is blocked and needs a different surface or owner
  action.

The coordinator should be deterministic wherever possible. Model reasoning is
used to interpret intent and project consequences, but the session state
machine controls what can happen next.

### Runtime

The bounded-chat runtime owns persistence, transitions, tool contracts, and
projection into the UI. It is not an LLM role.

It stores:

- bounded chat id;
- project id;
- source surface, such as `thread:new-request` or `settings:intake`;
- objective kind;
- objective status;
- current sub-objective;
- planned question queue, when applicable;
- accepted facts and decisions;
- discarded or unresolved responses;
- produced task, memory, setting, and evidence changes;
- a closure receipt.

It does not store raw chat as durable project memory. Local debug history may
exist under normal runtime retention rules, but the project-facing record is the
structured result.

## Context Bounding Policy

Do not bind context as strictly as "one root question only." That loses useful
follow-up nuance and can make Guildhall sound forgetful. Instead:

1. A bounded chat has one top-level objective.
2. Intake-style chats can contain multiple root questions.
3. Each root question opens a sub-objective chain.
4. Raw conversational context is available only inside the active sub-objective
   chain.
5. When the coordinator advances to the next root question, raw text from the
   previous chain is dropped from the active prompt.
6. Accepted facts, accepted decisions, unresolved forks, and discarded-answer
   records carry forward as structured state.

This gives the agents enough continuity to avoid asking the user to repeat
themselves, while preventing a long transcript from becoming the hidden source
of truth.

## Data Model

```ts
type BoundedChatObjectiveKind =
  | 'project_intake'
  | 'project_check_in'
  | 'new_request'
  | 'task_shaping'
  | 'setting_update'
  | 'recovery_decision'
  | 'capability_decision'

type BoundedChatStatus =
  | 'active'
  | 'waiting_for_user'
  | 'coordinator_review'
  | 'fulfilled'
  | 'blocked'
  | 'cancelled'

type BoundedChatSession = {
  id: string
  projectId: string
  source: string
  objective: {
    kind: BoundedChatObjectiveKind
    label: string
    successCriteria: string[]
    startedAt: string
  }
  status: BoundedChatStatus
  activeSubObjective?: BoundedChatSubObjective
  coordinatorPlan?: BoundedChatCoordinatorPlan
  acceptedState: BoundedChatAcceptedState
  pendingActions: BoundedChatAction[]
  closure?: BoundedChatClosure
}

type BoundedChatSubObjective = {
  id: string
  rootQuestionId?: string
  objective: string
  prompt: string
  followUpDepth: number
  localTurns: BoundedChatTurn[]
  status: 'active' | 'answered' | 'discarded' | 'blocked'
}

type BoundedChatAcceptedState = {
  facts: AcceptedFact[]
  decisions: AcceptedDecision[]
  leverUpdates: LeverUpdate[]
  settingUpdates: SettingUpdate[]
  taskDrafts: TaskDraft[]
  unresolvedForks: UnresolvedFork[]
  discardedResponses: DiscardedResponse[]
}
```

The exact storage can reuse existing pressure-test intake, inbox, task, and
memory files at first, but the runtime should expose a single bounded-chat
contract so UI and agents do not keep special-casing intake cards.

## Tool Contract

The conversation agent should interact with bounded chat through tools rather
than by directly mutating project files.

### `bounded_chat.get_next_prompt`

Inputs:

- `sessionId`
- optional `lastVisibleTurnId`

Returns one of:

- `ask_user`: a prompt, choices, helper context, and answer constraints;
- `clarify`: a coordinator-supplied response to the user's clarification
  request;
- `action_completed`: a completed direct action receipt;
- `done`: final sign-off and closure receipt;
- `blocked`: the reason and next surface/action.

### `bounded_chat.submit_user_response`

Inputs:

- `sessionId`
- `subObjectiveId`
- `response`
- optional selected choice ids

Returns:

- `accepted_answer`: accepted facts or decisions and next prompt status;
- `needs_follow_up`: follow-up prompt and why it is needed;
- `clarification_answer`: response text to give the user while keeping the same
  question active;
- `discarded_response`: non-answer/confusion classification and replacement
  prompt;
- `new_objective_detected`: route to New request classification or ask the user
  whether to switch objectives;
- `done`: closure receipt.

### `bounded_chat.apply_coordinator_action`

Internal coordinator/runtime tool. Applies approved mutations:

- write memory records;
- update levers or settings;
- create or update task drafts;
- resolve inbox items;
- record evidence;
- close the bounded chat.

This tool should be schema-checked and idempotent. The coordinator proposes a
patch; the runtime validates and applies it.

## Project Intake Flow

### Start

The coordinator reviews project state first:

- registered artifacts and project files;
- existing tasks and task graph;
- settings and levers;
- project memory;
- known capability requests;
- previous discarded answers or failed questions.

It then creates an intake plan:

```ts
type IntakePlan = {
  objective: 'Learn enough to configure and shape this project'
  parameters: {
    depth: 'shallow' | 'normal' | 'deep'
    domains: string[]
    maxRootQuestions: number
    maxFollowUpsPerQuestion: number
  }
  questions: IntakeQuestion[]
}
```

The plan must prefer project evidence over owner questions. A question is valid
only if the answer would change task shaping, project routing, review criteria,
automation policy, settings, or execution safety.

When the plan contains owner questions, Guildhall should create one visible
question notification for the project, not one UI item per planned question.
Overview, Inbox, and Thread may all expose that same pending item, but each
entry point should open the same bounded-chat session. The user should not see
a backlog of individual intake questions before the conversation starts.

### Ask One Root Question

The conversation agent asks the next coordinator-approved root question. The
question should be concrete and answerable. It can include multiple-choice
options when the coordinator has real candidate positions, plus an open answer
path when the choices are incomplete.

### Judge The Response

The coordinator classifies the response:

- **answer:** record the fact or decision and move on;
- **partial answer:** ask a targeted follow-up if a remaining fork matters;
- **clarification request:** return clarifying text and keep the same question;
- **confusion:** mark the prompt as failed or too abstract, then ask a better
  version if the information still matters;
- **non-answer:** discard and ask again only if the objective still needs it;
- **correction:** update accepted state and, if needed, repair previous facts;
- **new request:** pause or branch according to the New request policy.

### Follow-Up Policy

Ask a follow-up only when all of these are true:

- the user answered the current question;
- the answer leaves a specific unresolved fork;
- that fork would change a real Guildhall behavior;
- the follow-up can be asked in one clear question;
- the session remains inside follow-up limits.

Do not ask follow-ups just to make an answer more polished, quote the user's
answer back at them, or gather generic flavor.

### Advance Or Close

When no valuable follow-up remains, the coordinator advances to the next planned
question. Accepted structured state carries forward. Raw local turns from the
previous question chain are no longer injected into the active prompt.

When questions are exhausted, the coordinator closes the chat with a receipt:

- facts learned;
- settings or levers updated;
- task drafts created or changed;
- unresolved items, if any;
- where the user can see the result.

The UI shows the bounded chat as done. It should not keep the chat open as a
scrolling transcript.

## New Request Flow

New request starts without predefined intake questions. The coordinator first
classifies the request.

The New request button should open a fresh bounded-chat surface immediately.
The first objective is:

> Classify this request and either complete it, turn it into shaped work, ask
> the minimum needed question, or explain why it is blocked.

This is not an async form submission that later creates Thread questions. The
request itself begins as a bounded chat. If the coordinator can complete the
request with a direct action or task draft, the chat can end in the same
surface. If the coordinator needs intake questions, those questions continue in
that bounded chat.

```ts
type NewRequestClassification =
  | { kind: 'direct_action'; action: SettingUpdate | CapabilityDecision }
  | { kind: 'task_request'; needsIntake: boolean; proposedTask?: TaskDraft }
  | { kind: 'question'; answerMode: 'project_state' | 'help' | 'docs' }
  | { kind: 'recovery_action'; targetId: string }
  | { kind: 'unsupported_or_blocked'; reason: string }
```

### Direct Action

If the request is a safe direct action, such as changing a setting, the
coordinator proposes the mutation and the runtime applies it. The conversation
agent replies with a short receipt:

> Setting updated. Guildhall will now ask before starting work that needs
> external credentials.

The bounded chat closes immediately.

### Task Request

If the request is already specific enough, the coordinator creates or updates a
task draft and closes the chat with a receipt and next action.

If the request needs shaping, the coordinator creates a question plan just for
that task request. This plan follows the same sub-objective/follow-up rules as
project intake, but the objective is narrower:

> Learn enough to turn this request into runnable work.

### Simple Question

If the user is asking about project state or Guildhall behavior, the coordinator
answers from project state and closes the chat. If answering reveals that a task
or setting change is needed, the coordinator may offer to start a new bounded
chat objective rather than silently switching objectives.

### Blocked Or Unsupported

If the request needs a human-visible capability decision, missing credentials,
or unsupported host access, the coordinator closes the bounded chat as blocked
with the exact next action. Capability expansion must remain explicit and
auditable.

## Recovery And Blocker Resolution

Some blocked work needs more than a button choice. The owner may need to ask
what happened, compare options, supply missing setup information, or decide
whether the original task is still worth doing. Bounded chat should be the
default interaction model for those cases.

The coordinator starts with a blocker objective, such as:

> Resolve the Stripe setup blocker enough to retry, change scope, shelve the
> task, or create a follow-up task.

The chat should present the current blocker, the known options, and the
recommended path if Guildhall has one. The user can then ask clarifying
questions or propose another route. The coordinator records the chosen
resolution as structured state:

- retry with new evidence or setup instructions;
- mark blocked pending external owner work;
- shelve or cancel;
- revise the task scope;
- create a new prerequisite task;
- request a capability or credential decision;
- record that Guildhall cannot proceed safely.

When the resolution is chosen and applied, the bounded chat closes with a
receipt. If no safe path exists, it closes as blocked with one concrete next
action rather than leaving an open-ended conversation.

### Replacing Resolution Button Clusters

Bounded chat can reduce UI where Guildhall currently shows several competing
actions to resolve one situation. If a blocker or owner-input card would need
buttons like `Retry`, `Shelve`, `Change scope`, `Create prerequisite`, and
`Request access`, prefer one primary action that opens a bounded chat.

Good labels name the user's job, not the implementation:

- `Resolve blocker`
- `Choose next step`
- `Work through this`
- `Answer and resolve`
- `Decide how to proceed`
- `Review options`

Use the most specific label the coordinator can justify. For example:

- a blocked credential task should use `Resolve setup blocker`;
- an unclear request should use `Shape request`;
- a project check-in should use `Answer project questions`;
- a recovery item with several viable paths should use `Choose next step`.

Inside the bounded chat, the first coordinator prompt should summarize the
situation and offer the known options while allowing the user to ask questions
or propose another route. The UI still may show one secondary direct action
when it is obviously safe and common, such as `Cancel`, `Dismiss`, or `View
details`, but it should not present a dense action menu when the correct choice
depends on discussion.

## Objective Switching

Users will sometimes answer a question by asking for something else. The
coordinator should classify this instead of treating the response as a bad
answer.

Rules:

- If the new request is a clarification about the current question, answer it
  and keep the current question active.
- If the new request is a correction to accepted state, record the correction
  and decide whether the current question still matters.
- If the new request is a new task or setting action, ask whether to switch or
  queue it unless the current objective is already fulfilled.
- If the current objective is safety-critical, do not abandon it silently.

## UI Behavior

Bounded chat should use a focused chat surface opened from clear entry points.
For 0.10, the recommended UI is a route-backed modal overlay:

- it opens over the current project view so answering feels lightweight;
- it has a real route or session id so refresh, back/forward, and deep links do
  not lose the active objective;
- it can expand to a full-page layout on narrow screens or unusually long deep
  intake sessions;
- closing it returns the user to the previous project view with a compact
  receipt or pending notification.

Thread should not become the chat transcript. Thread, Overview, Inbox, and task
detail should show at most one active notification per bounded-chat objective,
such as `Guildhall has 3 project questions` or `Finish shaping this request`.
Clicking that notification opens the bounded-chat surface. Closed chats may
leave compact activity receipts, but not answer boxes or separate old question
cards.

Required states:

- **Active:** shows the current prompt, optional choices, and answer box.
- **Thinking:** coordinator is judging or applying structured updates.
- **Clarifying:** Guildhall answered the user's clarifying question and still
  needs the original answer.
- **Done:** shows a receipt and no answer box.
- **Blocked:** shows the blocker and one clear next action.
- **Cancelled:** shows that no durable change was made unless prior accepted
  actions already happened.

The done receipt should answer:

- what changed;
- what Guildhall learned;
- what remains open;
- where to go next.

The UI should not ask the user to inspect raw state, old inbox items, hidden
task records, or internal agent roles to understand whether the chat is done.

### Notification Rules

- One bounded-chat objective creates one actionable notification.
- The same notification can be projected into Overview, Inbox, Thread, and
  related task detail surfaces, but it must resolve to the same session.
- Planned root questions and follow-ups are internal to the session and should
  not appear as separate Inbox rows.
- A completed session resolves the notification everywhere.
- If a bounded chat is blocked, the notification should change to the blocker
  action rather than leaving stale question copy visible.
- When one situation has several possible human resolution actions, project
  surfaces should prefer one bounded-chat entry point over a row of competing
  buttons unless one option is clearly safe, common, and reversible.

## Memory And Privacy Policy

Bounded chat output is system memory, not user-visible transcript history.

Persist:

- accepted project facts;
- accepted user preferences;
- setting and lever updates;
- task drafts and task changes;
- discarded-response metadata;
- evidence that a bounded chat fulfilled or failed its objective;
- a closure summary.

Do not persist as project memory:

- raw conversational turns;
- speculative coordinator reasoning;
- rejected candidate facts;
- full user responses that were classified as confusion or non-answer;
- clarifying side conversations unless they produced accepted state.

Discarded-response records should be useful for improving prompts without
punishing the user. Store the classification and enough redacted context to
avoid repeating the bad question, not the full confusing exchange.

## Error Handling

### Coordinator Failure

If the coordinator cannot classify a response, keep the chat active and ask a
fallback deterministic question:

> I did not get enough signal to update the project safely. Which of these is
> closest?

The fallback should offer concrete options derived from the current objective,
not a generic "can you clarify?" loop.

### Tool Failure

If applying a coordinator action fails, do not tell the user the objective is
done. Show a blocked receipt with:

- attempted action;
- failed write or validation;
- whether any partial changes landed;
- next retry or recovery action.

### Model Drift

If the conversation agent tries to answer outside the active objective, the
runtime should reject the tool response and re-issue the current prompt packet.

### Stale Session

If project state changes while a bounded chat is active, the coordinator must
refresh before applying durable updates. The session can either continue with a
new prompt or close as stale with a restart action.

## Acceptance Criteria

1. Project intake can run as a bounded chat with root questions and follow-ups,
   then close with only structured memory and a receipt.
2. Moving from one root intake question to the next drops raw local turns from
   prompt context while carrying accepted structured state forward.
3. Confused answers and clarifying questions are not recorded as durable project
   facts.
4. Valuable follow-ups are asked only when a specific unresolved fork remains.
5. New request can classify and complete a simple setting update in one bounded
   chat.
6. New request can classify a task request and either create a task draft or
   start a narrow shaping sub-objective.
7. The UI clearly shows active, thinking, done, blocked, and cancelled states.
8. Closed bounded chats do not render as permanent transcript threads.
9. Runtime tests prove coordinator actions are schema-checked and idempotent.
10. Async-style Thread-based deep intake question cards are replaced by one
    actionable bounded-chat notification per objective.
11. Overview, Inbox, Thread, and task detail projections for the same bounded
    chat resolve to the same session and close together.
12. The New request button opens a bounded-chat session directly instead of
    submitting a request that later creates async Thread questions.
13. Recovery/blocker flows can open bounded chat for interactive resolution and
    close as retry, revised scope, shelved, prerequisite task, capability
    request, or blocked with a concrete next action.
14. Live browser proof shows the user can complete an intake question chain and
    see a done receipt with the resulting memory/task changes.

## Implementation Slices

### Slice 1: Runtime Contract

- Add bounded-chat types and storage.
- Add the session state machine.
- Add schema validation for coordinator actions.
- Add idempotent action application.
- Add tests for session creation, prompt retrieval, response submission,
  closure, blocked state, and stale-state rejection.

### Slice 2: Intake Adapter

- Route project intake and project check-in through bounded-chat sessions.
- Reuse the existing project-question planner for evidence-driven questions.
- Add follow-up limits and discarded-response records.
- Normalize old pressure-test question records into bounded-chat receipts where
  possible.

### Slice 3: New Request Adapter

- Add New request classification.
- Support direct setting updates.
- Support task draft creation.
- Support request-specific intake sub-objectives.
- Add tests for direct action, task request, clarification, refusal, and
  capability blocker paths.

### Slice 4: Recovery And Owner-Input Adapter

- Route complex blocker resolution through bounded-chat sessions.
- Convert retry/shelve/scope-change/prerequisite/capability decisions into
  structured coordinator actions.
- Ensure blocked sessions close with a concrete next action instead of
  remaining as open chat.
- Add tests for retry, revise scope, shelve, prerequisite task, capability
  request, and no-safe-path outcomes.

### Slice 5: UI

- Add the route-backed bounded-chat modal/overlay.
- Wire the New request button to open a fresh bounded-chat session.
- Replace async Thread deep-intake question cards with one actionable
  notification that opens the active bounded-chat session.
- Add done and blocked receipts.
- Stop projecting closed bounded chats as live question cards.
- Ensure Overview, Inbox, and Work count only active bounded chats as pending
  owner input.

### Slice 6: Docs And Release Proof

- Public docs should explain the user-facing behavior only after implementation
  is proven: "Guildhall asks focused questions and keeps the useful answers."
- Internal docs should keep the agent/runtime contract, memory policy, and
  state-machine details.
- Release proof should include project intake, New request direct action, New
  request task shaping, confusion handling, and stale-session recovery.

## Test Plan

Runtime tests:

- bounded-chat session state transitions;
- coordinator action validation and idempotency;
- context packet generation with raw local turns only for the active
  sub-objective;
- accepted facts carrying across root questions;
- discarded responses not becoming project memory;
- follow-up gating;
- direct setting update closure;
- task request shaping closure;
- blocker resolution outcomes;
- stale project-state rejection.

Projection tests:

- New request opens a bounded-chat session directly;
- Thread shows one active bounded-chat notification, not one card per intake
  question;
- Overview and Inbox show the same bounded-chat notification for the same
  objective;
- done receipts show no answer box;
- closed chats do not count as pending inbox questions;
- blocked chats route to the correct next action;
- Overview and Work do not show stale older blockers ahead of the active chat.

Live proof:

- run a project intake bounded chat against a fixture project;
- verify Overview and Inbox show one `Guildhall has questions` style
  notification before the chat opens;
- answer one root question, ask one clarifying question, answer a follow-up,
  advance to another root question, and close;
- verify persisted memory contains accepted facts only;
- verify discarded clarification text is not durable memory;
- verify `/api/stale-server` is `stale:false` before browser proof;
- verify Thread shows a done receipt and no live answer card;
- verify New request opens the bounded-chat surface and can close with a direct
  action receipt;
- verify a complex blocker opens bounded chat, supports clarification, and
  closes with a structured retry/revise/shelve/prerequisite/blocker outcome.

## 0.10 Defaults

- Low-risk direct setting updates apply immediately and close with a receipt.
- High-risk settings that change autonomy, external access, spending, provider
  privacy, or credential use require one confirm turn inside the same bounded
  chat.
- Closed receipts remain visible in Thread as compact activity entries, but not
  as answerable transcript cards.
- The bounded-chat surface is a route-backed modal overlay on desktop and can
  become full-screen on small screens or long deep-intake sessions.
- Task-specific bounded-chat receipts attach to both the created task detail
  and project activity.
- Normal intake allows one follow-up per root question.
- Deep intake allows two follow-ups per root question, with the second follow-up
  allowed only when the coordinator names the remaining unresolved fork.
- New request task shaping allows one follow-up by default. If more is needed,
  the coordinator should create a draft task marked as needing spec review
  rather than continuing a long chat.
- Complex blocker resolution allows enough turns to choose a safe path, but the
  coordinator must close the session as soon as the resolution outcome is clear.

## 0.10 Release Bar

Bounded chat is ready for 0.10 when Guildhall can prove all of this on a clean
fixture and one real project:

- project intake asks fewer, better questions than the old check-in flow;
- New request can finish direct actions without leaving a fake open question;
- task-shaping requests produce task drafts with clear next actions;
- accepted project memory is structured and source-attributed;
- raw chat text is not treated as durable truth;
- closed chats are visibly done;
- blocked chats provide one concrete next action;
- complex blocker resolution can happen through bounded chat without leaving
  stale async question cards;
- the behavior is covered by runtime, projection, and browser proof.
