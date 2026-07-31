import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const lockfile = fs.readFileSync(path.join(process.cwd(), 'pnpm-lock.yaml'), 'utf8')
const versions = [
  ...new Set([...lockfile.matchAll(/^ {2}shiki@([^:(]+):/gm)].map((match) => match[1]))
]

if (versions.length === 1) {
  console.log(`exactly one shiki resolves: ${versions[0]}`)
  process.exit(0)
}

console.error(
  versions.length === 0
    ? 'no shiki package entry found in pnpm-lock.yaml'
    : `multiple shiki versions resolve in pnpm-lock.yaml: ${versions.join(', ')}`
)
process.exit(1)
