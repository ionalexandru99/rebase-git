import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface HangingGit {
  dir: string
  repoDir: string
  args: string[]
  env: NodeJS.ProcessEnv
  childPid: () => number | undefined
  cleanup: () => void
}

// Blocks a real `git` invocation indefinitely and gives it a real child process, so process-tree
// teardown stays observable without a PATH shim — Win32 cannot execute an extensionless script by
// bare name, and Node refuses to spawn .cmd/.bat without a shell. `git fetch --upload-pack` runs
// the given command through a shell on every platform and then waits on it, and node is the one
// interpreter guaranteed present and hanging identically everywhere. The fake upload-pack records
// its own pid so tests can assert the descendant died with its parent. A pager would not work:
// --paginate only engages when stdout is a terminal, which it never is under the spawn helpers.
export function createHangingGit(prefix: string): HangingGit {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const repoDir = path.join(dir, 'repo')
  const remoteDir = path.join(dir, 'remote')
  for (const target of [repoDir, remoteDir]) {
    fs.mkdirSync(target)
    execFileSync('git', ['-C', target, 'init', '-b', 'main'], { stdio: 'ignore' })
    execFileSync('git', ['-C', target, 'config', 'user.email', 'test@example.com'], {
      stdio: 'ignore'
    })
    execFileSync('git', ['-C', target, 'config', 'user.name', 'Test'], { stdio: 'ignore' })
    execFileSync('git', ['-C', target, 'commit', '--allow-empty', '-m', 'base'], {
      stdio: 'ignore'
    })
  }

  const statePath = path.join(dir, 'child-state')
  const childScript = path.join(dir, 'upload-pack.mjs')
  fs.writeFileSync(
    childScript,
    [
      "import fs from 'node:fs'",
      'fs.writeFileSync(process.env.REBASE_CHILD_STATE, String(process.pid))',
      'process.stdin.resume()',
      'setInterval(() => {}, 1 << 30)',
      ''
    ].join('\n')
  )

  const toShellPath = (value: string) => `"${value.replace(/\\/g, '/')}"`
  const uploadPack = `${toShellPath(process.execPath)} ${toShellPath(childScript)}`

  return {
    dir,
    repoDir,
    args: ['-C', repoDir, 'fetch', '--upload-pack', uploadPack, remoteDir],
    env: { ...process.env, REBASE_CHILD_STATE: statePath },
    childPid: () => {
      if (!fs.existsSync(statePath)) {
        return undefined
      }
      const raw = fs.readFileSync(statePath, 'utf8').trim()
      return /^\d+$/.test(raw) ? Number(raw) : undefined
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function processAlive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function killIfAlive(pid: number | undefined): void {
  if (pid === undefined) {
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
}

export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 10_000,
  label = 'condition'
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`${label} timed out`)
}
