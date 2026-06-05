import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import type { MemoryScope } from './types.js'

export function defaultMemoryStorageRoot(): string {
  return path.join(process.env.GUILDHALL_DATA_DIR ?? path.join(homedir(), '.guildhall', 'data'), 'memory')
}

export function projectMemoryIdentity(projectRoot: string): string {
  const resolved = path.resolve(projectRoot)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  const base = path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, '_') || 'root'
  return `${base}-${digest}`
}

export function scopeStorageDir(scope: MemoryScope, root = defaultMemoryStorageRoot()): string {
  switch (scope.kind) {
    case 'project':
      return path.join(root, 'projects', projectMemoryIdentity(scope.projectRoot))
    case 'task_thread':
      return path.join(root, 'projects', projectMemoryIdentity(scope.projectRoot), 'tasks', safeName(scope.taskId), 'threads', safeName(scope.threadId))
    case 'user_global':
      return path.join(root, 'users', safeName(scope.userId ?? 'default'))
    case 'guildhall_product':
      return path.join(root, 'guildhall-product')
  }
}

export async function appendJsonLine<T>(file: string, value: T): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

export async function readJsonLines<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function writeJsonLines<T>(file: string, values: readonly T[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, values.map((value) => JSON.stringify(value)).join('\n') + (values.length > 0 ? '\n' : ''), 'utf8')
}

export async function directoryStats(dir: string): Promise<{ totalBytes: number, fileCount: number }> {
  if (!existsSync(dir)) return { totalBytes: 0, fileCount: 0 }
  const entries = await fs.readdir(dir, { withFileTypes: true })
  let totalBytes = 0
  let fileCount = 0
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const child = await directoryStats(full)
      totalBytes += child.totalBytes
      fileCount += child.fileCount
    } else if (entry.isFile()) {
      const stat = await fs.stat(full)
      totalBytes += stat.size
      fileCount += 1
    }
  }
  return { totalBytes, fileCount }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
