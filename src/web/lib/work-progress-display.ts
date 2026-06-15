export interface TaskWorkProgressDisplay {
  deliverySteps?: Array<{
    id?: string
    title?: string
    kind?: string
    status?: string
    required?: boolean
    blocksCompletion?: boolean
    sourceTaskId?: string
    evidenceChannel?: string
    toolLabel?: string
  }>
  rollup?: {
    requiredStepCount?: number
    doneStepCount?: number
    blockedStepCount?: number
    internalStepCount?: number
  }
}

export interface DeliveryProgressBadge {
  label: string
  title: string
  tone: 'warn' | 'ok' | 'neutral'
}

export function deliveryProgressBadge(progress: TaskWorkProgressDisplay | null | undefined): DeliveryProgressBadge | null {
  const rollup = progress?.rollup
  if (!rollup) return null
  const required = Math.max(0, rollup.requiredStepCount ?? 0)
  const blocked = Math.max(0, rollup.blockedStepCount ?? 0)
  const done = Math.max(0, rollup.doneStepCount ?? 0)
  const internal = Math.max(0, rollup.internalStepCount ?? 0)
  const total = Math.max(required, internal)
  if (total === 0) return null
  if (blocked > 0) {
    return {
      label: `${blocked} ${blocked === 1 ? 'delivery step' : 'delivery steps'} blocked`,
      title: `${blocked} required delivery ${blocked === 1 ? 'step is' : 'steps are'} blocked.`,
      tone: 'warn',
    }
  }
  if (required > 0 && done >= required) {
    return {
      label: `${done}/${required} delivery steps`,
      title: 'All required delivery steps are complete.',
      tone: 'ok',
    }
  }
  return {
    label: `${done}/${total} delivery steps`,
    title: `${done} of ${total} delivery ${total === 1 ? 'step is' : 'steps are'} complete.`,
    tone: 'neutral',
  }
}
