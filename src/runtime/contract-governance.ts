export type ContractType =
  | 'persisted_state'
  | 'ui_component'
  | 'api_client'
  | 'data_storage'
  | 'security_auth'
  | 'mcp_tooling'
  | 'agent_contract'
  | 'finished_work_intake'
  | 'documentation_help'
  | 'release_runtime'

export type ContractValidationState =
  | 'proposed'
  | 'observed'
  | 'validated'
  | 'needs_proof'
  | 'possibly_violated'
  | 'violated'
  | 'invalidated'
  | 'deprecated'

export interface ContractRecord {
  id: string
  label: string
  type: ContractType
  owner?: string
  provider?: string
  paths: string[]
  consumers: string[]
  invariants: string[]
  obligations: string[]
  proofRequirements: string[]
  validationState: ContractValidationState
  evidenceRefs: string[]
  lastObservedSource: string
  lastValidatedAt?: string
  staleReasons?: string[]
  dependencies?: string[]
  aliases?: string[]
  updatedAt: string
}

export interface ContractRegistryRecord {
  version: 1
  updatedAt: string
  contracts: Record<string, ContractRecord>
  rejectedContracts: Record<string, { reason: string; rejectedAt: string }>
}

export const ContractRegistry = {
  empty(updatedAt: string): ContractRegistryRecord {
    return {
      version: 1,
      updatedAt,
      contracts: {},
      rejectedContracts: {},
    }
  },
}

export function applyContractIntake(
  registry: ContractRegistryRecord,
  input: { source: string; contracts: ContractRecord[] },
): ContractRegistryRecord {
  const next = cloneRegistry(registry)
  for (const contract of input.contracts) {
    const existing = next.contracts[contract.id]
    next.contracts[contract.id] = existing
      ? mergeContract(existing, contract, input.source)
      : { ...contract, lastObservedSource: input.source }
    next.updatedAt = next.contracts[contract.id]!.updatedAt
  }
  return next
}

export function applyContractProofResult(
  registry: ContractRegistryRecord,
  input: {
    contractId: string
    proofKind: string
    evidenceRef: string
    passed: boolean
    observedAt: string
    summary?: string
  },
): ContractRegistryRecord {
  const next = cloneRegistry(registry)
  const contract = next.contracts[input.contractId]
  if (!contract) return next
  const evidenceRefs = unique([...contract.evidenceRefs, input.evidenceRef])
  const staleReasons = [...(contract.staleReasons ?? [])]
  let validationState: ContractValidationState
  if (!input.passed) {
    validationState = 'violated'
    if (input.summary) staleReasons.push(input.summary)
  } else {
    const providedKinds = new Set(
      evidenceRefs
        .map(ref => proofKindFromEvidenceRef(ref))
        .filter((kind): kind is string => Boolean(kind)),
    )
    providedKinds.add(input.proofKind)
    const missingProof = contract.proofRequirements.filter(requirement => !providedKinds.has(requirement))
    validationState = missingProof.length === 0 ? 'validated' : 'needs_proof'
  }
  next.contracts[input.contractId] = {
    ...contract,
    evidenceRefs,
    validationState,
    staleReasons,
    ...(validationState === 'validated' ? { lastValidatedAt: input.observedAt } : {}),
    updatedAt: input.observedAt,
  }
  next.updatedAt = input.observedAt
  return next
}

export function applyContractOwnerCorrection(
  registry: ContractRegistryRecord,
  input:
    | { action: 'rename'; contractId: string; label: string; updatedAt: string }
    | { action: 'invalidate'; contractId: string; reason: string; updatedAt: string }
    | { action: 'flag_possible_violation'; contractId: string; reason: string; updatedAt: string }
    | { action: 'reject'; contractId: string; reason: string; updatedAt: string }
    | { action: 'merge'; contractId: string; mergeIntoContractId: string; reason: string; updatedAt: string },
): ContractRegistryRecord {
  const next = cloneRegistry(registry)
  const contract = next.contracts[input.contractId]
  if (!contract) return next
  if (input.action === 'rename') {
    next.contracts[input.contractId] = { ...contract, label: input.label, updatedAt: input.updatedAt }
  } else if (input.action === 'invalidate') {
    next.contracts[input.contractId] = {
      ...contract,
      validationState: 'invalidated',
      staleReasons: unique([...(contract.staleReasons ?? []), input.reason]),
      updatedAt: input.updatedAt,
    }
  } else if (input.action === 'flag_possible_violation') {
    next.contracts[input.contractId] = {
      ...contract,
      validationState: 'possibly_violated',
      staleReasons: unique([...(contract.staleReasons ?? []), input.reason]),
      updatedAt: input.updatedAt,
    }
  } else if (input.action === 'merge') {
    const target = next.contracts[input.mergeIntoContractId]
    if (target) {
      next.contracts[input.mergeIntoContractId] = {
        ...target,
        aliases: unique([...(target.aliases ?? []), input.contractId, ...(contract.aliases ?? [])]),
        paths: unique([...target.paths, ...contract.paths]),
        consumers: unique([...target.consumers, ...contract.consumers]),
        invariants: unique([...target.invariants, ...contract.invariants]),
        obligations: unique([...target.obligations, ...contract.obligations]),
        proofRequirements: unique([...target.proofRequirements, ...contract.proofRequirements]),
        evidenceRefs: unique([...target.evidenceRefs, ...contract.evidenceRefs]),
        updatedAt: input.updatedAt,
      }
    }
  } else {
    next.rejectedContracts[input.contractId] = { reason: input.reason, rejectedAt: input.updatedAt }
    delete next.contracts[input.contractId]
  }
  next.updatedAt = input.updatedAt
  return next
}

export function deriveContractQueuePressure(
  registry: ContractRegistryRecord,
  contractIds: string[],
): Array<{ contractId: string; label: string; pressure: string; reason: string }> {
  return contractIds.flatMap(contractId => {
    const contract = registry.contracts[contractId]
    if (!contract) return []
    if (contract.validationState === 'validated') return []
    const pressure = contract.validationState === 'violated' ? 'violated' : 'needs_proof'
    return [{
      contractId,
      label: contract.label,
      pressure,
      reason: pressureReason(contract.validationState),
    }]
  })
}

function cloneRegistry(registry: ContractRegistryRecord): ContractRegistryRecord {
  return {
    version: 1,
    updatedAt: registry.updatedAt,
    contracts: Object.fromEntries(
      Object.entries(registry.contracts).map(([id, contract]) => [id, cloneContract(contract)]),
    ),
    rejectedContracts: { ...registry.rejectedContracts },
  }
}

function cloneContract(contract: ContractRecord): ContractRecord {
  return {
    ...contract,
    paths: [...contract.paths],
    consumers: [...contract.consumers],
    invariants: [...contract.invariants],
    obligations: [...contract.obligations],
    proofRequirements: [...contract.proofRequirements],
    evidenceRefs: [...contract.evidenceRefs],
    staleReasons: contract.staleReasons ? [...contract.staleReasons] : undefined,
    dependencies: contract.dependencies ? [...contract.dependencies] : undefined,
    aliases: contract.aliases ? [...contract.aliases] : undefined,
  }
}

function mergeContract(existing: ContractRecord, incoming: ContractRecord, source: string): ContractRecord {
  return {
    ...existing,
    ...incoming,
    paths: unique([...existing.paths, ...incoming.paths]),
    consumers: unique([...existing.consumers, ...incoming.consumers]),
    invariants: unique([...existing.invariants, ...incoming.invariants]),
    obligations: unique([...existing.obligations, ...incoming.obligations]),
    proofRequirements: unique([...existing.proofRequirements, ...incoming.proofRequirements]),
    evidenceRefs: unique([...existing.evidenceRefs, ...incoming.evidenceRefs]),
    aliases: unique([...(existing.aliases ?? []), ...(incoming.aliases ?? [])]),
    lastObservedSource: source,
    validationState: strongestState(existing.validationState, incoming.validationState),
    updatedAt: incoming.updatedAt,
  }
}

function strongestState(a: ContractValidationState, b: ContractValidationState): ContractValidationState {
  const rank: Record<ContractValidationState, number> = {
    violated: 8,
    possibly_violated: 7,
    invalidated: 6,
    needs_proof: 5,
    observed: 4,
    proposed: 3,
    validated: 2,
    deprecated: 1,
  }
  return rank[a] >= rank[b] ? a : b
}

function proofKindFromEvidenceRef(ref: string): string | null {
  const match = /^test:([^:-]+)/.exec(ref)
  return match?.[1] ?? null
}

function pressureReason(state: ContractValidationState): string {
  switch (state) {
    case 'violated':
      return 'Contract is violated and needs repair, update, or an explicit waiver.'
    case 'possibly_violated':
      return 'Contract may be violated and needs targeted proof or owner review.'
    case 'invalidated':
      return 'Contract is invalidated and needs fresh proof or owner review.'
    case 'needs_proof':
    case 'observed':
    case 'proposed':
      return 'Contract needs proof before it should unblock dependent work.'
    case 'deprecated':
      return 'Contract is deprecated and should not guide new work without a migration decision.'
    case 'validated':
      return 'Contract is validated.'
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value.trim().length > 0))]
}
