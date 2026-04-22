/**
 * Minimal Jupyter notebook editor tool.
 *
 * Ported from
 *   openharness/src/openharness/tools/notebook_edit_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Uses Node `path` + `fs/promises` instead of `pathlib`. `resolve()`
 *     with `path.expanduser`-style `~` handling is inlined.
 *   - Source normalization: upstream's `list[str]` → `"".join(...)` matches
 *     the Jupyter format where cell source can be an array of lines.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const notebookEditInputSchema = z.object({
  path: z.string().describe('Path to the .ipynb file'),
  cellIndex: z.number().int().nonnegative().describe('Zero-based cell index'),
  newSource: z.string().describe('Replacement or appended source for the target cell'),
  cellType: z.enum(['code', 'markdown']).default('code'),
  mode: z.enum(['replace', 'append']).default('replace'),
  createIfMissing: z.boolean().default(true),
})
export type NotebookEditInput = z.input<typeof notebookEditInputSchema>

interface JupyterCell {
  cell_type: 'code' | 'markdown'
  metadata?: Record<string, unknown>
  source: string | string[]
  outputs?: unknown[]
  execution_count?: number | null
}

interface JupyterNotebook {
  cells: JupyterCell[]
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
}

export async function runNotebookEdit(
  cwd: string,
  input: NotebookEditInput,
): Promise<{ success: boolean; output: string; path: string }> {
  const {
    path: candidate,
    cellIndex,
    newSource,
    cellType = 'code',
    mode = 'replace',
    createIfMissing = true,
  } = input

  const resolved = resolvePath(cwd, candidate)
  const notebook = await loadNotebook(resolved, createIfMissing)
  if (notebook === null) {
    return { success: false, output: `Notebook not found: ${resolved}`, path: resolved }
  }

  if (!Array.isArray(notebook.cells)) notebook.cells = []
  while (notebook.cells.length <= cellIndex) notebook.cells.push(emptyCell(cellType))

  const cell = notebook.cells[cellIndex] as JupyterCell
  cell.cell_type = cellType
  if (cell.metadata === undefined) cell.metadata = {}
  if (cellType === 'code') {
    if (cell.outputs === undefined) cell.outputs = []
    if (cell.execution_count === undefined) cell.execution_count = null
  }

  const existing = normalizeSource(cell.source ?? '')
  cell.source = mode === 'replace' ? newSource : `${existing}${newSource}`

  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, JSON.stringify(notebook, null, 2) + '\n', 'utf-8')
  return { success: true, output: `Updated notebook cell ${cellIndex} in ${resolved}`, path: resolved }
}

export const notebookEditTool = defineTool({
  name: 'notebook-edit',
  description: 'Create or edit a Jupyter notebook cell (code or markdown).',
  inputSchema: notebookEditInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      cellIndex: { type: 'integer', minimum: 0 },
      newSource: { type: 'string' },
      cellType: { type: 'string', enum: ['code', 'markdown'], default: 'code' },
      mode: { type: 'string', enum: ['replace', 'append'], default: 'replace' },
      createIfMissing: { type: 'boolean', default: true },
    },
    required: ['path', 'cellIndex', 'newSource'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const result = await runNotebookEdit(ctx.cwd, input)
    return { output: result.output, is_error: !result.success }
  },
})

function resolvePath(base: string, candidate: string): string {
  const expanded = candidate.startsWith('~/')
    ? path.join(os.homedir(), candidate.slice(2))
    : candidate === '~'
      ? os.homedir()
      : candidate
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(base, expanded))
}

async function loadNotebook(
  p: string,
  createIfMissing: boolean,
): Promise<JupyterNotebook | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as JupyterNotebook
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      if (!createIfMissing) return null
      return {
        cells: [],
        metadata: { language_info: { name: 'python' } },
        nbformat: 4,
        nbformat_minor: 5,
      }
    }
    throw err
  }
}

function emptyCell(cellType: 'code' | 'markdown'): JupyterCell {
  if (cellType === 'markdown') {
    return { cell_type: 'markdown', metadata: {}, source: '' }
  }
  return {
    cell_type: 'code',
    metadata: {},
    source: '',
    outputs: [],
    execution_count: null,
  }
}

function normalizeSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join('')
  return source
}
