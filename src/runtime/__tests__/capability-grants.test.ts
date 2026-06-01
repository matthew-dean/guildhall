import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getProjectStateDir, readTaskEvidence } from '@guildhall/sessions'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'

import { createCapabilityRequest } from '../capability-requests.js'
import {
  approveMountDirectoryRequest,
  capabilityGrantMounts,
  denyCapabilityRequest,
  listActiveCapabilityGrants,
  markCapabilityRequestBlocked,
  revokeCapabilityGrant,
} from '../capability-grants.js'

describe('capability grants', () => {
  it('approves a mount_directory request with a narrow grant and records task evidence', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'guildhall-capability-project-'))
    const memoryDir = getProjectStateDir(projectRoot)
    const request = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-screenshots',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need to compare generated screenshots against a sibling fixture folder.',
      duration: 'this task',
      fallback: 'Ask the owner to copy the fixtures into the project.',
      mount: {
        hostPath: '/Users/matthew/git/oss/fixtures',
        containerPath: '/mnt/requested/fixtures',
        access: 'read-write',
      },
    })

    const approved = await approveMountDirectoryRequest({
      memoryDir,
      projectRoot,
      requestId: request.id,
      approvedBy: 'owner',
      hostPath: '/Users/matthew/git/oss/fixtures/screenshots',
      access: 'read-only',
      duration: 'this task',
    })

    expect(approved.status).toBe('approved')
    expect(approved.grant).toMatchObject({
      kind: 'mount_directory',
      hostPath: '/Users/matthew/git/oss/fixtures/screenshots',
      containerPath: `/mnt/guildhall-grants/${approved.grant?.id}`,
      access: 'read-only',
      duration: 'this task',
      status: 'active',
    })
    expect(listActiveCapabilityGrants(memoryDir)).toEqual([approved.grant])
    expect(capabilityGrantMounts(memoryDir)).toEqual([
      {
        hostPath: '/Users/matthew/git/oss/fixtures/screenshots',
        containerPath: `/mnt/guildhall-grants/${approved.grant?.id}`,
        access: 'read-only',
      },
    ])
    const evidence = await readTaskEvidence(projectRoot, 'task-screenshots', { kind: 'note' })
    expect(JSON.stringify(evidence)).toContain('Granted read-only mount')
    expect(JSON.stringify(evidence)).toContain('/mnt/guildhall-grants/')

    const persistence = new FileBackedGuildhallPersistence()
    const events = await persistence.listEvents({
      projectRoot,
      placement: {
        scope: 'local_history',
        retention: 'active',
        visibility: 'internal_audit',
        commitPolicy: 'ignored',
      },
      collection: 'capability-grant-evidence',
      streamId: 'task-screenshots',
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      schema: { name: 'capability-grant-evidence', version: 1 },
      recordedBy: 'capability-broker',
      payload: {
        capabilityRequestId: request.id,
        status: 'approved',
        content: expect.stringContaining('Granted read-only mount'),
      },
    })
  })

  it('denies, blocks, and revokes grants as visible lifecycle decisions', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'guildhall-capability-project-'))
    const memoryDir = getProjectStateDir(projectRoot)
    const deniedRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-secrets',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need to inspect a secrets folder.',
      mount: {
        hostPath: '/Users/matthew/.ssh',
        containerPath: '/mnt/requested/ssh',
        access: 'read-write',
      },
    })
    const blockedRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-private-repo',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need a private repo that may not exist locally.',
      mount: {
        hostPath: '/Users/matthew/git/private/repo',
        containerPath: '/mnt/requested/private-repo',
        access: 'read-only',
      },
    })

    const denied = await denyCapabilityRequest({
      memoryDir,
      projectRoot,
      requestId: deniedRequest.id,
      deniedBy: 'owner',
      fallback: 'Continue with public fixtures only.',
    })
    const blocked = await markCapabilityRequestBlocked({
      memoryDir,
      projectRoot,
      requestId: blockedRequest.id,
      blockedBy: 'owner',
      reason: 'Owner needs to clone the repo first.',
    })

    expect(denied.status).toBe('denied')
    expect(denied.fallback).toBe('Continue with public fixtures only.')
    expect(blocked.status).toBe('blocked')
    expect(blocked.blockedReason).toBe('Owner needs to clone the repo first.')

    const approvedRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-fixtures',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need a read-only fixture mount.',
      mount: {
        hostPath: '/Users/matthew/git/oss/fixtures',
        containerPath: '/mnt/requested/fixtures',
        access: 'read-only',
      },
    })
    const approved = await approveMountDirectoryRequest({
      memoryDir,
      projectRoot,
      requestId: approvedRequest.id,
      approvedBy: 'owner',
    })

    expect(listActiveCapabilityGrants(memoryDir)).toHaveLength(1)
    const revoked = await revokeCapabilityGrant({
      memoryDir,
      projectRoot,
      requestId: approved.id,
      revokedBy: 'owner',
      reason: 'No longer needed.',
    })
    expect(revoked.status).toBe('revoked')
    expect(revoked.grant?.status).toBe('revoked')
    expect(listActiveCapabilityGrants(memoryDir)).toEqual([])
    expect(capabilityGrantMounts(memoryDir)).toEqual([])
  })

  it('rejects capability lifecycle decisions that are not legal from the current status', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'guildhall-capability-project-'))
    const memoryDir = getProjectStateDir(projectRoot)
    const deniedRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-denied',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need a folder that should stay unavailable.',
      mount: {
        hostPath: '/Users/matthew/private',
        containerPath: '/mnt/requested/private',
        access: 'read-only',
      },
    })
    const pendingRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-pending',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need a fixture folder.',
      mount: {
        hostPath: '/Users/matthew/git/oss/fixtures',
        containerPath: '/mnt/requested/fixtures',
        access: 'read-only',
      },
    })

    const denied = await denyCapabilityRequest({
      memoryDir,
      projectRoot,
      requestId: deniedRequest.id,
      deniedBy: 'owner',
    })

    await expect(approveMountDirectoryRequest({
      memoryDir,
      projectRoot,
      requestId: denied.id,
      approvedBy: 'owner',
    })).rejects.toThrow(/Capability request .* cannot approve from denied/)

    await expect(revokeCapabilityGrant({
      memoryDir,
      projectRoot,
      requestId: pendingRequest.id,
      revokedBy: 'owner',
    })).rejects.toThrow(/Capability request .* cannot revoke from pending/)
  })

  it('records deterministic transition receipts for capability lifecycle decisions', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'guildhall-capability-project-'))
    const memoryDir = getProjectStateDir(projectRoot)
    const request = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-blocked-then-approved',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need a repo that must be cloned first.',
      mount: {
        hostPath: '/Users/matthew/git/private/repo',
        containerPath: '/mnt/requested/private-repo',
        access: 'read-only',
      },
    })

    const blocked = await markCapabilityRequestBlocked({
      memoryDir,
      projectRoot,
      requestId: request.id,
      blockedBy: 'owner',
      reason: 'Clone the repo first.',
    })
    const approved = await approveMountDirectoryRequest({
      memoryDir,
      projectRoot,
      requestId: request.id,
      approvedBy: 'owner',
    })

    expect(blocked.transitionReceipts).toHaveLength(1)
    expect(approved.transitionReceipts).toEqual([
      expect.objectContaining({
        machineId: 'capability-request',
        machineVersion: 1,
        entityId: request.id,
        from: 'pending',
        event: 'block',
        to: 'blocked',
        actor: 'owner',
      }),
      expect.objectContaining({
        machineId: 'capability-request',
        machineVersion: 1,
        entityId: request.id,
        from: 'blocked',
        event: 'approve',
        to: 'approved',
        actor: 'owner',
      }),
    ])
  })
})
