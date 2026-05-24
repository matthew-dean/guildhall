import { describe, expect, it } from 'vitest'

import {
  compileRichArtifact,
  richArtifactSchema,
  validateRichArtifact,
} from '../rich-artifacts.js'

describe('rich artifact protocol', () => {
  it('accepts a small safe artifact and compiles known gh components', () => {
    const artifact = richArtifactSchema.parse({
      contentType: 'guildhall-html-v1',
      artifactKind: 'blueprint',
      title: 'Release blueprint',
      html: `
        <section>
          <h2>Release map</h2>
          <gh-checklist title="Spec readiness">
            <gh-step status="done">Owner goal is captured</gh-step>
            <gh-step status="needs-human">Migration scope needs signoff</gh-step>
          </gh-checklist>
        </section>
      `,
      fallbackMarkdown: '## Release map\n\n- Owner goal is captured',
      createdBy: 'coordinator-agent',
      schemaVersion: 1,
    })

    const result = validateRichArtifact(artifact)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.renderTree?.components).toContainEqual({
      type: 'gh-checklist',
      props: { title: 'Spec readiness' },
    })
    expect(result.renderTree?.components).toContainEqual({
      type: 'gh-step',
      props: { status: 'needs-human' },
      text: 'Migration scope needs signoff',
    })
  })

  it('compiles gh-table and gh-diagram component primitives', () => {
    const result = compileRichArtifact({
      contentType: 'guildhall-html-v1',
      artifactKind: 'diagram',
      title: 'System map',
      html: `
        <section>
          <gh-table title="Signals"></gh-table>
          <gh-diagram title="Flow" mode="flow">Request to Intake to Thread</gh-diagram>
        </section>
      `,
      fallbackMarkdown: 'Request to Intake to Thread',
      createdBy: 'coordinator-agent',
      schemaVersion: 1,
    })

    expect(result.ok).toBe(true)
    expect(result.renderTree?.components).toContainEqual({
      type: 'gh-table',
      props: { title: 'Signals' },
    })
    expect(result.renderTree?.components).toContainEqual({
      type: 'gh-diagram',
      props: { title: 'Flow', mode: 'flow' },
      text: 'Request to Intake to Thread',
    })
  })

  it('rejects raw dangerous HTML before it can become a renderable artifact', () => {
    const result = validateRichArtifact({
      contentType: 'guildhall-html-v1',
      artifactKind: 'review',
      title: 'Unsafe review',
      html: '<section><button onclick="steal()">Click</button><script>alert(1)</script></section>',
      fallbackMarkdown: 'Unsafe review',
      createdBy: 'spec-agent',
      schemaVersion: 1,
    })

    expect(result.ok).toBe(false)
    expect(result.renderTree).toBeUndefined()
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('event handler attributes are not allowed'),
      expect.stringContaining('script is not an allowed tag'),
    ]))
  })

  it('rejects unknown gh component tags and unsafe links', () => {
    const result = compileRichArtifact({
      contentType: 'guildhall-html-v1',
      artifactKind: 'micro-editor',
      title: 'Decision helper',
      html: '<gh-wizard><a href="javascript:alert(1)">bad link</a></gh-wizard>',
      fallbackMarkdown: 'Decision helper',
      createdBy: 'coordinator-agent',
      schemaVersion: 1,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      'gh-wizard is not an allowed Guildhall component tag',
      'javascript: URLs are not allowed in rich artifacts',
    ]))
  })

  it('requires fallback markdown and provenance for agent-produced content', () => {
    const result = compileRichArtifact({
      contentType: 'guildhall-html-v1',
      artifactKind: 'diagram',
      title: '   ',
      html: '<section><p>Map</p></section>',
      fallbackMarkdown: '',
      schemaVersion: 1,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      'title is required',
      'fallbackMarkdown is required',
      'createdBy is required',
    ]))
  })
})
