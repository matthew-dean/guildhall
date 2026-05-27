import { describe, expect, it } from 'vitest'
import docsConfig from '../docs/.vitepress/config'

describe('docs VitePress config', () => {
  it('registers sidebars for every archived docs version', () => {
    const sidebar = docsConfig.themeConfig?.sidebar as Record<string, unknown>

    expect(Object.keys(sidebar)).toEqual(expect.arrayContaining([
      '/versions/0.8.0/guide/',
      '/versions/0.7.0/guide/',
      '/versions/0.6.0/guide/',
    ]))
    expect(sidebar['/versions/0.7.0/guide/']).toEqual(expect.any(Array))
    expect(sidebar['/versions/0.6.0/guide/']).toEqual(expect.any(Array))
  })

  it('lists archived docs by minor line instead of patch version', () => {
    const nav = docsConfig.themeConfig?.nav as Array<{ text: string; items?: Array<{ text: string }> }>
    const versionNav = nav.find((item) => item.text === 'Version')

    expect(versionNav?.items?.map((item) => item.text)).toEqual(expect.arrayContaining([
      'v0.7',
      'v0.6',
    ]))
    expect(versionNav?.items?.map((item) => item.text)).not.toEqual(expect.arrayContaining([
      'v0.7.0',
      'v0.6.0',
    ]))
  })
})
