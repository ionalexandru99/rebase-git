import { normalizeRepoPath } from '@shared/repo-path'
import { Channel, type OpenRepoResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { SidecarOp } from '../../sidecar/protocol'
import { startWatching, stopWatching } from '../repoWatcher'
import { sidecarRequest } from '../sidecar'
import { addRecentRepo } from '../store'

export function register(): void {
  ipcMain.handle(Channel.openRepo, async (event, repoPath: string) => {
    const response = await sidecarRequest<OpenRepoResponse>(SidecarOp.openRepo, { repoPath })
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
      await sidecarRequest(SidecarOp.closeRepo, { repoPath })
    } finally {
      await stopWatching(normalizeRepoPath(repoPath), event.sender.id)
    }
  })
}
