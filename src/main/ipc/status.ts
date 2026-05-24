import {
  Channel,
  type CommitResponse,
  type StageResponse,
  type StatusResponse,
  type UnstageResponse
} from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { SidecarOp } from '../../sidecar/protocol'
import { sidecarRequest } from '../sidecar'

export function register(): void {
  ipcMain.handle(Channel.getStatus, (_, repoPath: string) =>
    sidecarRequest<StatusResponse>(SidecarOp.getStatus, { repoPath })
  )

  ipcMain.handle(Channel.stageFile, (_, repoPath: string, file: string) =>
    sidecarRequest<StageResponse>(SidecarOp.stageFile, { repoPath, file })
  )

  ipcMain.handle(Channel.unstageFile, (_, repoPath: string, file: string) =>
    sidecarRequest<UnstageResponse>(SidecarOp.unstageFile, { repoPath, file })
  )

  ipcMain.handle(Channel.commit, (_, repoPath: string, message: string) =>
    sidecarRequest<CommitResponse>(SidecarOp.commit, { repoPath, message })
  )
}
