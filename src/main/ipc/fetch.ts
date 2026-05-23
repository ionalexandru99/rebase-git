import { spawn } from 'node:child_process'
import { encodeOrThrow } from '@shared/codec'
import { Channel, FetchResponse } from '@shared/schemas/ipc'
import { Effect, Option } from 'effect'
import { ipcMain } from 'electron'
import { normalizeRepoPath } from '../git/instances'
import { activeFetches, fetchSemaphoreFor, gitInstances } from '../state'

function runFetch(key: string): Effect.Effect<typeof FetchResponse.Encoded> {
  return Effect.async<typeof FetchResponse.Encoded>((resume) => {
    const proc = spawn('git', ['-C', key, 'fetch', '--prune'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    activeFetches.set(key, proc)

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
    })

    proc.on('error', (err) => {
      if (activeFetches.get(key) === proc) activeFetches.delete(key)
      resume(
        Effect.succeed(encodeOrThrow(FetchResponse, { _tag: 'GitError', message: err.message }))
      )
    })

    proc.on('close', (code) => {
      if (activeFetches.get(key) === proc) activeFetches.delete(key)
      if (code === 0) {
        resume(Effect.succeed(encodeOrThrow(FetchResponse, { _tag: 'Ok' })))
      } else {
        resume(
          Effect.succeed(
            encodeOrThrow(FetchResponse, {
              _tag: 'GitError',
              message: stderrBuf.trim() || `git fetch exited with code ${code}`
            })
          )
        )
      }
    })
  })
}

export function register(): void {
  ipcMain.handle(Channel.fetchRepo, async (_, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    if (!gitInstances.has(key)) {
      return encodeOrThrow(FetchResponse, { _tag: 'RepoNotOpen' })
    }
    const semaphore = fetchSemaphoreFor(key)
    const result = await Effect.runPromise(semaphore.withPermitsIfAvailable(1)(runFetch(key)))
    if (Option.isNone(result)) {
      return encodeOrThrow(FetchResponse, { _tag: 'FetchSkipped' })
    }
    return result.value
  })
}
