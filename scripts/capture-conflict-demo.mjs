import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const recorder = path.join(currentDir, 'capture-conflict-demos.mjs')

const result = spawnSync(process.execPath, [recorder, 'merge-resolve'], { stdio: 'inherit' })
if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
