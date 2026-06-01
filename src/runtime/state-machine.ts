export type TransitionGuardResult =
  | { ok: true }
  | { ok: false; reason: string; missing?: string[] }

export interface TransitionRule<State extends string, Context> {
  to: State
  require?: readonly string[]
  guard?: (context: Context) => TransitionGuardResult
  effect?: string
}

export type StateMachineStates<State extends string, Event extends string, Context> = Record<State, {
  on: Partial<Record<Event, TransitionRule<State, Context>>>
}>

export interface StateMachineDefinition<State extends string, Event extends string, Context> {
  id: string
  version: number
  initial: State
  terminal: readonly State[]
  states: StateMachineStates<State, Event, Context>
}

export interface TransitionReceipt<State extends string, Event extends string> {
  machineId: string
  machineVersion: number
  commandId?: string
  entityId: string
  from: State
  event: Event
  to: State
  actor: string
  evidenceRefs: string[]
  createdAt: string
}

export type TransitionResult<State extends string, Event extends string> =
  | {
    kind: 'applied'
    nextState: State
    receipt: TransitionReceipt<State, Event>
  }
  | {
    kind: 'rejected'
    currentState: State
    reason: string
    missing?: string[]
  }

export interface TransitionInput<State extends string, Event extends string, Context> {
  entityId: string
  currentState: State
  event: Event
  context: Context
  actor: string
  evidenceRefs: string[]
  now: string
}

export interface TransitionCommandInput<State extends string, Event extends string, Context> {
  commandId: string
  priorReceipts: Array<TransitionReceipt<State, Event>>
  transition: TransitionInput<State, Event, Context>
}

export type TransitionCommandResult<State extends string, Event extends string> =
  | TransitionResult<State, Event>
  | {
    kind: 'already_applied'
    receipt: TransitionReceipt<State, Event>
    currentState: State
  }

export interface TransitionTableRow<State extends string, Event extends string> {
  from: State
  event: Event
  to: State
}

export function defineStateMachine<State extends string, Event extends string, Context>(
  definition: StateMachineDefinition<State, Event, Context>,
): StateMachineDefinition<State, Event, Context> {
  validateDefinition(definition)
  return definition
}

export function transition<State extends string, Event extends string, Context>(
  machine: StateMachineDefinition<State, Event, Context>,
  input: TransitionInput<State, Event, Context>,
): TransitionResult<State, Event> {
  if (machine.terminal.includes(input.currentState)) {
    return {
      kind: 'rejected',
      currentState: input.currentState,
      reason: 'terminal_state',
    }
  }

  const stateDefinition = machine.states[input.currentState]
  const rule = stateDefinition.on[input.event]
  if (!rule) {
    return {
      kind: 'rejected',
      currentState: input.currentState,
      reason: 'event_not_allowed',
    }
  }

  const missing = missingRequiredContext(input.context, rule.require ?? [])
  if (missing.length > 0) {
    return {
      kind: 'rejected',
      currentState: input.currentState,
      reason: 'missing_required_context',
      missing,
    }
  }

  const guard = rule.guard?.(input.context)
  if (guard && !guard.ok) {
    return {
      kind: 'rejected',
      currentState: input.currentState,
      reason: guard.reason,
      ...(guard.missing && guard.missing.length > 0 ? { missing: guard.missing } : {}),
    }
  }

  return {
    kind: 'applied',
    nextState: rule.to,
    receipt: {
      machineId: machine.id,
      machineVersion: machine.version,
      entityId: input.entityId,
      from: input.currentState,
      event: input.event,
      to: rule.to,
      actor: input.actor,
      evidenceRefs: [...input.evidenceRefs],
      createdAt: input.now,
    },
  }
}

export function applyTransitionCommand<State extends string, Event extends string, Context>(
  machine: StateMachineDefinition<State, Event, Context>,
  input: TransitionCommandInput<State, Event, Context>,
): TransitionCommandResult<State, Event> {
  const existing = input.priorReceipts.find(receipt =>
    receipt.machineId === machine.id &&
    receipt.machineVersion === machine.version &&
    receipt.entityId === input.transition.entityId &&
    receipt.commandId === input.commandId)
  if (existing) {
    return {
      kind: 'already_applied',
      receipt: existing,
      currentState: existing.to,
    }
  }

  const result = transition(machine, input.transition)
  if (result.kind === 'rejected') return result
  return {
    ...result,
    receipt: {
      ...result.receipt,
      commandId: input.commandId,
    },
  }
}

export function transitionTable<State extends string, Event extends string, Context>(
  machine: StateMachineDefinition<State, Event, Context>,
): Array<TransitionTableRow<State, Event>> {
  const rows: Array<TransitionTableRow<State, Event>> = []
  for (const state of stateNames(machine)) {
    const events = Object.keys(machine.states[state].on).sort() as Event[]
    for (const event of events) {
      const rule = machine.states[state].on[event]
      if (rule) rows.push({ from: state, event, to: rule.to })
    }
  }
  return rows
}

function validateDefinition<State extends string, Event extends string, Context>(
  definition: StateMachineDefinition<State, Event, Context>,
): void {
  const states = new Set<State>(stateNames(definition))
  if (!states.has(definition.initial)) {
    throw new Error(`initial state "${definition.initial}" is not defined`)
  }

  for (const terminal of definition.terminal) {
    if (!states.has(terminal)) {
      throw new Error(`terminal state "${terminal}" is not defined`)
    }
  }

  for (const from of stateNames(definition)) {
    const events = Object.keys(definition.states[from].on).sort() as Event[]
    for (const event of events) {
      const rule = definition.states[from].on[event]
      if (!rule) continue
      if (!states.has(rule.to)) {
        throw new Error(`transition "${from}" --${event}--> "${rule.to}" points to an unknown state`)
      }
    }
  }
}

function stateNames<State extends string, Event extends string, Context>(
  definition: StateMachineDefinition<State, Event, Context>,
): State[] {
  return Object.keys(definition.states).sort() as State[]
}

function missingRequiredContext<Context>(context: Context, required: readonly string[]): string[] {
  return required.filter((key) => {
    if (!context || typeof context !== 'object') return true
    const value = (context as Record<string, unknown>)[key]
    return value === undefined || value === null || value === ''
  })
}
