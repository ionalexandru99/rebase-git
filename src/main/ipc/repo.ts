import { parseOrThrow } from '@shared/codec'
import { normalizeRepoPath } from '@shared/repo-path'
import { CloseRepo, OpenRepo } from '@shared/rpc'
import { Channel, OpenRepoResponseSchema } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { startWatching, stopWatching } from '../repoWatcher'
import { sidecarRpcCall } from '../sidecar'
import { addRecentRepo } from '../store'

export function register(): void {
  ipcMain.handle(Channel.openRepo, async (event, repoPath: string) => {
    const response = parseOrThrow(
      OpenRepoResponseSchema,
      await sidecarRpcCall(OpenRepo._tag, { repoPath })
    )
    if (response._tag === 'Ok') {
      addRecentRepo(response.result.path)
      startWatching(response.result.path, event.sender, {
        gitDir: response.result.gitDir,
        commonDir: response.result.commonDir
      })
    }
    return response
  })

  ipcMain.handle(Channel.closeRepo, async (event, repoPath: string) => {
    try {
      await sidecarRpcCall(CloseRepo._tag, { repoPath })
    } finally {
      await stopWatching(normalizeRepoPath(repoPath), event.sender.id)
    }
  })
}
