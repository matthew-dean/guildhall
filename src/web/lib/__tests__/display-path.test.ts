import { describe, expect, it } from 'vitest'

import { formatUserPath } from '../display-path.js'

describe('formatUserPath', () => {
  it('shortens macOS user-home paths to a tilde path', () => {
    expect(formatUserPath('/Users/matthew/git/oss/guildhall')).toBe('~/git/oss/guildhall')
  })

  it('shortens Linux user-home paths to a tilde path', () => {
    expect(formatUserPath('/home/matthew/git/oss/guildhall')).toBe('~/git/oss/guildhall')
  })

  it('normalizes Windows user-profile paths to a slash-separated tilde path', () => {
    expect(formatUserPath('C:\\Users\\Matthew\\git\\oss\\guildhall')).toBe('~/git/oss/guildhall')
    expect(formatUserPath('C:/Users/Matthew/git/oss/guildhall')).toBe('~/git/oss/guildhall')
  })

  it('leaves non-user-home paths recognizable while normalizing separators', () => {
    expect(formatUserPath('/Volumes/work/guildhall')).toBe('/Volumes/work/guildhall')
    expect(formatUserPath('D:\\work\\guildhall')).toBe('D:/work/guildhall')
  })
})
