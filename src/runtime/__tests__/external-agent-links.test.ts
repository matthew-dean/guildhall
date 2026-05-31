import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  EXTERNAL_AGENT_LINKS_FILE,
  listExternalAgentLinks,
  recordExternalAgentLink,
  updateExternalAgentLinkStatus,
} from '../external-agent-links.js'

describe('external agent links', () => {
  it('records and lists Codex subagent links by task id', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-agent-links-'))
    try {
      const link = await recordExternalAgentLink({
        memoryDir,
        link: {
          id: 'link-looma-004',
          taskId: 'looma-004',
          provider: 'codex-subagent',
          externalAgentId: '019e7025-5434-7fa2-a400-ebd7894f3a2c',
          label: 'Looma GitHub/MIT setup',
          status: 'running',
          targetProjectPath: '/Users/matthew/git/oss/looma-knit/looma',
          promptSummary: 'Move Looma toward public GitHub/MIT/npm readiness.',
        },
      })

      expect(link).toMatchObject({
        id: 'link-looma-004',
        taskId: 'looma-004',
        provider: 'codex-subagent',
        status: 'running',
      })
      expect(link.startedAt).toBeTruthy()
      expect(link.updatedAt).toBeTruthy()

      const all = await listExternalAgentLinks({ memoryDir })
      expect(all.links).toHaveLength(1)
      const filtered = await listExternalAgentLinks({ memoryDir, taskId: 'looma-004' })
      expect(filtered.links.map(item => item.externalAgentId)).toEqual(['019e7025-5434-7fa2-a400-ebd7894f3a2c'])

      const raw = await fs.readFile(path.join(memoryDir, EXTERNAL_AGENT_LINKS_FILE), 'utf-8')
      expect(raw).toContain('Looma GitHub/MIT setup')
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('updates status and preserves the original start time', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-agent-links-update-'))
    try {
      const link = await recordExternalAgentLink({
        memoryDir,
        link: {
          id: 'link-looma-004',
          taskId: 'looma-004',
          provider: 'codex-subagent',
          externalAgentId: 'agent-1',
          label: 'Looma setup',
          status: 'running',
          promptSummary: 'Prepare Looma.',
        },
      })

      const updated = await updateExternalAgentLinkStatus({
        memoryDir,
        id: link.id,
        status: 'blocked',
        resultSummary: 'GitHub repo is not reachable with current credentials.',
      })

      expect(updated).toMatchObject({
        id: link.id,
        status: 'blocked',
        resultSummary: expect.stringContaining('not reachable'),
      })
      expect(updated.startedAt).toBe(link.startedAt)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })
})
