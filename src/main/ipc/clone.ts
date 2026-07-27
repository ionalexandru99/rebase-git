import { parseOrThrow } from '@shared/codec'
import {
  Channel,
  type CloneRepoResponse,
  CloneRepoResponseSchema,
  CloneRequestSchema
} from '@shared/schemas/ipc'
import { ipcMain, webContents as webContentsApi } from 'electron'
import { sidecarClone } from '../sidecar/process'

interface ActiveClone {
  controller: AbortController
  webContentsId: number
}

const activeClones = new Map<string, ActiveClone>()
const webContentsCleanupBound = new Set<number>()

const cloneKey = (webContentsId: number, cloneId: number): string => `${webContentsId}:${cloneId}`

function abortClone(webContentsId: number, cloneId: number): void {
  const key = cloneKey(webContentsId, cloneId)
  const active = activeClones.get(key)
  if (!active) {
    return
  }
  activeClones.delete(key)
  active.controller.abort()
}

// A reload or a closed window leaves nobody to receive the progress, and the clone would otherwise
// keep writing into the destination folder unattended.
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
    for (const [key, clone] of activeClones) {
      if (clone.webContentsId === webContentsId) {
        activeClones.delete(key)
        clone.controller.abort()
      }
    }
    webContentsCleanupBound.delete(webContentsId)
  })
}

export function register(): void {
  ipcMain.handle(Channel.cloneRepo, async (event, payload: unknown): Promise<CloneRepoResponse> => {
    const request = parseOrThrow(CloneRequestSchema, payload)
    const webContents = event.sender
    const webContentsId = webContents.id
    const key = cloneKey(webContentsId, request.cloneId)

    bindWebContentsCleanup(webContentsId)
    const controller = new AbortController()
    activeClones.set(key, { controller, webContentsId })

    try {
      const path = await sidecarClone(
        { url: request.url, parentDir: request.parentDir, folderName: request.folderName },
        controller.signal,
        (progress) => {
          if (webContents.isDestroyed() || progress.done) {
            return
          }
          webContents.send(Channel.cloneProgress, {
            cloneId: request.cloneId,
            phase: progress.phase,
            percent: progress.percent
          })
        }
      )
      return parseOrThrow(CloneRepoResponseSchema, { _tag: 'Ok', path })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return parseOrThrow(CloneRepoResponseSchema, { _tag: 'GitError', message })
    } finally {
      if (activeClones.get(key)?.controller === controller) {
        activeClones.delete(key)
      }
    }
  })

  ipcMain.handle(Channel.cancelClone, (event, cloneId: unknown) => {
    if (typeof cloneId === 'number' && Number.isInteger(cloneId)) {
      abortClone(event.sender.id, cloneId)
    }
  })
}
