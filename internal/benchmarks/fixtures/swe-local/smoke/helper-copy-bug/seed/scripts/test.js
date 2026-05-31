import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const file = fs.readFileSync(path.join(projectRoot, 'src', 'copy.ts'), 'utf8')

if (!file.includes('benchmark-ready helper copy')) {
  console.error('copy.ts is missing benchmark-ready helper copy')
  process.exit(1)
}
