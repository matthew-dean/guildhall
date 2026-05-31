import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const copy = readFileSync(resolve('src/copy.ts'), 'utf8')
const app = readFileSync(resolve('src/App.tsx'), 'utf8')

const ok = copy.includes('benchmark-ready helper copy') && app.includes("helperCopy")
process.exit(ok ? 0 : 1)
