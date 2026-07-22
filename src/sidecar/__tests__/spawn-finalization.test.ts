import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let tempDir: string
let statePath: string
let runnerPath: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-spawn-finalization-'))
  statePath = path.join(tempDir, 'children')
  const gitPath = path.join(tempDir, 'git')
  runnerPath = path.join(tempDir, 'runner.mjs')
  const spawnModule = pathToFileURL(path.resolve('src/sidecar/spawn.ts')).href
  const effectModule = pathToFileURL(createRequire(import.meta.url).resolve('effect')).href

  fs.writeFileSync(
    gitPath,
    `#!/bin/sh
(
  if [ "$REBASE_TEST_IGNORE_TERM" = "1" ]; then
    trap '' TERM INT
  else
    trap 'exit 0' TERM INT
  fi
  while true; do /bin/sleep 0.05; done
) &
printf '%s %s\n' "$$" "$!" >> "$REBASE_TEST_STATE"
trap 'exit 0' TERM INT
while true; do /bin/sleep 0.05; done
`
  )
  fs.chmodSync(gitPath, 0o755)
  fs.writeFileSync(
    runnerPath,
    `import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { ManagedRuntime } from ${JSON.stringify(effectModule)}
import {
  TrackedChildren,
  TrackedChildrenLive,
  finalizeTrackedChildren,
  installTrackedChildShutdownHooks,
  registerRepoChild,
  runWithRequestChildren,
  startGit
} from ${JSON.stringify(spawnModule)}

const [mode, gitPath, statePath] = process.argv.slice(2)
const env = {
  ...process.env,
  PATH: \`${tempDir}:\${process.env.PATH ?? ''}\`,
  REBASE_TEST_STATE: statePath,
  REBASE_TEST_IGNORE_TERM: mode === 'finalize' ? '1' : '0'
}
const waitForChildren = async (count) => {
  while (!fs.existsSync(statePath) || fs.readFileSync(statePath, 'utf8').trim().split('\\n').length < count) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

if (mode === 'finalize') {
  let release
  const released = new Promise((resolve) => {
    release = resolve
  })
  const request = runWithRequestChildren(new AbortController().signal, async () => {
    startGit(['-C', '/request-repo', 'status'], { collectStdout: false, env })
    await released
  })
  const read = spawn(gitPath, [], { detached: process.platform !== 'win32', env, stdio: 'ignore' })
  registerRepoChild('/read-repo', read)
  await waitForChildren(2)
  const finalized = finalizeTrackedChildren()
  release()
  await Promise.all([request, finalized])
  process.stdout.write(fs.readFileSync(statePath, 'utf8'))
} else if (mode === 'scope') {
  const runtime = ManagedRuntime.make(TrackedChildrenLive)
  const registry = await runtime.runPromise(TrackedChildren)
  const child = spawn(gitPath, [], { detached: process.platform !== 'win32', env, stdio: 'ignore' })
  registry.trackChild(child)
  await waitForChildren(1)
  await runtime.dispose()
  process.stdout.write(fs.readFileSync(statePath, 'utf8'))
} else {
  installTrackedChildShutdownHooks()
  startGit(['-C', '/signal-repo', 'status'], { collectStdout: false, env })
  await waitForChildren(1)
  process.kill(process.pid, 'SIGTERM')
}
`
  )
})

afterEach(() => {
  if (fs.existsSync(statePath)) {
    for (const pid of readPids(statePath)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('sidecar child finalization', () => {
  it('awaits every tracked process group before finalization completes', async () => {
    const { stdout } = await execFilePromise(process.execPath, [
      runnerPath,
      'finalize',
      path.join(tempDir, 'git'),
      statePath
    ])
    const pids = stdout.trim().split(/\s+/).map(Number)

    expect(pids).toHaveLength(4)
    expect(pids.every((pid) => !processRunning(pid))).toBe(true)
  })

  it('best-effort kills every tracked process group on an unexpected signal', async () => {
    const runner = spawn(
      process.execPath,
      [runnerPath, 'signal', path.join(tempDir, 'git'), statePath],
      { stdio: 'ignore' }
    )
    await waitUntil(() => fs.existsSync(statePath))
    await new Promise<void>((resolve) => runner.once('close', () => resolve()))
    const pids = readPids(statePath)
    await waitUntil(() => pids.every((pid) => !processRunning(pid)))

    expect(pids).toHaveLength(2)
  })

  it('closes the process child registry scope through its public finalizer', async () => {
    const { stdout } = await execFilePromise(process.execPath, [
      runnerPath,
      'scope',
      path.join(tempDir, 'git'),
      statePath
    ])
    const pids = stdout.trim().split(/\s+/).map(Number)

    expect(pids).toHaveLength(2)
    expect(pids.every((pid) => !processRunning(pid))).toBe(true)
  })
})

function execFilePromise(
  file: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

function readPids(filePath: string): number[] {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\s+/).map(Number)
}

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition timed out')
}
