import net from 'node:net'

import {
  readProjectRuntimeState,
  writeProjectRuntimeState,
  type ProjectRuntimePort,
} from './project-runtime-store.js'

export interface RuntimePortRange {
  start: number
  end: number
}

export interface RuntimePortAllocationRequest {
  containerPort: number
  purpose: ProjectRuntimePort['purpose']
  preferredHostPort?: number
  range?: RuntimePortRange
  isPortAvailable?: (port: number) => Promise<boolean>
}

export interface RuntimePortReservation extends ProjectRuntimePort {
  url: string
}

export class RuntimePortConflictError extends Error {
  readonly range: RuntimePortRange
  readonly containerPort: number

  constructor(input: { containerPort: number; range: RuntimePortRange }) {
    super(`No host port is available for runtime port ${input.containerPort} in ${input.range.start}-${input.range.end}.`)
    this.name = 'RuntimePortConflictError'
    this.containerPort = input.containerPort
    this.range = input.range
  }
}

const defaultRange: RuntimePortRange = { start: 45000, end: 45999 }

export async function allocateRuntimePort(
  projectRoot: string,
  request: RuntimePortAllocationRequest,
): Promise<RuntimePortReservation> {
  const state = await readProjectRuntimeState(projectRoot)
  const existing = state.ports.find(port =>
    port.container === request.containerPort &&
    port.purpose === request.purpose
  )
  if (existing) return withUrl(existing)

  const range = request.range ?? defaultRange
  const availability = request.isPortAvailable ?? isHostPortAvailable
  const candidates = [
    request.preferredHostPort,
    ...Array.from({ length: range.end - range.start + 1 }, (_item, index) => range.start + index),
  ].filter((port): port is number =>
    typeof port === 'number' &&
    port >= range.start &&
    port <= range.end
  )
  const uniqueCandidates = Array.from(new Set(candidates))
  const alreadyReserved = new Set(state.ports.map(port => port.host))
  for (const hostPort of uniqueCandidates) {
    if (alreadyReserved.has(hostPort)) continue
    if (!await availability(hostPort)) continue
    const reserved: ProjectRuntimePort = {
      container: request.containerPort,
      host: hostPort,
      purpose: request.purpose,
    }
    await writeProjectRuntimeState(projectRoot, {
      ...state,
      ports: [...state.ports, reserved],
    })
    return withUrl(reserved)
  }

  throw new RuntimePortConflictError({ containerPort: request.containerPort, range })
}

export async function releaseRuntimePort(
  projectRoot: string,
  request: { containerPort: number; hostPort: number },
): Promise<void> {
  const state = await readProjectRuntimeState(projectRoot)
  await writeProjectRuntimeState(projectRoot, {
    ...state,
    ports: state.ports.filter(port =>
      port.container !== request.containerPort ||
      port.host !== request.hostPort
    ),
  })
}

export async function isHostPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

function withUrl(port: ProjectRuntimePort): RuntimePortReservation {
  return {
    ...port,
    url: `http://127.0.0.1:${port.host}`,
  }
}
