import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { skillTool } from '../skill-tool.js'

async function mkSandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-skill-tool-test-'))
}

async function writeSkill(dir: string, name: string, content: string): Promise<void> {
  const skillDir = path.join(dir, name)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
}

describe('skillTool.execute', () => {
  let cwd: string
  let skillsRoot: string

  beforeEach(async () => {
    cwd = await mkSandbox()
    skillsRoot = path.join(cwd, 'skills')
    await fs.mkdir(skillsRoot, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('returns a skill loaded from extra_skill_dirs', async () => {
    await writeSkill(
      skillsRoot,
      'commit',
      `---\nname: commit\ndescription: How to commit\n---\n\nBody of the commit skill.`,
    )
    const result = await skillTool.execute(
      { name: 'commit' },
      { cwd, metadata: { extra_skill_dirs: [skillsRoot] } },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Body of the commit skill')
  })

  it('falls back to lowercase lookup', async () => {
    await writeSkill(
      skillsRoot,
      'debug',
      `---\nname: debug\ndescription: d\n---\n\nDebug body.`,
    )
    const result = await skillTool.execute(
      { name: 'DEBUG' },
      { cwd, metadata: { extra_skill_dirs: [skillsRoot] } },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Debug body')
  })

  it('reports not found when no skill matches', async () => {
    const result = await skillTool.execute(
      { name: 'no-such-skill' },
      { cwd, metadata: { extra_skill_dirs: [skillsRoot] } },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('Skill not found: no-such-skill')
  })

  it('falls back to the bundled registry when no extra dirs are given', async () => {
    const result = await skillTool.execute(
      { name: 'definitely-not-a-real-bundled-skill-xyz' },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('Skill not found')
  })
})
