import { describe, expect, it } from 'vitest'
import { orientationPathByWorkId } from '../orientation-paths.js'

describe('orientationPathByWorkId', () => {
  it('builds work paths from the node parent index without scanning roots per task', () => {
    const paths = orientationPathByWorkId({
      nodes: {
        root: { id: 'root', title: 'Current scope' },
        feature: { id: 'feature', title: 'Feature', parentId: 'root' },
        'work:task-1': { id: 'work:task-1', title: 'Task one', parentId: 'feature' },
      },
      roots: [],
    })

    expect(paths.get('task-1')).toBe('Current scope / Feature / Task one')
  })
})
