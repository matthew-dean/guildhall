import { describe, expect, it } from 'vitest'

import {
  PermissionChecker,
  PermissionMode,
  defaultPermissionSettings,
} from '../permissions.js'

describe('PermissionChecker — sensitive paths', () => {
  const checker = new PermissionChecker(defaultPermissionSettings(PermissionMode.FULL_AUTO))

  it('blocks SSH key paths even in full_auto', () => {
    const d = checker.evaluate('read_file', {
      isReadOnly: true,
      filePath: '/Users/me/.ssh/id_rsa',
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('sensitive credential path')
  })

  it('blocks AWS credentials', () => {
    const d = checker.evaluate('read_file', {
      isReadOnly: true,
      filePath: '/home/u/.aws/credentials',
    })
    expect(d.allowed).toBe(false)
  })

  it('blocks Guildhall credential store', () => {
    const d = checker.evaluate('read_file', {
      isReadOnly: true,
      filePath: '/home/u/.guildhall/credentials.json',
    })
    expect(d.allowed).toBe(false)
  })
})

describe('PermissionChecker — explicit allow / deny', () => {
  it('denied_tools trumps everything', () => {
    const settings = {
      ...defaultPermissionSettings(PermissionMode.FULL_AUTO),
      denied_tools: ['bash'],
    }
    const d = new PermissionChecker(settings).evaluate('bash', { isReadOnly: false })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('explicitly denied')
  })

  it('allowed_tools short-circuits mode checks', () => {
    const settings = {
      ...defaultPermissionSettings(PermissionMode.PLAN),
      allowed_tools: ['write'],
    }
    const d = new PermissionChecker(settings).evaluate('write', { isReadOnly: false })
    expect(d.allowed).toBe(true)
  })
})

describe('PermissionChecker — modes', () => {
  it('full_auto allows mutating tools', () => {
    const d = new PermissionChecker(
      defaultPermissionSettings(PermissionMode.FULL_AUTO),
    ).evaluate('write', { isReadOnly: false })
    expect(d.allowed).toBe(true)
  })

  it('plan mode blocks mutating tools', () => {
    const d = new PermissionChecker(
      defaultPermissionSettings(PermissionMode.PLAN),
    ).evaluate('write', { isReadOnly: false })
    expect(d.allowed).toBe(false)
    expect(d.requiresConfirmation).toBe(false)
  })

  it('plan mode allows read-only tools', () => {
    const d = new PermissionChecker(
      defaultPermissionSettings(PermissionMode.PLAN),
    ).evaluate('read_file', { isReadOnly: true })
    expect(d.allowed).toBe(true)
  })

  it('default mode requires confirmation for mutating tools', () => {
    const d = new PermissionChecker(
      defaultPermissionSettings(PermissionMode.DEFAULT),
    ).evaluate('write', { isReadOnly: false })
    expect(d.allowed).toBe(false)
    expect(d.requiresConfirmation).toBe(true)
  })

  it('default mode allows read-only tools without confirmation', () => {
    const d = new PermissionChecker(
      defaultPermissionSettings(PermissionMode.DEFAULT),
    ).evaluate('read_file', { isReadOnly: true })
    expect(d.allowed).toBe(true)
    expect(d.requiresConfirmation).toBe(false)
  })
})

describe('PermissionChecker — path rules', () => {
  it('applies deny rules to paths in full_auto', () => {
    const settings = {
      ...defaultPermissionSettings(PermissionMode.FULL_AUTO),
      path_rules: [{ pattern: '/etc/*', allow: false }],
    }
    const d = new PermissionChecker(settings).evaluate('write', {
      isReadOnly: false,
      filePath: '/etc/hosts',
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('deny rule')
  })

  it('deny rule on a directory matches the bare directory via trailing-slash', () => {
    const settings = {
      ...defaultPermissionSettings(PermissionMode.FULL_AUTO),
      path_rules: [{ pattern: '*/.ssh/*', allow: false }],
    }
    const d = new PermissionChecker(settings).evaluate('glob', {
      isReadOnly: true,
      filePath: '/home/u/.ssh',
    })
    expect(d.allowed).toBe(false)
  })
})

describe('PermissionChecker — denied commands', () => {
  it('blocks bash commands matching a deny pattern', () => {
    const settings = {
      ...defaultPermissionSettings(PermissionMode.FULL_AUTO),
      denied_commands: ['rm -rf *'],
    }
    const d = new PermissionChecker(settings).evaluate('bash', {
      isReadOnly: false,
      command: 'rm -rf /tmp/foo',
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('deny pattern')
  })
})
