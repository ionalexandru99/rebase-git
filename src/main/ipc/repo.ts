import { normalizeRepoPath } from '@shared/repo-path'
import {
  type BranchesResponse,
  Channel,
  type CheckoutResponse,
  type OpenRepoResponse
} from '@shared/schemas/ipc'
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
      startWatching(response.result.path, event.sender)
    }
    return response
  })

  ipcMain.handle(Channel.closeRepo, async (_, repoPath: string) => {
    await sidecarRequest(SidecarOp.closeRepo, { repoPath })
    await stopWatching(normalizeRepoPath(repoPath))
  })

  ipcMain.handle(Channel.getBranches, (_, repoPath: string) =>
    sidecarRequest<BranchesResponse>(SidecarOp.getBranches, { repoPath })
  )

  ipcMain.handle(
    Channel.checkoutRef,
    (_, repoPath: string, refKind: 'local' | 'remote' | 'tag', fullPath: string) =>
      sidecarRequest<CheckoutResponse>(SidecarOp.checkoutRef, { repoPath, refKind, fullPath })
  )
}
