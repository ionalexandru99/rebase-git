import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type RefTransactionState = 'prepared' | 'committed' | 'aborted'

export type RefTransactionAction =
  | { kind: 'replaceIndexWithDirectory' }
  | { kind: 'restoreIndex' }
  | { kind: 'writeRef'; ref: string; value: string }

export interface RefTransactionStep {
  transaction: number
  state: RefTransactionState
  actions?: RefTransactionAction[]
  abort?: boolean
}

export interface RefTransactionHook {
  restoreIndex: () => void
  cleanup: () => void
}

const HOOK_SOURCE = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  '',
  'const [planPath, state] = process.argv.slice(2)',
  "const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))",
  'let transaction = fs.existsSync(plan.counterPath)',
  "  ? Number(fs.readFileSync(plan.counterPath, 'utf8'))",
  '  : 0',
  "if (state === 'prepared') {",
  '  transaction += 1',
  '  fs.writeFileSync(plan.counterPath, String(transaction))',
  '}',
  'const step = plan.steps.find(',
  '  (entry) => entry.transaction === transaction && entry.state === state',
  ')',
  'if (!step) {',
  '  process.exit(0)',
  '}',
  'for (const action of step.actions ?? []) {',
  "  if (action.kind === 'replaceIndexWithDirectory') {",
  '    fs.renameSync(plan.indexPath, plan.savedIndexPath)',
  '    fs.mkdirSync(plan.indexPath)',
  "  } else if (action.kind === 'restoreIndex') {",
  '    fs.rmSync(plan.indexPath, { recursive: true, force: true })',
  '    fs.renameSync(plan.savedIndexPath, plan.indexPath)',
  '  } else {',
  "    fs.writeFileSync(path.join(plan.gitDir, action.ref), action.value + '\\n')",
  '  }',
  '}',
  'process.exit(step.abort ? 1 : 0)',
  ''
].join('\n')

const toPosixPath = (value: string) => value.replace(/\\/g, '/')
const toShellPath = (value: string) => `"${toPosixPath(value)}"`

export function installRefTransactionHook(
  repoDir: string,
  steps: RefTransactionStep[]
): RefTransactionHook {
  const gitDir = path.join(repoDir, '.git')
  const indexPath = path.join(gitDir, 'index')
  const savedIndexPath = path.join(gitDir, 'rebase-test-saved-index')
  const stateDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-ref-hook-'))
  )
  const scriptPath = path.join(stateDir, 'hook.mjs')
  const planPath = path.join(stateDir, 'plan.json')
  const hooksDir = path.join(stateDir, 'hooks')
  const hookPath = path.join(hooksDir, 'reference-transaction')

  fs.writeFileSync(scriptPath, HOOK_SOURCE)
  fs.writeFileSync(
    planPath,
    JSON.stringify({
      gitDir,
      indexPath,
      savedIndexPath,
      counterPath: path.join(stateDir, 'transaction-count'),
      steps
    })
  )
  fs.mkdirSync(path.dirname(hookPath), { recursive: true })
  fs.writeFileSync(
    hookPath,
    `#!/bin/sh\nexec ${toShellPath(process.execPath)} ${toShellPath(scriptPath)} ${toShellPath(
      planPath
    )} "$@"\n`
  )
  fs.chmodSync(hookPath, 0o755)
  execFileSync('git', ['-C', repoDir, 'config', 'core.hooksPath', toPosixPath(hooksDir)])

  const restoreIndex = () => {
    if (!fs.existsSync(savedIndexPath)) {
      return
    }
    fs.rmSync(indexPath, { recursive: true, force: true })
    fs.renameSync(savedIndexPath, indexPath)
  }

  return {
    restoreIndex,
    cleanup: () => {
      execFileSync('git', ['-C', repoDir, 'config', '--unset', 'core.hooksPath'])
      restoreIndex()
      fs.rmSync(stateDir, { recursive: true, force: true })
    }
  }
}
