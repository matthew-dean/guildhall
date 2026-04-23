import { describe, it, expect } from 'vitest'
import { findSecrets } from '../security-engineer/index.js'
import { findTestSmells } from '../test-engineer/index.js'
import { findBannedTerms } from '../copywriter/index.js'

describe('findSecrets (Security Engineer)', () => {
  it('flags an AWS access key', () => {
    const r = findSecrets(`const key = "AKIAIOSFODNN7EXAMPLE"`)
    expect(r).toHaveLength(1)
    expect(r[0]!.kind).toBe('aws-access-key')
    // Secret is redacted in the snippet — the full key must not appear.
    expect(r[0]!.snippet).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('flags an OpenAI-shaped API key', () => {
    const r = findSecrets('SK=sk-abc123defGHIjklMNOpqrSTUvwxYZ0123456789')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.kind).toBe('openai-api-key')
  })

  it('flags a GitHub fine-grained PAT', () => {
    const r = findSecrets(
      'token=github_pat_11ABCDE0123456789012abcdefghijklmnopqrstuvwxyz0123456789',
    )
    expect(r.length).toBeGreaterThan(0)
    expect(r.map((x) => x.kind)).toContain('github-token-fine-grained')
  })

  it('flags a PEM private key header', () => {
    const r = findSecrets(
      [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpAIBAAKCAQEA...',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n'),
    )
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.kind).toBe('pem-private-key')
  })

  it('flags a connection string with embedded credentials', () => {
    const r = findSecrets('DB_URL=postgres://alice:hunter2@db.internal:5432/app')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.kind).toBe('connection-string-with-password')
  })

  it('returns empty for innocuous code', () => {
    expect(findSecrets('const count = 42\nconsole.log(count)')).toHaveLength(0)
  })
})

describe('findTestSmells (Test Engineer)', () => {
  it('flags describe.only and it.only', () => {
    const r = findTestSmells(
      `describe.only('foo', () => {\n  it('bar', () => {})\n})`,
    )
    expect(r.map((x) => x.kind)).toContain('only')
  })

  it('flags fdescribe and fit', () => {
    const r = findTestSmells(`fdescribe('x', () => { fit('y', () => {}) })`)
    expect(r.map((x) => x.kind)).toEqual(
      expect.arrayContaining(['focused-describe', 'focused-it']),
    )
  })

  it('flags an unjustified it.skip', () => {
    const r = findTestSmells(`it.skip('wip', () => {})`)
    expect(r.map((x) => x.kind)).toContain('skip')
  })

  it('exempts a .skip immediately preceded by a TODO comment', () => {
    const r = findTestSmells(
      `// TODO(#123): re-enable once fixture lands\nit.skip('wip', () => {})`,
    )
    expect(r.filter((x) => x.kind === 'skip')).toHaveLength(0)
  })

  it('returns empty for clean tests', () => {
    expect(
      findTestSmells(
        `describe('foo', () => { it('does the thing', () => {}) })`,
      ),
    ).toHaveLength(0)
  })
})

describe('findBannedTerms (Copywriter)', () => {
  it('flags a banned term as a whole word', () => {
    const r = findBannedTerms('Welcome, user! Log in to continue.', ['user'])
    expect(r).toHaveLength(1)
    expect(r[0]!.term).toBe('user')
  })

  it('does not flag substrings (superuser is not user)', () => {
    const r = findBannedTerms('The superuser dashboard is admin-only.', ['user'])
    expect(r).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    const r = findBannedTerms('USER profile', ['user'])
    expect(r).toHaveLength(1)
  })

  it('handles multiple banned terms', () => {
    const r = findBannedTerms(
      'The user must click the Submit button',
      ['user', 'submit'],
    )
    expect(r.map((x) => x.term).sort()).toEqual(['submit', 'user'])
  })

  it('returns empty when no bannedTerms are provided', () => {
    expect(findBannedTerms('anything at all', [])).toHaveLength(0)
  })
})
