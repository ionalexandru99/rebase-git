import { spawn } from 'node:child_process'
import { encodeOrThrow } from '@shared/codec'
import { Channel, FetchResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { tryReserveFetch } from '../autoFetch'
import { normalizeRepoPath } from '../git/instances'
import { activeFetches, gitInstances } from '../state'

export function register(): void {
  ipcMain.handle(Channel.fetchRepo, async (_, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    if (!gitInstances.has(key)) {
      return encodeOrThrow(FetchResponse, { _tag: 'RepoNotOpen' })
    }

    const proc = spawn('git', ['-C', key, 'fetch', '--prune'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })

    if (!tryReserveFetch(activeFetches, key, proc)) {
      if (!proc.killed) proc.kill()
      return encodeOrThrow(FetchResponse, { _tag: 'FetchSkipped' })
    }

    return new Promise<typeof FetchResponse.Encoded>((resolve) => {
      let stderrBuf = ''
      proc.stderr?.setEncoding('utf8')
      proc.stderr?.on('data', (chunk: string) => {
        stderrBuf += chunk
        if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
      })

      proc.on('error', (err) => {
        if (activeFetches.get(key) === proc) activeFetches.delete(key)
        resolve(encodeOrThrow(FetchResponse, { _tag: 'GitError', message: err.message }))
      })

      proc.on('close', (code) => {
        if (activeFetches.get(key) === proc) activeFetches.delete(key)
        if (code === 0) {
          resolve(encodeOrThrow(FetchResponse, { _tag: 'Ok' }))
        } else {
          resolve(
            encodeOrThrow(FetchResponse, {
              _tag: 'GitError',
              message: stderrBuf.trim() || `git fetch exited with code ${code}`
            })
          )
        }
      })
    })
  })
}
