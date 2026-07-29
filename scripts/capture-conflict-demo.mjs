// The single-scenario recorder, kept as the shortcut its name promises. Everything it used to do is
// the `merge-resolve` scenario of capture-conflict-demos.mjs, which also isolates the fixture repo
// from the recording machine's git config — so this delegates rather than drifting from it.
// Run `pnpm build` first, then `node scripts/capture-conflict-demo.mjs`.
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
