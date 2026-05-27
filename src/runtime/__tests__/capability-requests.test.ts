import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  approveCapabilityRequest,
  createCapabilityRequest,
  listCapabilityRequests,
} from '../capability-requests.js'

describe('capability requests', () => {
  it('records a fake mount_directory request and narrow read-only grant as task evidence', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-capability-'))

    const request = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-1',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need to inspect generated screenshots outside the project root.',
      mount: {
        hostPath: '/Users/matthew/Desktop/screenshots',
        containerPath: '/mnt/requested/screenshots',
        access: 'read-only',
      },
    })

    const approved = await approveCapabilityRequest({
      memoryDir,
      requestId: request.id,
      approvedBy: 'human',
    })

    expect(approved.status).toBe('approved')
    expect(approved.grant).toMatchObject({
      kind: 'mount_directory',
      access: 'read-only',
      evidence: expect.stringContaining('Granted read-only mount'),
    })

    expect(listCapabilityRequests(memoryDir)).toContainEqual(expect.objectContaining({
      id: request.id,
      status: 'approved',
    }))
  })
})
