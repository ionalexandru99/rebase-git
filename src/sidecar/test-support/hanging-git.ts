import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface HangingRemote {
  dir: string
  remoteDir: string
  uploadPack: string
  childPid: () => number | undefined
  cleanup: () => void
}

export interface HangingGit extends HangingRemote {
  repoDir: string
  args: string[]
  env: NodeJS.ProcessEnv
}

function initRepo(target: string): void {
  fs.mkdirSync(target)
  execFileSync('git', ['-C', target, 'init', '-b', 'main'], { stdio: 'ignore' })
  execFileSync('git', ['-C', target, 'config', 'user.email', 'test@example.com'], {
    stdio: 'ignore'
  })
  execFileSync('git', ['-C', target, 'config', 'user.name', 'Test'], { stdio: 'ignore' })
  execFileSync('git', ['-C', target, 'commit', '--allow-empty', '-m', 'base'], { stdio: 'ignore' })
}

export function createHangingRemote(prefix: string): HangingRemote {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const remoteDir = path.join(dir, 'remote')
  initRepo(remoteDir)

  const statePath = path.join(dir, 'child-state')
  const childScript = path.join(dir, 'upload-pack.mjs')
  fs.writeFileSync(
    childScript,
    [
      "import fs from 'node:fs'",
      `fs.writeFileSync(${JSON.stringify(statePath)}, String(process.pid))`,
      'process.stdin.resume()',
      'setInterval(() => {}, 1 << 30)',
      ''
    ].join('\n')
  )

  const toShellPath = (value: string) => `"${value.replace(/\\/g, '/')}"`

  return {
    dir,
    remoteDir,
    uploadPack: `${toShellPath(process.execPath)} ${toShellPath(childScript)}`,
    childPid: () => {
      if (!fs.existsSync(statePath)) {
        return undefined
      }
      const raw = fs.readFileSync(statePath, 'utf8').trim()
      return /^\d+$/.test(raw) ? Number(raw) : undefined
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}

export function createHangingGit(prefix: string): HangingGit {
  const remote = createHangingRemote(prefix)
  const repoDir = path.join(remote.dir, 'repo')
  initRepo(repoDir)

  return {
    ...remote,
    repoDir,
    args: ['-C', repoDir, 'fetch', '--upload-pack', remote.uploadPack, remote.remoteDir],
    env: { ...process.env }
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
