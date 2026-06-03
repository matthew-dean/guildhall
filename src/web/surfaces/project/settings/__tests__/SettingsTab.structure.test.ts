import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SettingsTab structure', () => {
  it('stays a small composition shell', () => {
    const source = readFileSync('src/web/surfaces/project/SettingsTab.svelte', 'utf8')

    expect(source.split('\n').length).toBeLessThanOrEqual(400)
    expect(source).not.toMatch(/interface DesignFeedbackStore/)
    expect(source).not.toMatch(/interface LearningSnapshot/)
    expect(source).not.toMatch(/interface ReintakeDraft/)
    expect(source).not.toMatch(/interface ProjectGraphView/)
    expect(source).not.toContain('/api/project/project-graph')
    expect(source).not.toMatch(/selectedProjectGraphDomainId/)
    expect(source).not.toMatch(/looma/i)
  })
})
