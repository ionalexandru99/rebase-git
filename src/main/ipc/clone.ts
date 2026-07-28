import { parseOrThrow } from '@shared/codec'
import {
  Channel,
  type CloneRepoResponse,
  CloneRepoResponseSchema,
  CloneRequestSchema
} from '@shared/schemas/ipc'
import { ipcMain, webContents as webContentsApi } from 'electron'
import { sidecarClone } from '../sidecar/process'
import { type CloneRegistry, createCloneRegistry } from './clone-registry'

const registry: CloneRegistry = createCloneRegistry()
const boundWebContents = new Set<number>()

// A clone outlives the document that asked for it: a reload (including the sidecar recovery path)
// leaves nobody to receive the progress, and the replacement document starts numbering clones from
// one again. Both a reload and a teardown therefore retire the document's clones.
function bindWebContentsCleanup(webContentsId: number): void {
  if (boundWebContents.has(webContentsId)) {
    return
  }
  const contents = webContentsApi.fromId(webContentsId)
  if (!contents) {
    return
  }
  boundWebContents.add(webContentsId)

  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      registry.retireDocument(webContentsId)
    }
  })
  contents.once('destroyed', () => {
    registry.retireDocument(webContentsId)
    boundWebContents.delete(webContentsId)
  })
}

export function register(): void {
  ipcMain.handle(Channel.cloneRepo, async (event, payload: unknown): Promise<CloneRepoResponse> => {
    const request = parseOrThrow(CloneRequestSchema, payload)
    const webContents = event.sender
    const webContentsId = webContents.id

    bindWebContentsCleanup(webContentsId)
    const controller = registry.start(webContentsId, request.cloneId)

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
      registry.finish(webContentsId, request.cloneId, controller)
    }
  })

  ipcMain.handle(Channel.cancelClone, (event, cloneId: unknown) => {
    if (typeof cloneId === 'number' && Number.isInteger(cloneId)) {
      registry.cancel(event.sender.id, cloneId)
    }
  })
}
