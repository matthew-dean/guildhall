import { describe, expect, it } from 'vitest'

import {
  auditReplayTargets,
  classifyRouteProbe,
  routeApiChecks,
} from './browser-route-proof.mjs'

describe('browser route proof harness', () => {
  it('classifies browser control failures separately when Guildhall HTTP and APIs are healthy', () => {
    expect(classifyRouteProbe({
      navigation: { ok: false, error: 'Page.navigate timed out' },
      directHttp: { ok: true, status: 200 },
      apiChecks: [
        { label: 'stale-server', ok: true, status: 200 },
        { label: 'project', ok: true, status: 200 },
      ],
      dom: { ok: false, url: 'http://127.0.0.1:7777/projects/narrative-harness/thread', bodyText: '' },
    })).toEqual({
      classification: 'browser_bridge_failure',
      productRouteHealthy: true,
      reason: 'Browser control failed while direct route HTTP and API liveness checks stayed healthy.',
    })
  })

  it('classifies route lockups only when product HTTP or API liveness fails', () => {
    expect(classifyRouteProbe({
      navigation: { ok: false, error: 'Page.navigate timed out' },
      directHttp: { ok: false, status: 504 },
      apiChecks: [
        { label: 'stale-server', ok: true, status: 200 },
        { label: 'project', ok: false, status: 500 },
      ],
      dom: { ok: false, url: 'http://127.0.0.1:7777/projects/jess/thread', bodyText: '' },
    })).toMatchObject({
      classification: 'product_route_lockup',
      productRouteHealthy: false,
    })
  })

  it('keeps the multi-agent audit replay targets browser-capable and API-backed', () => {
    const requiredTargetNames = [
      'jess structural-review owner input',
      'jess workspace import',
      'commerce setup-pending thread',
      'looma-knit reconcile import',
      'looma-knit import spec drawer',
      'narrative-harness coherence reviewer spec drawer',
      'narrative-harness decision trace spec drawer',
      'narrative-harness task 009 spec drawer',
      'font-something import api serving task',
    ]

    expect(auditReplayTargets.map(target => target.name)).toEqual(requiredTargetNames)
    for (const target of auditReplayTargets) {
      expect(target.path).toMatch(/^\/projects\/[^/]+\/(?:thread|workspace-import|task\/)/)
      expect(target.assertions.length).toBeGreaterThan(0)
      expect(routeApiChecks(target).map(check => check.label)).toEqual(expect.arrayContaining([
        'stale-server',
        'project',
      ]))
    }
  })
})
