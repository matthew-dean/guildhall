import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteText } from './atomic.js'
import {
  getProjectSystemStatePath,
  getProjectSystemStatePathFromMemoryDir,
  inferProjectRootFromMemoryDir,
} from './local-history.js'

export function projectStatePath(projectRoot: string, relativePath: string): string {
  return getProjectSystemStatePath(projectRoot, relativePath)
}

export function projectStatePathFromMemoryDir(memoryDir: string, relativePath: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, relativePath)
}

export function projectStateDir(projectRoot: string, relativePath = ''): string {
  return projectStatePath(projectRoot, relativePath)
}

export function projectStateDirFromMemoryDir(memoryDir: string, relativePath = ''): string {
  return projectStatePathFromMemoryDir(memoryDir, relativePath)
}

export function projectRootFromMemoryDir(memoryDir: string): string {
  return inferProjectRootFromMemoryDir(memoryDir)
}

export function readProjectStateText(projectRoot: string, relativePath: string): string {
  return fs.readFileSync(projectStatePath(projectRoot, relativePath), 'utf8')
}

export async function readProjectStateTextAsync(projectRoot: string, relativePath: string): Promise<string> {
  return fsp.readFile(projectStatePath(projectRoot, relativePath), 'utf8')
}

export function readProjectStateTextFromMemoryDir(memoryDir: string, relativePath: string): string {
  return fs.readFileSync(projectStatePathFromMemoryDir(memoryDir, relativePath), 'utf8')
}

export async function readProjectStateTextFromMemoryDirAsync(memoryDir: string, relativePath: string): Promise<string> {
  return fsp.readFile(projectStatePathFromMemoryDir(memoryDir, relativePath), 'utf8')
}

export function readProjectStateJson<T = unknown>(projectRoot: string, relativePath: string): T {
  return JSON.parse(readProjectStateText(projectRoot, relativePath)) as T
}

export async function readProjectStateJsonAsync<T = unknown>(projectRoot: string, relativePath: string): Promise<T> {
  return JSON.parse(await readProjectStateTextAsync(projectRoot, relativePath)) as T
}

export function readProjectStateJsonFromMemoryDir<T = unknown>(memoryDir: string, relativePath: string): T {
  return JSON.parse(readProjectStateTextFromMemoryDir(memoryDir, relativePath)) as T
}

export async function readProjectStateJsonFromMemoryDirAsync<T = unknown>(memoryDir: string, relativePath: string): Promise<T> {
  return JSON.parse(await readProjectStateTextFromMemoryDirAsync(memoryDir, relativePath)) as T
}

export function writeProjectStateText(projectRoot: string, relativePath: string, content: string): void {
  const filePath = projectStatePath(projectRoot, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, content)
}

export async function writeProjectStateTextAsync(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = projectStatePath(projectRoot, relativePath)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, content)
}

export function writeProjectStateTextFromMemoryDir(memoryDir: string, relativePath: string, content: string): void {
  const filePath = projectStatePathFromMemoryDir(memoryDir, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, content)
}

export async function writeProjectStateTextFromMemoryDirAsync(memoryDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = projectStatePathFromMemoryDir(memoryDir, relativePath)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, content)
}

export function writeProjectStateJson(projectRoot: string, relativePath: string, value: unknown): void {
  writeProjectStateText(projectRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeProjectStateJsonAsync(projectRoot: string, relativePath: string, value: unknown): Promise<void> {
  await writeProjectStateTextAsync(projectRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function writeProjectStateJsonFromMemoryDir(memoryDir: string, relativePath: string, value: unknown): void {
  writeProjectStateTextFromMemoryDir(memoryDir, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeProjectStateJsonFromMemoryDirAsync(memoryDir: string, relativePath: string, value: unknown): Promise<void> {
  await writeProjectStateTextFromMemoryDirAsync(memoryDir, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function appendProjectStateText(projectRoot: string, relativePath: string, content: string): void {
  const filePath = projectStatePath(projectRoot, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, content, 'utf8')
}

export async function appendProjectStateTextAsync(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = projectStatePath(projectRoot, relativePath)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.appendFile(filePath, content, 'utf8')
}

export function projectStateExists(projectRoot: string, relativePath: string): boolean {
  return fs.existsSync(projectStatePath(projectRoot, relativePath))
}

export function projectStateExistsFromMemoryDir(memoryDir: string, relativePath: string): boolean {
  return fs.existsSync(projectStatePathFromMemoryDir(memoryDir, relativePath))
}

export function listProjectStateDir(projectRoot: string, relativePath = ''): string[] {
  try {
    return fs.readdirSync(projectStateDir(projectRoot, relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function listProjectStateDirAsync(projectRoot: string, relativePath = ''): Promise<string[]> {
  try {
    return await fsp.readdir(projectStateDir(projectRoot, relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export function listProjectStateDirFromMemoryDir(memoryDir: string, relativePath = ''): string[] {
  try {
    return fs.readdirSync(projectStateDirFromMemoryDir(memoryDir, relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function listProjectStateDirFromMemoryDirAsync(memoryDir: string, relativePath = ''): Promise<string[]> {
  try {
    return await fsp.readdir(projectStateDirFromMemoryDir(memoryDir, relativePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
