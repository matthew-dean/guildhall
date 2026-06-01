import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '@guildhall/sessions'

export function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(value, null, 2) + '\n')
}

export async function writeJsonLinesFile(filePath: string, values: unknown[]): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, values.map(value => JSON.stringify(value)).join('\n') + '\n', 'utf8')
}
