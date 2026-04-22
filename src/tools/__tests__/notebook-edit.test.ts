import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runNotebookEdit, notebookEditTool } from '../notebook-edit.js'

async function mkSandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-notebook-edit-test-'))
}

async function readJson(p: string): Promise<{ cells: unknown[]; [key: string]: unknown }> {
  return JSON.parse(await fs.readFile(p, 'utf-8'))
}

describe('runNotebookEdit', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('creates a new notebook on first write when createIfMissing', async () => {
    const result = await runNotebookEdit(cwd, {
      path: 'notebooks/nb.ipynb',
      cellIndex: 0,
      newSource: "print('hi')",
    })
    expect(result.success).toBe(true)
    const nb = await readJson(result.path)
    expect(nb.nbformat).toBe(4)
    expect(nb.cells).toHaveLength(1)
    const cell = (nb.cells as { cell_type: string; source: string }[])[0]!
    expect(cell.cell_type).toBe('code')
    expect(cell.source).toBe("print('hi')")
  })

  it('returns an error when the notebook is missing and createIfMissing is false', async () => {
    const result = await runNotebookEdit(cwd, {
      path: 'absent.ipynb',
      cellIndex: 0,
      newSource: 'x',
      createIfMissing: false,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Notebook not found')
  })

  it('appends mode concatenates to existing source', async () => {
    await runNotebookEdit(cwd, {
      path: 'nb.ipynb',
      cellIndex: 0,
      newSource: 'line1\n',
    })
    await runNotebookEdit(cwd, {
      path: 'nb.ipynb',
      cellIndex: 0,
      newSource: 'line2\n',
      mode: 'append',
    })
    const nb = await readJson(path.join(cwd, 'nb.ipynb'))
    const cell = (nb.cells as { source: string }[])[0]!
    expect(cell.source).toBe('line1\nline2\n')
  })

  it('replace mode overwrites existing source', async () => {
    await runNotebookEdit(cwd, {
      path: 'nb.ipynb',
      cellIndex: 0,
      newSource: 'first',
    })
    await runNotebookEdit(cwd, {
      path: 'nb.ipynb',
      cellIndex: 0,
      newSource: 'second',
      mode: 'replace',
    })
    const nb = await readJson(path.join(cwd, 'nb.ipynb'))
    expect((nb.cells as { source: string }[])[0]!.source).toBe('second')
  })

  it('inserts padding cells when writing a high index', async () => {
    await runNotebookEdit(cwd, {
      path: 'nb.ipynb',
      cellIndex: 3,
      newSource: 'target',
    })
    const nb = await readJson(path.join(cwd, 'nb.ipynb'))
    expect(nb.cells).toHaveLength(4)
    const cells = nb.cells as { source: string; cell_type: string }[]
    expect(cells[0]!.source).toBe('')
    expect(cells[3]!.source).toBe('target')
  })

  it('preserves markdown cells', async () => {
    const result = await runNotebookEdit(cwd, {
      path: 'nb.ipynb',
      cellIndex: 0,
      newSource: '# heading',
      cellType: 'markdown',
    })
    const nb = await readJson(result.path)
    const cell = (nb.cells as { cell_type: string; outputs?: unknown[] }[])[0]!
    expect(cell.cell_type).toBe('markdown')
    expect(cell.outputs).toBeUndefined()
  })

  it('normalizes array-form source from existing notebooks', async () => {
    const nb = {
      cells: [
        { cell_type: 'code', metadata: {}, source: ['a\n', 'b\n'], outputs: [], execution_count: null },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }
    const p = path.join(cwd, 'array.ipynb')
    await fs.writeFile(p, JSON.stringify(nb), 'utf-8')
    await runNotebookEdit(cwd, {
      path: 'array.ipynb',
      cellIndex: 0,
      newSource: 'c\n',
      mode: 'append',
    })
    const updated = await readJson(p)
    const cell = (updated.cells as { source: string }[])[0]!
    expect(cell.source).toBe('a\nb\nc\n')
  })
})

describe('notebookEditTool.execute', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('returns structured output on success', async () => {
    const result = await notebookEditTool.execute(
      { path: 'n.ipynb', cellIndex: 0, newSource: 'x' },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Updated notebook cell 0')
  })

  it('returns an error when createIfMissing is false and file is absent', async () => {
    const result = await notebookEditTool.execute(
      {
        path: 'never.ipynb',
        cellIndex: 0,
        newSource: 'x',
        createIfMissing: false,
      },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(true)
  })
})
