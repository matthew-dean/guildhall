import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyContractSurfaceTransition,
  buildSurfaceReviewPacket,
  readContractSurface,
  registerContractSurface,
  renderSurfaceReviewPacketMarkdown,
} from '../contract-surfaces.js'

let previousConfigDir: string | undefined
let systemDir: string

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  systemDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-contract-surfaces-'))
  process.env.GUILDHALL_CONFIG_DIR = systemDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fsp.rm(systemDir, { recursive: true, force: true })
})

describe('contract surfaces', () => {
  it('persists graph-owned contract surfaces with state-machine receipts', async () => {
    const surface = await registerContractSurface({
      id: 'design-system.tokens-and-variants',
      label: 'Design system tokens and variants',
      kind: 'design_system',
      owningProject: { id: 'guildhall', label: 'Guildhall', path: '/repo/guildhall' },
      domain: { id: 'domain:design-system', label: 'Design system' },
      authority: 'shared',
      scope: 'project',
      sourceRefs: [
        {
          kind: 'docs',
          path: 'internal/constitutions/design-system-governance.md',
          summary: 'Design-system governance constitution.',
        },
      ],
      consumerRefs: [
        { id: 'thread-ui', label: 'Thread UI' },
        { id: 'structure-ui', label: 'Structure UI' },
      ],
      invariants: [
        {
          id: 'variant-vocabulary',
          label: 'Variant vocabulary',
          rule: 'Components use approved variant axes instead of one-off synonyms.',
          proofObligations: ['Run design-token audit.'],
        },
      ],
      decisions: [],
      createdBy: 'coordinator:guildhall',
      now: '2026-06-02T12:00:00.000Z',
    })

    const accepted = await applyContractSurfaceTransition(surface.id, {
      event: 'accept_surface',
      actor: 'owner',
      evidenceRefs: ['spec:contract-surfaces'],
      now: '2026-06-02T12:01:00.000Z',
    })

    expect(accepted.stateMachine.state).toBe('accepted')
    expect(accepted.transitionReceipts).toContainEqual(expect.objectContaining({
      machineId: 'contract-surface',
      from: 'proposed',
      event: 'accept_surface',
      to: 'accepted',
      actor: 'owner',
    }))

    const persisted = readContractSurface(surface.id)
    expect(persisted).toMatchObject({
      id: 'design-system.tokens-and-variants',
      label: 'Design system tokens and variants',
      kind: 'design_system',
      owningProject: { id: 'guildhall', label: 'Guildhall', path: '/repo/guildhall' },
      stateMachine: { id: 'contract-surface', version: 1, state: 'accepted' },
    })

    const surfacePath = path.join(systemDir, 'project-graph', 'contract-surfaces', 'design-system-tokens-and-variants.json')
    const receiptPath = path.join(systemDir, 'project-graph', 'contract-surface-receipts', 'design-system-tokens-and-variants.jsonl')
    expect(fs.existsSync(surfacePath)).toBe(true)
    expect(fs.existsSync(receiptPath)).toBe(true)
    const receipts = (await fsp.readFile(receiptPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(receipts.map(receipt => receipt.event)).toEqual(['propose_surface', 'accept_surface'])
  })

  it('rejects accepted deltas without touched spec and proof evidence', async () => {
    const surface = await registerContractSurface({
      id: 'api.public-rest',
      label: 'Public REST API',
      kind: 'http_api',
      owningProject: { id: 'api', label: 'API' },
      authority: 'provider',
      scope: 'workspace',
      sourceRefs: [{ kind: 'openapi', path: 'openapi.yaml', summary: 'OpenAPI surface.' }],
      consumerRefs: [],
      invariants: [],
      decisions: [],
      createdBy: 'coordinator:api',
      now: '2026-06-02T12:00:00.000Z',
    })
    await applyContractSurfaceTransition(surface.id, {
      event: 'accept_surface',
      actor: 'owner',
      evidenceRefs: ['review:surface'],
      now: '2026-06-02T12:01:00.000Z',
    })

    await applyContractSurfaceTransition(surface.id, {
      event: 'propose_delta',
      actor: 'spec-agent',
      touchedSpecRef: 'spec:public-errors',
      evidenceRefs: ['spec:public-errors'],
      now: '2026-06-02T12:02:00.000Z',
    })

    await expect(applyContractSurfaceTransition(surface.id, {
      event: 'accept_delta',
      actor: 'reviewer',
      evidenceRefs: [],
      now: '2026-06-02T12:03:00.000Z',
    })).rejects.toThrow(/missing_required_context/)
  })

  it('builds a compact review packet from a surface and declared spec delta', async () => {
    const surface = await registerContractSurface({
      id: 'component-api.dialogs',
      label: 'Dialog component API',
      kind: 'component_api',
      owningProject: { id: 'guildhall', label: 'Guildhall' },
      domain: { id: 'domain:ui-foundation', label: 'UI foundation' },
      authority: 'shared',
      scope: 'project',
      sourceRefs: [{ kind: 'component_catalog', path: 'src/web/lib', summary: 'Shared UI components.' }],
      consumerRefs: [
        { id: 'settings', label: 'Settings' },
        { id: 'thread', label: 'Thread' },
      ],
      invariants: [
        {
          id: 'slots-for-complex-content',
          label: 'Slots for complex content',
          rule: 'Dialog-like components expose slots for complex header, body, and footer content.',
          proofObligations: ['Review component usage tests.'],
        },
      ],
      decisions: [
        {
          id: 'decision-2026-06-02-slot-prop-rule',
          summary: 'Use slots for complex content and scalar props for simple labels.',
          decidedAt: '2026-06-02T10:00:00.000Z',
          decidedBy: 'design-system',
          evidenceRefs: ['constitution:design-system'],
        },
      ],
      createdBy: 'coordinator:guildhall',
      now: '2026-06-02T12:00:00.000Z',
    })

    const packet = buildSurfaceReviewPacket({
      surface,
      currentSpecRef: 'spec:dialog-toolbar',
      delta: {
        surfaceId: surface.id,
        relation: 'amends',
        summary: 'Adds a toolbar composition point to dialog headers.',
        invariantRefs: ['slots-for-complex-content'],
        proposedInvariants: [
          {
            label: 'Toolbar slot vocabulary',
            rule: 'Dialog header toolbar content uses the approved toolbar slot name.',
            reason: 'Avoid per-dialog toolbar prop names.',
          },
        ],
        proofObligations: ['Add component API contract test.'],
      },
      siblingSpecRefs: ['spec:dialog-footer-actions'],
      driftFindings: ['Two specs use actionToolbar and toolbarActions for the same concept.'],
    })

    expect(packet.surface.id).toBe('component-api.dialogs')
    expect(packet.knownConsumers.map(consumer => consumer.label)).toEqual(['Settings', 'Thread'])
    expect(packet.existingInvariants).toContainEqual(expect.objectContaining({ id: 'slots-for-complex-content' }))
    expect(packet.currentDelta.summary).toMatch(/toolbar composition/)
    expect(packet.reviewFocus).toContain('Does this preserve the surface vocabulary instead of adding one-off names?')

    const markdown = renderSurfaceReviewPacketMarkdown(packet)
    expect(markdown).toContain('## Contract Surface Review')
    expect(markdown).toContain('- Surface: Dialog component API')
    expect(markdown).toContain('- Known consumers: Settings, Thread')
    expect(markdown).toContain('- Existing invariant: Slots for complex content - Dialog-like components expose slots')
    expect(markdown).toContain('- Current spec delta: Adds a toolbar composition point')
    expect(markdown).toContain('- Proof obligation: Add component API contract test.')
    expect(markdown).toContain('- Drift finding: Two specs use actionToolbar')
  })
})
