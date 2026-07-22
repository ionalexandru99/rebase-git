import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'
import { repoLockCount, withRepoLock } from '../repo-lock'
import { runWithRequestChildren, spawnGit, startGit } from '../spawn'

describe('repo lock', () => {
  it('serializes work for the same repo', async () => {
    const order: string[] = []

    await Effect.runPromise(
      Effect.all(
        [
          withRepoLock(
            '/repo',
            Effect.gen(function* () {
              order.push('a:start')
              yield* Effect.sleep('10 millis')
              order.push('a:end')
            })
          ),
          withRepoLock(
            '/repo',
            Effect.sync(() => {
              order.push('b:start')
              order.push('b:end')
            })
          )
        ],
        { concurrency: 'unbounded' }
      )
    )

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    expect(repoLockCount()).toBe(0)
  })

  it('allows different repos to run independently', async () => {
    const order: string[] = []

    await Effect.runPromise(
      Effect.all(
        [
          withRepoLock(
            '/repo-a',
            Effect.gen(function* () {
              order.push('a:start')
              yield* Effect.sleep('10 millis')
              order.push('a:end')
            })
          ),
          withRepoLock(
            '/repo-b',
            Effect.sync(() => {
              order.push('b:start')
              order.push('b:end')
            })
          )
        ],
        { concurrency: 'unbounded' }
      )
    )

    expect(order.indexOf('b:start')).toBeLessThan(order.indexOf('a:end'))
    expect(repoLockCount()).toBe(0)
  })

  it('kills spawned git children and retains the permit until they exit on timeout', async () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-lock-git-'))
    const statePath = path.join(fakeBin, 'state')
    const gitPath = path.join(fakeBin, 'git')
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh\n(\n  trap '/bin/sleep 0.1; printf exited > "$FAKE_GIT_STATE"; exit 0' TERM INT\n  while true; do /bin/sleep 0.05; done\n) </dev/null >/dev/null 2>&1 &\nprintf '%s' "$!" > "$FAKE_GIT_STATE"\ntrap 'exit 0' TERM INT\nwhile true; do /bin/sleep 0.05; done\n`
    )
    fs.chmodSync(gitPath, 0o755)
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      FAKE_GIT_STATE: statePath
    }
    let stateWhenNextOwnerStarted = 'missing'

    try {
      const timedOutPromise = Effect.runPromise(
        Effect.either(
          withRepoLock(
            '/timeout-repo',
            Effect.promise(() =>
              spawnGit(['-C', '/timeout-repo', 'status'], {
                env,
                collectStdout: false
              })
            ),
            { timeoutMs: 500 }
          )
        )
      )
      await waitUntil(() => fs.existsSync(statePath))
      const nextOwnerPromise = Effect.runPromise(
        withRepoLock(
          '/timeout-repo',
          Effect.sync(() => {
            stateWhenNextOwnerStarted = fs.existsSync(statePath)
              ? fs.readFileSync(statePath, 'utf8')
              : 'missing'
          })
        )
      )
      const [timedOut] = await Promise.all([timedOutPromise, nextOwnerPromise])

      expect(timedOut._tag).toBe('Left')
      expect(stateWhenNextOwnerStarted).toBe('exited')
      expect(repoLockCount()).toBe(0)
    } finally {
      if (fs.existsSync(statePath)) {
        const state = fs.readFileSync(statePath, 'utf8')
        if (/^\d+$/.test(state)) {
          try {
            process.kill(Number(state), 'SIGTERM')
          } catch {}
        }
      }
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('keeps concurrent request children outside a timed-out repo operation', async () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-lock-ownership-'))
    const mutationStatePath = path.join(fakeBin, 'mutation-state')
    const backgroundStatePath = path.join(fakeBin, 'background-state')
    const gitPath = path.join(fakeBin, 'git')
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh\nprintf '%s' "$$" > "$FAKE_GIT_STATE"\ntrap 'printf exited > "$FAKE_GIT_STATE"; exit 0' TERM INT\nwhile true; do /bin/sleep 0.05; done\n`
    )
    fs.chmodSync(gitPath, 0o755)
    const mutationController = new AbortController()
    const backgroundController = new AbortController()
    const envFor = (statePath: string) => ({
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      FAKE_GIT_STATE: statePath
    })
    let backgroundRequest: Promise<void> | undefined

    try {
      const mutation = runWithRequestChildren(mutationController.signal, () =>
        Effect.runPromise(
          Effect.either(
            withRepoLock(
              '/ownership-repo',
              Effect.promise(() =>
                spawnGit(['-C', '/ownership-repo', 'status'], {
                  env: envFor(mutationStatePath),
                  collectStdout: false
                })
              ),
              { timeoutMs: 500 }
            )
          )
        )
      )
      await waitUntil(() => fs.existsSync(mutationStatePath))

      backgroundRequest = runWithRequestChildren(backgroundController.signal, async () => {
        await startGit(['-C', '/ownership-repo', 'log'], {
          env: envFor(backgroundStatePath),
          collectStdout: false
        }).result
      })
      await waitUntil(() => fs.existsSync(backgroundStatePath))

      let backgroundRunningWhenNextOwnerStarted = false
      const nextOwner = Effect.runPromise(
        withRepoLock(
          '/ownership-repo',
          Effect.sync(() => {
            const backgroundPid = Number(fs.readFileSync(backgroundStatePath, 'utf8'))
            try {
              process.kill(backgroundPid, 0)
              backgroundRunningWhenNextOwnerStarted = true
            } catch {}
          })
        )
      )
      const mutationResult = await mutation
      await nextOwner

      expect(mutationResult._tag).toBe('Left')
      expect(fs.readFileSync(mutationStatePath, 'utf8')).toBe('exited')
      expect(backgroundRunningWhenNextOwnerStarted).toBe(true)

      backgroundController.abort()
      await backgroundRequest
      expect(fs.readFileSync(backgroundStatePath, 'utf8')).toBe('exited')
    } finally {
      mutationController.abort()
      backgroundController.abort()
      await backgroundRequest?.catch(() => {})
      for (const statePath of [mutationStatePath, backgroundStatePath]) {
        if (!fs.existsSync(statePath)) {
          continue
        }
        const pid = Number(fs.readFileSync(statePath, 'utf8'))
        if (Number.isInteger(pid)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
      }
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  }, 10_000)

  it('retains the permit through cancellation finalizers before the next owner starts', async () => {
    let cancelledWorkExited = false
    const first = Effect.runFork(
      withRepoLock(
        '/cancelled-repo',
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sleep('30 millis').pipe(
              Effect.andThen(
                Effect.sync(() => {
                  cancelledWorkExited = true
                })
              )
            )
          )
        )
      )
    )
    await waitUntil(() => repoLockCount() === 1)

    const interruption = Effect.runPromise(Fiber.interrupt(first))
    let stateWhenNextOwnerStarted = false
    const nextOwner = Effect.runPromise(
      withRepoLock(
        '/cancelled-repo',
        Effect.sync(() => {
          stateWhenNextOwnerStarted = cancelledWorkExited
        })
      )
    )

    await Promise.all([interruption, nextOwner])
    expect(stateWhenNextOwnerStarted).toBe(true)
    expect(repoLockCount()).toBe(0)
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
