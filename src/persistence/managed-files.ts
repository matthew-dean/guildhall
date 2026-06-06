import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '@guildhall/sessions'

type TextEncodingOption = BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null
type WriteTextOption = BufferEncoding | { encoding?: BufferEncoding | null; mode?: number; flag?: string } | null

export async function readManagedTextFile(filePath: string, options: TextEncodingOption = 'utf8'): Promise<string> {
  const result = await fsp.readFile(filePath, options ?? 'utf8')
  return typeof result === 'string' ? result : result.toString('utf8')
}

export function readManagedTextFileSync(filePath: string, options: TextEncodingOption = 'utf8'): string {
  const result = fs.readFileSync(filePath, options ?? 'utf8')
  return typeof result === 'string' ? result : result.toString('utf8')
}

export async function writeManagedTextFile(filePath: string, content: string | Buffer, options?: WriteTextOption): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, options ?? undefined)
}

export function writeManagedTextFileSync(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, typeof content === 'string' ? content : content.toString('utf8'))
}

export async function appendManagedTextFile(filePath: string, content: string, options?: WriteTextOption): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.appendFile(filePath, content, options ?? 'utf8')
}
