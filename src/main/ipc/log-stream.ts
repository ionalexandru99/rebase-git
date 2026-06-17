import { parseOrThrow } from '@shared/codec'
import { normalizeRepoPath } from '@shared/repo-path'
import type { LogChunk } from '@shared/schemas/git'
import {
  CancelLogStreamResponseSchema,
  Channel,
  type StartLogStreamResponse,
  StartLogStreamResponseSchema
} from '@shared/schemas/ipc'
import { ipcMain, webContents as webContentsApi } from 'electron'
import { sidecarLogStream } from '../sidecar'

interface ActiveStream {
  controller: AbortController
  finishOk: () => void
  webContentsId: number
  repoPath: string
}

const activeLogStreams = new Map<string, ActiveStream>()
const webContentsCleanupBound = new Set<number>()

function streamKey(webContentsId: number, repoPath: string): string {
  return `${webContentsId}:${repoPath}`
}

function killActiveStream(webContentsId: number, repoPath: string): void {
  const key = streamKey(webContentsId, repoPath)
  const existing = activeLogStreams.get(key)
  if (!existing) {
    return
  }
  activeLogStreams.delete(key)
  existing.controller.abort()
  existing.finishOk()
}

function killAllStreamsForWebContents(webContentsId: number): void {
  for (const [key, stream] of activeLogStreams) {
    if (stream.webContentsId !== webContentsId) {
      continue
    }
    activeLogStreams.delete(key)
    stream.controller.abort()
    stream.finishOk()
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function bindWebContentsCleanup(webContentsId: number): void {
  if (webContentsCleanupBound.has(webContentsId)) {
    return
  }
  webContentsCleanupBound.add(webContentsId)
  const contents = webContentsApi.fromId(webContentsId)
  if (!contents) {
    webContentsCleanupBound.delete(webContentsId)
    return
  }
  contents.once('destroyed', () => {
    killAllStreamsForWebContents(webContentsId)
    webContentsCleanupBound.delete(webContentsId)
  })
}

export function register(): void {
  ipcMain.handle(
    Channel.startLogStream,
    async (
      event,
      repoPath: string,
      options?: { skip?: number; maxCount?: number; streamId?: number }
    ) => {
      const key = normalizeRepoPath(repoPath)
      const webContents = event.sender
      const webContentsId = webContents.id

      killActiveStream(webContentsId, key)
      bindWebContentsCleanup(webContentsId)

      return new Promise<StartLogStreamResponse>((resolve) => {
        let resolved = false
        const finishOk = () => {
          if (resolved) {
            return
          }
          resolved = true
          resolve(parseOrThrow(StartLogStreamResponseSchema, { _tag: 'Ok' }))
        }
        const finishErr = (message: string) => {
          if (resolved) {
            return
          }
          resolved = true
          resolve(parseOrThrow(StartLogStreamResponseSchema, { _tag: 'GitError', message }))
        }

        const mapKey = streamKey(webContentsId, key)
        const controller = new AbortController()
        activeLogStreams.set(mapKey, { controller, finishOk, webContentsId, repoPath: key })

        const send = (chunk: LogChunk) => {
          if (webContents.isDestroyed()) {
            return
          }
          webContents.send(Channel.logChunk, chunk)
        }

        void sidecarLogStream(key, controller.signal, finishOk, send, options)
          .catch((error: unknown) => {
            const current = activeLogStreams.get(mapKey)
            if (current?.controller !== controller) {
              return
            }
            activeLogStreams.delete(mapKey)
            if (isAbortError(error)) {
              finishOk()
              return
            }
            const message = error instanceof Error ? error.message : String(error)
            if (!webContents.isDestroyed()) {
              webContents.send(Channel.logChunk, {
                repoPath: key,
                commits: [],
                done: true,
                error: message,
                streamId: options?.streamId
              })
            }
            finishErr(message)
          })
          .then(() => {
            const current = activeLogStreams.get(mapKey)
            if (current?.controller !== controller) {
              return
            }
            activeLogStreams.delete(mapKey)
            finishOk()
          })
      })
    }
  )

  ipcMain.handle(Channel.cancelLogStream, (event, repoPath: string) => {
    if (repoPath) {
      killActiveStream(event.sender.id, normalizeRepoPath(repoPath))
    } else {
      killAllStreamsForWebContents(event.sender.id)
    }
    return parseOrThrow(CancelLogStreamResponseSchema, {})
  })
}
