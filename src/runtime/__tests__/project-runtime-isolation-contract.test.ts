import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { bootstrapWorkspace, registerWorkspace } from '@guildhall/config'
import {
  getProjectStateDir,
  getProjectRuntimeContainerHomeDir,
  getProjectRuntimeStatePath,
  getProjectSystemStatePath,
} from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { createCapabilityRequest } from '../capability-requests.js'
import { approveMountDirectoryRequest, capabilityGrantMounts, revokeCapabilityGrant } from '../capability-grants.js'
import { PodmanProjectRuntimeBackend } from '../podman-project-runtime-backend.js'
import {
  defaultProjectRuntimeState,
  normalizeProjectRuntimeState,
  readProjectRuntimeState,
  writeProjectRuntimeState,
} from '../project-runtime-store.js'
import {
  appendRuntimeCommandEvidence,
  readRuntimeCommandEvidence,
  type RuntimeCommandEvidenceRecord,
} from '../project-runtime-command.js'
import { detectRuntimeBackendSetup, runRuntimeBackendSetupAction } from '../runtime-backend-setup.js'

let tmpRoot: string
let previousConfigDir: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'guildhall-runtime-isolation-'))
  process.env.GUILDHALL_CONFIG_DIR = path.join(tmpRoot, 'config')
  process.env.GUILDHALL_DATA_DIR = path.join(tmpRoot, 'data')
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await rm(tmpRoot, { recursive: true, force: true })
})

async function createRegisteredProject(id: string, name: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpRoot, `${id}-`))
  bootstrapWorkspace(projectRoot, { name })
  registerWorkspace({ id, name, path: projectRoot, tags: [] })
  return projectRoot
}

async function podmanCreateArgs(projectRoot: string, state = defaultProjectRuntimeState(projectRoot)): Promise<string[]> {
  const calls: Array<{ file: string; args: string[] }> = []
  const backend = new PodmanProjectRuntimeBackend({
    execFile: async (file, args) => {
      calls.push({ file, args })
      return { stdout: 'container-isolation\n', stderr: '' }
    },
  })
  await backend.create(projectRoot, state)
  return calls[0]?.args ?? []
}

function runtimeAgentHeaders(projectId: string): Record<string, string> {
  return { 'x-guildhall-runtime-project-id': projectId }
}

describe('project runtime isolation contract', () => {
  describe('filesystem and Podman mount boundaries', () => {
    it.todo('starts every defined Guildhall project agent inside the project Podman runtime, not on the host')

    it('fails host-run fallback when Podman is installed but not ready', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const commandRunner = async (command: string, args: string[]) => {
        const key = [command, ...args].join(' ')
        if (key === 'which podman') return { stdout: '/usr/local/bin/podman\n', stderr: '' }
        if (key === 'which brew') throw new Error('not found')
        if (key === 'podman --version') return { stdout: 'podman version 5.8.2\n', stderr: '' }
        if (key === 'podman machine list --format json') return { stdout: '[]', stderr: '' }
        throw new Error(`unexpected command: ${key}`)
      }

      const status = await detectRuntimeBackendSetup({ platform: 'darwin', commandRunner })
      const result = await runRuntimeBackendSetupAction(projectRoot, {
        action: 'use-host-run-compatibility',
        platform: 'darwin',
        commandRunner,
      })

      expect(status.podmanPath).toBe('/usr/local/bin/podman')
      expect(status.actions.map(action => action.id)).not.toContain('use-host-run-compatibility')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not available when Podman is installed')
    })

    it.todo('proves a live project-A container cannot read sibling project-B checkout files')

    it.todo('proves a live project-A container cannot read sibling project-B local-history data')

    it('does not mount the host real ~/.guildhall tree into the project runtime', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const state = defaultProjectRuntimeState(projectRoot)
      const args = await podmanCreateArgs(projectRoot, state)

      expect(state.mounts.guildhallHome).toBe(getProjectRuntimeContainerHomeDir(projectRoot))
      expect(args).toContain(`${getProjectRuntimeContainerHomeDir(projectRoot)}:${state.mounts.guildhallHomePath}:rw,z`)
      expect(args.some(arg => arg.includes(`${process.env.GUILDHALL_CONFIG_DIR}:`))).toBe(false)
    })

    it('does not include global provider credentials in the container Guildhall home mount source', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      await writeFile(path.join(process.env.GUILDHALL_CONFIG_DIR!, 'providers.yaml'), 'secret: should-not-mount\n')

      const args = await podmanCreateArgs(projectRoot)

      expect(args.some(arg => arg.includes('providers.yaml'))).toBe(false)
      expect(args.some(arg => arg.includes(process.env.GUILDHALL_CONFIG_DIR!))).toBe(false)
    })

    it.todo('proves a live project-A container cannot read unrelated host home files such as ~/.ssh or shell history')

    it.todo('proves a live project-A container cannot write authoritative Guildhall project state files directly')

    it('overlays project-local .guildhall state so the checkout mount does not expose it directly', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const state = defaultProjectRuntimeState(projectRoot)

      const args = await podmanCreateArgs(projectRoot, state)

      expect(args).toEqual(expect.arrayContaining([
        '--tmpfs',
        `${state.mounts.projectPath}/.guildhall:rw,noexec,nosuid,nodev`,
      ]))
    })

    it('exposes external host paths only through active approved capability grants', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const externalPath = path.join(tmpRoot, 'external-fixture')
      const request = await createCapabilityRequest({
        memoryDir: getProjectStateDir(projectRoot),
        taskId: 'task-fixture',
        kind: 'mount_directory',
        requestedBy: 'worker-agent',
        reason: 'Need an explicit external fixture.',
        mount: {
          hostPath: externalPath,
          containerPath: '/mnt/requested/fixture',
          access: 'read-only',
        },
      })

      let args = await podmanCreateArgs(projectRoot)
      expect(args.some(arg => arg.includes(externalPath))).toBe(false)

      const approved = await approveMountDirectoryRequest({
        memoryDir: getProjectStateDir(projectRoot),
        projectRoot,
        requestId: request.id,
        approvedBy: 'owner',
        access: 'read-only',
      })
      args = await podmanCreateArgs(projectRoot)
      expect(args).toContain(`${externalPath}:/mnt/guildhall-grants/${approved.grant?.id}:ro,z`)
    })

    it('removes revoked capability grants from new container mount args', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const externalPath = path.join(tmpRoot, 'external-fixture')
      const request = await createCapabilityRequest({
        memoryDir: getProjectStateDir(projectRoot),
        taskId: 'task-fixture',
        kind: 'mount_directory',
        requestedBy: 'worker-agent',
        reason: 'Need an explicit external fixture.',
        mount: {
          hostPath: externalPath,
          containerPath: '/mnt/requested/fixture',
          access: 'read-only',
        },
      })
      const approved = await approveMountDirectoryRequest({
        memoryDir: getProjectStateDir(projectRoot),
        projectRoot,
        requestId: request.id,
        approvedBy: 'owner',
        access: 'read-only',
      })

      await revokeCapabilityGrant({
        memoryDir: getProjectStateDir(projectRoot),
        projectRoot,
        requestId: approved.id,
        revokedBy: 'owner',
        reason: 'No longer needed.',
      })

      expect(capabilityGrantMounts(getProjectStateDir(projectRoot))).toEqual([])
      expect((await podmanCreateArgs(projectRoot)).some(arg => arg.includes(externalPath))).toBe(false)
    })

    it.todo('proves read-only capability grants reject writes from inside the live container')
  })

  describe('Guildhall data access through host-managed APIs', () => {
    it('proves capability and runtime evidence reads still work through the host data manager', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const record = runtimeEvidenceRecord('cmd-read', 'project-a')
      await appendRuntimeCommandEvidence(projectRoot, record)

      expect(await readRuntimeCommandEvidence(projectRoot)).toContainEqual(record)
    })

    it('proves runtime state writes still work through the host data manager', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      await writeProjectRuntimeState(projectRoot, {
        ...defaultProjectRuntimeState(projectRoot),
        status: 'running',
        containerId: 'runtime-container',
      })

      expect(await readFile(getProjectRuntimeStatePath(projectRoot), 'utf8')).toContain('runtime-container')
      await expect(readProjectRuntimeState(projectRoot)).resolves.toMatchObject({
        status: 'running',
        containerId: 'runtime-container',
      })
    })

    it('treats container-local Guildhall home writes as scratch, not authoritative project state', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const scratchStatePath = path.join(getProjectRuntimeContainerHomeDir(projectRoot), 'TASKS.json')
      await writeProjectRuntimeState(projectRoot, defaultProjectRuntimeState(projectRoot))
      await mkdir(path.dirname(scratchStatePath), { recursive: true })
      await writeFile(scratchStatePath, '{"tasks":[{"id":"scratch-leak"}]}')

      const authoritativeTasks = await readFile(path.join(getProjectStateDir(projectRoot), 'TASKS.json'), 'utf8')
      expect(authoritativeTasks).not.toContain('scratch-leak')
      expect(await readFile(scratchStatePath, 'utf8')).toContain('scratch-leak')
    })

    it('persists runtime command evidence in host local history, not the container Guildhall home', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const record = runtimeEvidenceRecord('cmd-host-managed', 'project-a')

      await appendRuntimeCommandEvidence(projectRoot, record)

      expect(await readRuntimeCommandEvidence(projectRoot)).toContainEqual(record)
      expect(existsSync(path.join(getProjectRuntimeContainerHomeDir(projectRoot), 'runtime', 'command-evidence.jsonl'))).toBe(false)
    })

    it('normalizes old runtime state so it cannot restore host-home mounts', async () => {
      const projectRoot = await createRegisteredProject('project-a', 'Project A')
      const legacy = {
        ...defaultProjectRuntimeState(projectRoot),
        mounts: {
          ...defaultProjectRuntimeState(projectRoot).mounts,
          guildhallHome: process.env.GUILDHALL_CONFIG_DIR!,
        },
      }

      expect(normalizeProjectRuntimeState(projectRoot, legacy).mounts.guildhallHome)
        .toBe(getProjectRuntimeContainerHomeDir(projectRoot))
    })
  })

  describe('runtime-agent API authority', () => {
    it('rejects project-A runtime-agent API credentials when they request projectId=project-B', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      await createRegisteredProject('project-b', 'Project B')
      const { app } = buildServeApp({ projectPath: firstProject })

      const res = await app.fetch(new Request('http://localhost/api/project?projectId=project-b', {
        headers: runtimeAgentHeaders('project-a'),
      }))

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toMatchObject({ code: 'runtime_agent_scope_violation' })
    })

    it('rejects project-A runtime-agent API credentials on owner/service APIs that list all registered projects', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      await createRegisteredProject('project-b', 'Project B')
      const { app } = buildServeApp({ projectPath: firstProject })

      const res = await app.fetch(new Request('http://localhost/api/service', {
        headers: runtimeAgentHeaders('project-a'),
      }))

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toMatchObject({ code: 'runtime_agent_scope_violation' })
    })

    it('rejects project-A runtime-agent API credentials on global provider and model endpoints', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      const { app } = buildServeApp({ projectPath: firstProject })

      const providers = await app.fetch(new Request('http://localhost/api/providers', {
        headers: runtimeAgentHeaders('project-a'),
      }))
      const models = await app.fetch(new Request('http://localhost/api/models', {
        headers: runtimeAgentHeaders('project-a'),
      }))

      expect(providers.status).toBe(403)
      expect(models.status).toBe(403)
    })

    it('rejects project-A runtime-agent API credentials on project-B read endpoints', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      await createRegisteredProject('project-b', 'Project B')
      const { app } = buildServeApp({ projectPath: firstProject })

      const res = await app.fetch(new Request('http://localhost/api/project/brief?projectId=project-b', {
        headers: runtimeAgentHeaders('project-a'),
      }))

      expect(res.status).toBe(403)
    })

    it('rejects project-A runtime-agent API credentials on project-B mutation endpoints', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      await createRegisteredProject('project-b', 'Project B')
      const { app } = buildServeApp({ projectPath: firstProject })

      const res = await app.fetch(new Request('http://localhost/api/project/brief?projectId=project-b', {
        method: 'POST',
        headers: { ...runtimeAgentHeaders('project-a'), 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'This must not land in project B.' }),
      }))

      expect(res.status).toBe(403)
    })

    it('allows project-A runtime-agent API credentials to access project-A project-scoped reads', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      await createRegisteredProject('project-b', 'Project B')
      const { app } = buildServeApp({ projectPath: firstProject })

      const res = await app.fetch(new Request('http://localhost/api/project?projectId=project-a', {
        headers: runtimeAgentHeaders('project-a'),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({ id: 'project-a' })
    })

    it.todo('redacts or omits cross-project graph data unless a typed cross-project authority grant exists')

    it('records denied cross-project API attempts as security evidence for owner review', async () => {
      const firstProject = await createRegisteredProject('project-a', 'Project A')
      await createRegisteredProject('project-b', 'Project B')
      const { app } = buildServeApp({ projectPath: firstProject })

      const res = await app.fetch(new Request('http://localhost/api/project?projectId=project-b', {
        headers: runtimeAgentHeaders('project-a'),
      }))

      expect(res.status).toBe(403)
      const evidencePath = getProjectSystemStatePath(firstProject, 'security/runtime-agent-scope-violations.jsonl')
      const evidence = await readFile(evidencePath, 'utf8')
      expect(evidence).toContain('"runtimeProjectId":"project-a"')
      expect(evidence).toContain('"requestedProjectId":"project-b"')
      expect(evidence).toContain('"reason":"cross_project_access"')
    })
  })

  describe('network and service reachability', () => {
    it.todo('proves containers cannot reach the owner service without a runtime-scoped credential')

    it.todo('proves runtime-scoped credentials expire or are revoked when the project runtime stops')

    it.todo('proves a project-A dev server cannot use localhost service routing to fetch project-B data')

    it.todo('proves browser-proof and dev-server flows expose only the intended project runtime ports')
  })
})

function runtimeEvidenceRecord(id: string, projectId: string): RuntimeCommandEvidenceRecord {
  return {
    id,
    projectId,
    request: {
      projectId,
      cwd: '/workspace/project-a',
      argv: ['true'],
      env: {},
      timeoutMs: 5_000,
      expectedPorts: [],
    },
    runtime: {
      id: 'runtime-container',
      containerId: 'runtime-container',
    },
    status: 'exited',
    exitCode: 0,
    startedAt: '2026-06-06T00:00:00.000Z',
    completedAt: '2026-06-06T00:00:01.000Z',
    events: [
      {
        type: 'started',
        at: '2026-06-06T00:00:00.000Z',
        cwd: '/workspace/project-a',
        argv: ['true'],
      },
      {
        type: 'exit',
        at: '2026-06-06T00:00:01.000Z',
        exitCode: 0,
      },
    ],
    error: null,
  }
}
