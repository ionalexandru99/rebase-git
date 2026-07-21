import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogContinuations, LogContinuationsLive } from '../log-stream'

let tempDir: string
let statePath: string
let originalPath: string | undefined

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-log-continuation-'))
  statePath = path.join(tempDir, 'state')
  const gitPath = path.join(tempDir, 'git')
  fs.writeFileSync(
    gitPath,
    `#!/bin/sh
printf 'hash-1\\037\\0372026-01-01T00:00:00Z\\037Test\\037one\\037\\000hash-2\\037\\0372026-01-01T00:00:00Z\\037Test\\037two\\037\\000'
printf '%s' "$$" > "$REBASE_TEST_STATE"
trap 'printf exited > "$REBASE_TEST_STATE"; exit 0' TERM INT
while true; do /bin/sleep 0.05; done
`
  )
  fs.chmodSync(gitPath, 0o755)
  originalPath = process.env.PATH
  process.env.PATH = `${tempDir}:${originalPath ?? ''}`
  process.env.REBASE_TEST_STATE = statePath
})

afterEach(() => {
  process.env.PATH = originalPath
  delete process.env.REBASE_TEST_STATE
  if (fs.existsSync(statePath)) {
    const state = fs.readFileSync(statePath, 'utf8')
    if (/^\d+$/.test(state)) {
      try {
        process.kill(Number(state), 'SIGKILL')
      } catch {}
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('log continuation scope', () => {
  it('terminates a retained paging process when its managed runtime is disposed', async () => {
    const runtime = ManagedRuntime.make(LogContinuationsLive)
    const registry = await runtime.runPromise(LogContinuations)
    const page = await registry.loadPage('/repo', 0, 1, new AbortController().signal)

    expect(page.hasMore).toBe(true)
    await runtime.dispose()
    await waitUntil(() => fs.readFileSync(statePath, 'utf8') === 'exited')

    expect(fs.readFileSync(statePath, 'utf8')).toBe('exited')
  })
})

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
